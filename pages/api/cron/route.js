import { google } from 'googleapis';
import { parseVNDate, parseSlot, isSameDay } from '../../../lib/parse';

// Lấy key từ biến môi trường Vercel
function getAuth() {
  return new google.auth.JWT(
    process.env.GCAL_CLIENT_EMAIL,
    null,
    process.env.GCAL_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/calendar']
  );
}

export async function GET() {
  try {
    const tz = 'Asia/Ho_Chi_Minh';
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    now.setHours(0,0,0,0);
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);

    // Fetch dữ liệu sheet
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/sheet`);
    const j = await res.json();
    const rawItems = j.items || [];

    // Lọc event hôm nay
    const events = [];
    for (const it of rawItems) {
      const d = parseVNDate(it.rawDate);
      if (!d || !isSameDay(d, now)) continue;
      const slot = parseSlot(it.timeSlot, d);
      if (!slot) continue;
      events.push({
        title: it.brandChannel,
        start: slot.start,
        end: slot.end,
        sessionType: it.sessionType,
        talent1: it.talent1,
        talent2: it.talent2,
        room: it.room,
        phone: it.phone,
        rawDate: it.rawDate,
        timeSlot: it.timeSlot,
      });
    }
    if (!events.length) {
      return Response.json({ ok: true, msg: 'No events today' });
    }

    // Group theo brand để rule alarm
    const byTitle = new Map();
    events.forEach(e => {
      if (!byTitle.has(e.title)) byTitle.set(e.title, []);
      byTitle.get(e.title).push(e);
    });

    const auth = getAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = process.env.GCAL_CALENDAR_ID || 'primary';

    // Xoá event cũ trong ngày (optional, để tránh trùng)
    const oldEvents = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: tomorrow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    for (const ev of oldEvents.data.items) {
      await calendar.events.delete({ calendarId, eventId: ev.id });
    }

    // Tạo lại events mới
    const TOLERANCE = 5 * 60 * 1000;
    for (const arr of byTitle.values()) {
      arr.sort((a,b)=>a.start-b.start);
      let prevEnd = null;
      for (const ev of arr) {
        const contiguous = prevEnd && Math.abs(ev.start - prevEnd) <= TOLERANCE;
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
start: { dateTime: ev.start.toISOString(), timeZone: tz },
            end: { dateTime: ev.end.toISOString(), timeZone: tz },
            reminders: {
              useDefault: false,
              overrides: isFirst ? [{ method: 'popup', minutes: 30 }] : [],
            },
          },
        });

        prevEnd = ev.end;
      }
    }

    return Response.json({ ok: true, created: events.length });
  } catch (e) {
    console.error('Cron error', e);
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
