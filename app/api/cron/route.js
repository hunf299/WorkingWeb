export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { google } from 'googleapis';
import { parseVNDate, parseSlot, isSameDay } from '../../../lib/parse';
import { NextResponse } from 'next/server';

/* ---------- Helpers ---------- */

const TZ = 'Asia/Ho_Chi_Minh';
const TOLERANCE_MS = 5 * 60 * 1000; // 5 phút

function nowInTZStartOfDay() {
  // Convert "now" to VN timezone, then snap to 00:00
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: TZ })
  );
  now.setHours(0, 0, 0, 0);
  return now;
}

async function fetchSheetRows() {
  const SHEET_ID = process.env.SHEET_ID;
  const SHEET_RANGE = process.env.SHEET_RANGE || 'Sheet1!A:H';
  const API_KEY = process.env.GOOGLE_API_KEY;

  if (!SHEET_ID || !API_KEY) {
    throw new Error('Missing SHEET_ID or GOOGLE_API_KEY env');
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(
      SHEET_RANGE
    )}?key=${API_KEY}`;

  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`Sheets API error: ${r.status} ${msg}`);
  }
  const data = await r.json();
  // data.values: [ [A,B,C,D,E,F,G,H], ... ]
  return Array.isArray(data.values) ? data.values : [];
}

function getAuth() {
  const email = process.env.GCAL_CLIENT_EMAIL;
  const key = process.env.GCAL_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error('Missing GCAL_CLIENT_EMAIL or GCAL_PRIVATE_KEY env');
  }
  return new google.auth.JWT(
    email,
    null,
    key.replace(/\\n/g, '\n'), // handle escaped newlines in env
    ['https://www.googleapis.com/auth/calendar']
  );
}

/* ---------- Route ---------- */

export async function GET(req) {
  try {
    // 1) Optional protection with CRON_SECRET
    const authHeader = req.headers.get('authorization') || '';
    if (
      process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return new Response('Unauthorized', { status: 401 });
    }

    const today = nowInTZStartOfDay();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // 2) Read sheet
    const values = await fetchSheetRows();
    if (values.length <= 1) {
      return Response.json({ ok: true, msg: 'No data rows' });
    }

    // 3) Parse rows -> events for TODAY
    // Header assumed as first row:
    // A: Date, B: Brand/Channel, C: Session type, D: Time slot,
    // E: Talent1, F: Talent2, G: Room, H: Phone
    const rows = values.slice(1);
    const events = [];

    for (const r of rows) {
      const rawDate = (r[0] || '').toString().trim();
      const brandChannel = (r[1] || '').toString().trim();
      const sessionType = (r[2] || '').toString().trim();
      const timeSlot = (r[3] || '').toString().trim();
      const talent1 = (r[4] || '').toString().trim();
      const talent2 = (r[5] || '').toString().trim();
      const room = (r[6] || '').toString().trim();
      const phone = (r[7] || '').toString().trim();
const d = parseVNDate(rawDate); // supports dd/MM/yyyy and yyyy-MM-dd
      if (!d || !isSameDay(d, today)) continue;

      const slot = parseSlot(timeSlot, d);
      if (!slot) continue;

      events.push({
        title: brandChannel,
        start: slot.start,
        end: slot.end,
        sessionType,
        talent1,
        talent2,
        room,
        phone,
        rawDate,
        timeSlot
      });
    }

    if (!events.length) {
      return Response.json({ ok: true, msg: 'No events today' });
    }

    // 4) Google Calendar client
    const calendarId = process.env.GCAL_CALENDAR_ID || 'primary';
    const auth = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    // 5) (Optional) clear existing events today to avoid duplicates
    const old = await calendar.events.list({
      calendarId,
      timeMin: today.toISOString(),
      timeMax: tomorrow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    if (old.data.items?.length) {
      for (const ev of old.data.items) {
        try { await calendar.events.delete({ calendarId, eventId: ev.id }); }
        catch (_) {}
      }
    }

    // 6) Group by brand and insert; only first of contiguous chain gets -30' reminder
    const byTitle = new Map();
    for (const e of events) {
      if (!byTitle.has(e.title)) byTitle.set(e.title, []);
      byTitle.get(e.title).push(e);
    }

    let createdCount = 0;

    for (const arr of byTitle.values()) {
      arr.sort((a, b) => a.start - b.start);
      let prevEnd = null;

      for (const ev of arr) {
        const contiguous = prevEnd && Math.abs(ev.start - prevEnd) <= TOLERANCE_MS;
        const isFirst = !contiguous;

        const desc =
`Session type: ${ev.sessionType}
Talent: ${ev.talent1}${ev.talent2 ? ', ' + ev.talent2 : ''}
Room: ${ev.room}
Phone: ${ev.phone}
Time slot: ${ev.timeSlot}
Nguồn: Google Sheet ${ev.rawDate}`;

        await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: ev.title,
            description: desc,
            location: ev.room,
            start: { dateTime: ev.start.toISOString(), timeZone: TZ },
            end: { dateTime: ev.end.toISOString(), timeZone: TZ },
            reminders: {
              useDefault: false,
              overrides: isFirst ? [{ method: 'popup', minutes: 30 }] : []
            }
          }
        });

        createdCount++;
        prevEnd = ev.end;
      }
    }

    return Response.json({ ok: true, created: createdCount });
  } catch (err) {
    console.error('CRON ERROR:', err);
    return Response.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
