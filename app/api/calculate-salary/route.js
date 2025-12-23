export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getSupabaseServiceRoleClient } from '../../../lib/supabaseAdmin';

const PLATFORM_LABELS = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'Tiktok' };

function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromYMD(ymd) {
  if (typeof ymd !== 'string') return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatDM(date) {
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function computePayrollPeriod(referenceDate) {
  const ref = referenceDate instanceof Date ? referenceDate : new Date();
  const day = ref.getDate();
  const month = ref.getMonth();
  const year = ref.getFullYear();

  const endMonth = day >= 16 ? month + 1 : month;
  const periodEnd = new Date(year, endMonth, 15);
  const periodStart = new Date(year, endMonth - 1, 16);
  const outStart = new Date(periodEnd);
  outStart.setDate(outStart.getDate() + 1);
  const outEnd = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, 0);

  return { periodStart, periodEnd, outStart, outEnd };
}

function resolvePlatform(rawEvent) {
  const direct = (rawEvent?.platform || '').toString().toLowerCase();
  if (direct === 'tiktok' || direct === 'shopee' || direct === 'lazada') return direct;

  const haystack = [rawEvent?.title, rawEvent?.platform_label]
    .filter(Boolean)
    .map(part => part.toString().toLowerCase())
    .join(' ');

  if (haystack.includes('tiktok') || haystack.includes('tts')) return 'tiktok';
  if (haystack.includes('lazada') || haystack.includes('lzd')) return 'lazada';
  if (haystack.includes('shopee') || haystack.includes('shp')) return 'shopee';

  return '';
}

function computeSessionMoney(rawEvent, platform) {
  const titleUpper = (rawEvent?.title || '').toString().toUpperCase();
  const platformUpper = (rawEvent?.platform_label || rawEvent?.platform || '').toString().toUpperCase();
  const combined = `${titleUpper} ${platformUpper}`;

  let sessionMoney = 0;

  if (titleUpper.includes('KENVUE') && (platformUpper.includes('SHOPEE') || platformUpper.includes('SHP') || combined.includes('SHOPEE'))) {
    sessionMoney = 80000;
  } else if (titleUpper.includes('NUTIMILK') && (platformUpper.includes('SHOPEE') || platformUpper.includes('SHP') || combined.includes('SHOPEE'))) {
    sessionMoney = 80000;
  } else if (titleUpper.includes('LISTERINE') && (platformUpper.includes('TIKTOK') || platformUpper.includes('TTS') || combined.includes('TIKTOK'))) {
    sessionMoney = 40000;
  } else if (platform === 'tiktok' || platformUpper.includes('TIKTOK') || platformUpper.includes('TTS') || combined.includes('TIKTOK') || combined.includes('TTS')) {
    sessionMoney = 80000;
  } else if (platform === 'shopee' || platformUpper.includes('SHOPEE') || platformUpper.includes('SHP') || combined.includes('SHOPEE')) {
    sessionMoney = 40000;
  } else if (platform === 'lazada' || platformUpper.includes('LAZADA') || platformUpper.includes('LZD') || combined.includes('LAZADA')) {
    sessionMoney = 40000;
  }

  return sessionMoney;
}

function normalizeIncomingEvents(events) {
  if (!Array.isArray(events)) return [];
  const normalized = [];
  const seen = new Set();

  for (const raw of events) {
    const platform = resolvePlatform(raw);
    if (!platform || !PLATFORM_LABELS[platform]) continue;

    const dateObj = fromYMD(raw?.date);
    if (!dateObj) continue;

    const money = Number.isFinite(Number(raw?.session_money)) && Number(raw.session_money) > 0
      ? Number(raw.session_money)
      : computeSessionMoney(raw, platform);
    if (!Number.isFinite(money) || money <= 0) continue;

    const keyParts = [raw?.key, platform, toYMD(dateObj), (raw?.title || '').toString().trim().toUpperCase(), (raw?.time_slot || '').toString().trim().toUpperCase()]
      .filter(Boolean);
    const key = keyParts.join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      key,
      date: toYMD(dateObj),
      platform,
      money,
      dayLabel: formatDM(dateObj),
    });
  }

  return normalized;
}

function aggregateCounts(events) {
  const counts = { shopee: 0, lazada: 0, tiktok: 0 };
  for (const ev of events) {
    if (counts.hasOwnProperty(ev.platform)) {
      counts[ev.platform] += 1;
    }
  }
  return counts;
}

function sanitizeStoredEvents(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const ev of events) {
    const platform = typeof ev?.platform === 'string' ? ev.platform.toLowerCase() : '';
    const key = typeof ev?.key === 'string' ? ev.key : '';
    const dateObj = fromYMD(ev?.date);
    const money = Number(ev?.money) || 0;
    if (!PLATFORM_LABELS[platform] || !dateObj || !key) continue;
    out.push({
      key,
      platform,
      date: toYMD(dateObj),
      money,
      dayLabel: formatDM(dateObj),
    });
  }
  return out;
}

function parseSalaryState(detail) {
  if (typeof detail === 'string') {
    try {
      const parsed = JSON.parse(detail);
      if (parsed && parsed.version === 2) {
        return {
          version: 2,
          lastPeriod: parsed.lastPeriod || null,
          pendingOutEvents: sanitizeStoredEvents(parsed.pendingOutEvents || []),
        };
      }
    } catch (err) {
      // ignore legacy formats
    }
  }

  return { version: 2, lastPeriod: null, pendingOutEvents: [] };
}

function buildPlatformSummary(events, includeZero = false) {
  const order = ['tiktok', 'shopee', 'lazada'];
  const summaries = [];

  for (const key of order) {
    const bucket = events.filter(ev => ev.platform === key);
    if (!bucket.length && !includeZero) continue;
    if (!bucket.length && includeZero) {
      summaries.push(`${PLATFORM_LABELS[key]}=0`);
      continue;
    }
    const uniqueDates = Array.from(new Set(bucket.map(ev => ev.date))).sort();
    const dateLabels = uniqueDates.map(dateStr => {
      const d = fromYMD(dateStr);
      return d ? formatDM(d) : dateStr;
    });
    summaries.push(`${PLATFORM_LABELS[key]}(${dateLabels.join(',')})=${bucket.length}`);
  }

  return summaries.join(' | ');
}

function buildSalaryNote({ periodStart, periodEnd, inEvents, carryEvents, outEvents, showPrev, prevSalary }) {
  const periodLabel = `Kỳ ${formatDM(periodStart)}-${formatDM(periodEnd)}`;
  const blocks = [periodLabel];

  if (showPrev && prevSalary > 0) {
    blocks.push(`Prev=${prevSalary.toLocaleString('vi-VN')}đ`);
  }

  if (carryEvents.length) {
    const carrySummary = buildPlatformSummary(carryEvents, false);
    if (carrySummary) {
      blocks.push(`Carry: ${carrySummary}`);
    }
  }

  const inSummary = buildPlatformSummary(inEvents, true);
  blocks.push(`IN: ${inSummary || 'Tiktok=0 | Shopee=0 | Lazada=0'}`);

  const outSummary = buildPlatformSummary(outEvents, false);
  if (outSummary) {
    blocks.push(`OUT: ${outSummary}`);
  }

  return blocks.join(', ');
}

export async function POST(req) {
  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const coorNameRaw = typeof payload?.coor_name === 'string' ? payload.coor_name.trim() : '';
  if (!coorNameRaw) {
    return NextResponse.json({ error: 'Coordinator name is required' }, { status: 400 });
  }

  const lookupName = coorNameRaw.includes('_')
    ? coorNameRaw.split('_').pop().trim()
    : coorNameRaw;

  if (!lookupName) {
    return NextResponse.json({ error: 'Cannot extract coordinator name' }, { status: 400 });
  }

  const incomingEvents = normalizeIncomingEvents(payload?.events);
  if (!incomingEvents.length) {
    return NextResponse.json({ error: 'Không xác định được ca hợp lệ để tính lương' }, { status: 400 });
  }

  const referenceDate = payload?.reference_date ? new Date(payload.reference_date) : new Date();
  const { periodStart, periodEnd, outEnd } = computePayrollPeriod(referenceDate);
  const periodStartYMD = toYMD(periodStart);
  const periodEndYMD = toYMD(periodEnd);

  const supabase = getSupabaseServiceRoleClient();
  const { data: user, error } = await supabase
    .from('users_trial')
    .select('id, name, salary, salary_detail')
    .eq('name', lookupName)
    .maybeSingle();

  if (error) {
    console.error('calculate-salary select error', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: 'Coordinator not found' }, { status: 404 });
  }

  const existingSalary = Number(user.salary) || 0;
  const salaryState = parseSalaryState(user.salary_detail);
  const lastPeriod = salaryState.lastPeriod || null;
  const samePeriod = Boolean(lastPeriod && lastPeriod.start === periodStartYMD && lastPeriod.end === periodEndYMD);

  const carryEvents = samePeriod
    ? sanitizeStoredEvents(lastPeriod?.carryEvents || [])
    : sanitizeStoredEvents(salaryState.pendingOutEvents || []);

  const baseInEvents = samePeriod
    ? sanitizeStoredEvents(lastPeriod?.inEvents || [])
    : [];

  const processedKeys = new Set([...carryEvents, ...baseInEvents].map(ev => ev.key));

  let pendingOutEvents = samePeriod
    ? sanitizeStoredEvents(salaryState.pendingOutEvents || [])
    : [];
  const pendingOutKeys = new Set(pendingOutEvents.map(ev => ev.key));

  const requestSeen = new Set();
  const newInEvents = [];
  const duplicateDates = new Set();

  for (const ev of incomingEvents) {
    if (requestSeen.has(ev.key)) continue;
    requestSeen.add(ev.key);

    if (processedKeys.has(ev.key)) {
      duplicateDates.add(ev.dayLabel);
      continue;
    }

    const eventDate = fromYMD(ev.date);
    if (!eventDate) continue;

    if (eventDate >= periodStart && eventDate <= periodEnd) {
      newInEvents.push(ev);
      processedKeys.add(ev.key);
      continue;
    }

    if (eventDate > periodEnd && eventDate <= outEnd && eventDate.getMonth() === periodEnd.getMonth() && eventDate.getFullYear() === periodEnd.getFullYear()) {
      if (!pendingOutKeys.has(ev.key)) {
        pendingOutEvents.push(ev);
        pendingOutKeys.add(ev.key);
      }
      continue;
    }
  }

  const carryMoney = samePeriod ? 0 : carryEvents.reduce((sum, ev) => sum + (Number(ev.money) || 0), 0);
  const inMoney = newInEvents.reduce((sum, ev) => sum + (Number(ev.money) || 0), 0);
  const addedMoney = carryMoney + inMoney;

  if (addedMoney <= 0) {
    const existingInEvents = samePeriod ? baseInEvents : [];
    const note = samePeriod && typeof lastPeriod?.note === 'string'
      ? lastPeriod.note
      : buildSalaryNote({
          periodStart,
          periodEnd,
          inEvents: sanitizeStoredEvents(existingInEvents),
          carryEvents,
          outEvents: pendingOutEvents,
          showPrev: !samePeriod,
          prevSalary: existingSalary,
        });
    const counts = aggregateCounts([...(!samePeriod ? carryEvents : []), ...existingInEvents]);

    return NextResponse.json({
      salary: existingSalary,
      salary_detail: note,
      salary_note: note,
      user_name: user.name,
      counts,
      added_money: 0,
      duplicates: Array.from(duplicateDates),
    });
  }

  const nextSalary = existingSalary + addedMoney;

  const nextLastPeriod = {
    start: periodStartYMD,
    end: periodEndYMD,
    inEvents: samePeriod ? [...baseInEvents, ...newInEvents] : newInEvents,
    carryEvents: samePeriod ? (lastPeriod?.carryEvents || []) : carryEvents,
    note: '',
  };

  const note = buildSalaryNote({
    periodStart,
    periodEnd,
    inEvents: sanitizeStoredEvents(nextLastPeriod.inEvents),
    carryEvents,
    outEvents: pendingOutEvents,
    showPrev: !samePeriod,
    prevSalary: existingSalary,
  });
  nextLastPeriod.note = note;

  const nextState = {
    version: 2,
    lastPeriod: nextLastPeriod,
    pendingOutEvents,
  };

  const { data: updatedUser, error: updateError } = await supabase
    .from('users_trial')
    .update({
      salary: nextSalary,
      salary_detail: JSON.stringify(nextState),
    })
    .eq('id', user.id)
    .select('salary, salary_detail')
    .single();

  if (updateError) {
    console.error('calculate-salary update error', updateError);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  const addedCounts = aggregateCounts([...(!samePeriod ? carryEvents : []), ...newInEvents]);

  return NextResponse.json({
    salary: updatedUser.salary,
    salary_detail: note,
    salary_note: note,
    user_name: user.name,
    counts: addedCounts,
    added_money: addedMoney,
    duplicates: Array.from(duplicateDates),
  });
}
