export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getSupabaseServiceRoleClient } from '../../../lib/supabaseAdmin';

/* ===================== CONSTANTS ===================== */
const PLATFORM_LABELS = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'Tiktok' };

/* ===================== DATE UTILS ===================== */
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

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isBetween(d, start, end) {
  return d >= start && d <= end;
}

/* ===================== PERIOD ===================== */
/**
 * Kỳ lương: 16 tháng trước -> 15 tháng này
 */
function computePayrollPeriod(referenceDate) {
  const ref = referenceDate instanceof Date ? referenceDate : new Date();
  const day = ref.getDate();
  const month = ref.getMonth();
  const year = ref.getFullYear();

  const endMonth = day >= 16 ? month + 1 : month;
  const periodStart = new Date(year, endMonth - 1, 16, 0, 0, 0, 0);
  const periodEnd = new Date(year, endMonth, 15, 23, 59, 59, 999);

  const outStart = new Date(periodEnd);
  outStart.setDate(outStart.getDate() + 1);
  outStart.setHours(0, 0, 0, 0);

  const outEnd = endOfMonth(periodEnd);

  return { periodStart, periodEnd, outStart, outEnd };
}

function periodKey(start, end) {
  return `${toYMD(start)}_${toYMD(end)}`;
}

function samePeriod(a, b) {
  return (
    a.periodStart.getTime() === b.periodStart.getTime() &&
    a.periodEnd.getTime() === b.periodEnd.getTime()
  );
}

/* ===================== COORDINATOR ===================== */
function normalizeCoordinatorName(raw) {
  if (typeof raw !== 'string') return '';
  let name = raw.trim();
  if (!name) return '';

  name = name.replace(/^Standby External\s*-\s*/i, '').trim();

  const parts = name.split('_');
  if (parts.length > 1 && /^\d+$/.test(parts[0])) {
    name = parts.slice(1).join('_').trim();
  } else {
    name = name.replace(/^[0-9]+\s*_+\s*/, '').trim();
  }

  return name || raw.trim();
}

/* ===================== EVENT ===================== */
function resolvePlatform(raw) {
  const direct = (raw?.platform || '').toLowerCase();
  if (PLATFORM_LABELS[direct]) return direct;

  const text = [raw?.title, raw?.platform_label].join(' ').toLowerCase();
  if (text.includes('tiktok') || text.includes('tts')) return 'tiktok';
  if (text.includes('shopee') || text.includes('shp')) return 'shopee';
  if (text.includes('lazada') || text.includes('lzd')) return 'lazada';
  return '';
}

function computeSessionMoney(raw, platform) {
  const title = (raw?.title || '').toUpperCase();
  const label = (raw?.platform_label || raw?.platform || '').toUpperCase();
  const all = `${title} ${label}`;

  if (title.includes('KENVUE') && all.includes('SHOPEE')) return 80000;
  if (title.includes('NUTIMILK') && all.includes('SHOPEE')) return 80000;
  if (title.includes('LISTERINE') && all.includes('TIKTOK')) return 40000;
  if (platform === 'tiktok') return 80000;
  return 40000;
}

function normalizeIncomingEvents(events) {
  if (!Array.isArray(events)) return [];
  const seen = new Set();
  const out = [];

  for (const raw of events) {
    const platform = resolvePlatform(raw);
    if (!platform) continue;

    const dateObj = fromYMD(raw?.date);
    if (!dateObj) continue;

    const money = Number(raw?.session_money) > 0
      ? Number(raw.session_money)
      : computeSessionMoney(raw, platform);

    const key = [
      raw?.key,
      platform,
      toYMD(dateObj),
      (raw?.title || '').toUpperCase(),
      (raw?.time_slot || '').toUpperCase(),
    ].join('|');

    if (!key || seen.has(key)) continue;
    seen.add(key);

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

function aggregateCounts(events) {
  return events.reduce(
    (a, e) => ((a[e.platform] += 1), a),
    { shopee: 0, lazada: 0, tiktok: 0 }
  );
}

/* ===================== SALARY STATE ===================== */
function parseSalaryState(detail) {
  try {
    const p = JSON.parse(detail);
    if (p?.version === 3) return p;
  } catch {}
  return { version: 3, periods: {}, pendingOutEvents: [] };
}

/* ===================== PREV ===================== */
function getPrevPeriodMoney(periods, targetPeriod) {
  const prevDate = new Date(targetPeriod.periodStart);
  prevDate.setDate(prevDate.getDate() - 1);
  const prev = computePayrollPeriod(prevDate);
  const key = periodKey(prev.periodStart, prev.periodEnd);
  return Number(periods[key]?.totalMoney) || 0;
}

/* ===================== NOTE ===================== */
function buildPlatformSummary(events, includeZero) {
  const order = ['tiktok', 'shopee', 'lazada'];
  const res = [];

  for (const k of order) {
    const list = events.filter(e => e.platform === k);
    if (!list.length && !includeZero) continue;
    if (!list.length) {
      res.push(`${PLATFORM_LABELS[k]}=0`);
      continue;
    }
    const days = [...new Set(list.map(e => e.dayLabel))];
    res.push(`${PLATFORM_LABELS[k]}(${days.join(',')})=${list.length}`);
  }
  return res.join(' | ');
}

function buildSalaryNote({ periodStart, periodEnd, inEvents, carryEvents, outEvents, prevSalary }) {
  const parts = [`Kỳ ${formatDM(periodStart)}-${formatDM(periodEnd)}`];
  if (prevSalary > 0) parts.push(`Prev=${prevSalary.toLocaleString('vi-VN')}đ`);
  if (carryEvents.length) parts.push(`Carry: ${buildPlatformSummary(carryEvents)}`);
  parts.push(`IN: ${buildPlatformSummary(inEvents, true)}`);
  if (outEvents.length) parts.push(`OUT: ${buildPlatformSummary(outEvents)}`);
  return parts.join(', ');
}

/* ===================== CORE ===================== */
function getPeriodSnapshot({ periods, pendingOutEvents, targetPeriod }) {
  const key = periodKey(targetPeriod.periodStart, targetPeriod.periodEnd);
  const snapshot = periods[key] || null;

  const carryStart = targetPeriod.periodStart;
  const carryEnd = endOfMonth(carryStart);

  const carryEvents = pendingOutEvents.filter(ev => {
    const d = fromYMD(ev.date);
    return d && isBetween(d, carryStart, carryEnd);
  });

  return { snapshot, carryEvents };
}

function calculateActivePeriod({ snapshot, carryEvents, incomingEvents, pendingOutEvents, period }) {
  const inEvents = snapshot?.inEvents || [];
  const used = new Set(inEvents.map(e => e.key));
  const newIn = [];
  const newPendingOut = [...pendingOutEvents];

  for (const ev of incomingEvents) {
    if (used.has(ev.key)) continue;
    const d = fromYMD(ev.date);
    if (!d) continue;

    if (isBetween(d, period.periodStart, period.periodEnd)) {
      newIn.push(ev);
      used.add(ev.key);
    } else if (d > period.periodEnd) {
      newPendingOut.push(ev);
    }
  }

  const carryMoney = snapshot ? 0 : carryEvents.reduce((s, e) => s + e.money, 0);
  const inMoney = newIn.reduce((s, e) => s + e.money, 0);

  return {
    inEvents: [...inEvents, ...newIn],
    carryEvents,
    pendingOutEvents: newPendingOut,
    addedMoney: carryMoney + inMoney,
  };
}

function extractHistoricalPeriod({ snapshot, carryEvents, incomingEvents, period }) {
  const inEvents = snapshot?.inEvents || [];
  const used = new Set(inEvents.map(e => e.key));
  const newIn = [];

  for (const ev of incomingEvents) {
    if (used.has(ev.key)) continue;
    const d = fromYMD(ev.date);
    if (d && isBetween(d, period.periodStart, period.periodEnd)) {
      newIn.push(ev);
    }
  }

  return { inEvents: [...inEvents, ...newIn], carryEvents };
}

/* ===================== POST ===================== */
export async function POST(req) {
  const payload = await req.json();
  const events = normalizeIncomingEvents(payload?.events || []);
  const referenceDate = payload?.reference_date ? new Date(payload.reference_date) : new Date();

  const activePeriod = computePayrollPeriod(new Date());
  const targetPeriod = computePayrollPeriod(referenceDate);
  const isActive = samePeriod(activePeriod, targetPeriod);
  const normalizedCoorName = normalizeCoordinatorName(payload.coor_name);

  const supabase = getSupabaseServiceRoleClient();
  const possibleNames = [...new Set([normalizedCoorName, payload.coor_name].filter(Boolean))];
  const { data: user, error } = await supabase
    .from('users_trial')
    .select('id, name, salary, salary_detail')
    .in('name', possibleNames)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Không thể đọc dữ liệu người dùng' }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: 'Không tìm thấy Coordinator' }, { status: 404 });
  }

  const state = parseSalaryState(user.salary_detail);
  const snapshotData = getPeriodSnapshot({
    periods: state.periods,
    pendingOutEvents: state.pendingOutEvents,
    targetPeriod,
  });

  const snapshot = snapshotData.snapshot;
  const isLocked = snapshot?.locked === true;

  const result = (isActive && !isLocked)
    ? calculateActivePeriod({
        snapshot,
        carryEvents: snapshotData.carryEvents,
        incomingEvents: events,
        pendingOutEvents: state.pendingOutEvents,
        period: targetPeriod,
      })
    : extractHistoricalPeriod({
        snapshot,
        carryEvents: snapshotData.carryEvents,
        incomingEvents: events,
        period: targetPeriod,
      });

  const prevMoney = getPrevPeriodMoney(state.periods, targetPeriod);

  const note = buildSalaryNote({
    periodStart: targetPeriod.periodStart,
    periodEnd: targetPeriod.periodEnd,
    inEvents: result.inEvents,
    carryEvents: result.carryEvents,
    outEvents: isActive && !isLocked ? result.pendingOutEvents : state.pendingOutEvents,
    prevSalary: prevMoney,
  });

  let addedMoney = 0;
  let responseSalary = user.salary;
  let responseDetail = JSON.stringify(state);
  let responseLocked = isLocked;

  if (isActive && !isLocked) {
    addedMoney = result.addedMoney || 0;

    const key = periodKey(targetPeriod.periodStart, targetPeriod.periodEnd);
    const totalMoney = (snapshot?.totalMoney || 0) + addedMoney;

    state.periods[key] = {
      start: toYMD(targetPeriod.periodStart),
      end: toYMD(targetPeriod.periodEnd),
      inEvents: result.inEvents,
      carryEvents: result.carryEvents,
      totalMoney,
      note,
      locked: true,
    };

    state.pendingOutEvents = result.pendingOutEvents;

    responseLocked = true;
    responseSalary = user.salary + addedMoney;
    responseDetail = JSON.stringify(state);

    await supabase.from('users_trial').update({
      salary: user.salary + addedMoney,
      salary_detail: JSON.stringify(state),
    }).eq('id', user.id);
  } else {
    responseLocked = snapshot?.locked === true;
  }

  return NextResponse.json({
    salary: responseSalary,
    salary_note: note,
    salary_detail: responseDetail,
    added_money: addedMoney,
    counts: aggregateCounts([
      ...result.carryEvents,
      ...result.inEvents,
    ]),
    is_active_period: isActive,
    locked: responseLocked,
  });
}

/* ===================== GET /salary-snapshot ===================== */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const coorName = searchParams.get('coor_name');
  const ref = searchParams.get('reference_date');

  if (!coorName || !ref) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  const referenceDate = new Date(ref);
  const targetPeriod = computePayrollPeriod(referenceDate);
  const normalizedCoorName = normalizeCoordinatorName(coorName);

  const supabase = getSupabaseServiceRoleClient();
  const possibleNames = [...new Set([normalizedCoorName, coorName].filter(Boolean))];
  const { data: user, error } = await supabase
    .from('users_trial')
    .select('salary_detail')
    .in('name', possibleNames)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Không thể đọc dữ liệu người dùng' }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: 'Không tìm thấy Coordinator' }, { status: 404 });
  }

  const state = parseSalaryState(user.salary_detail);
  const key = periodKey(targetPeriod.periodStart, targetPeriod.periodEnd);
  const snapshot = state.periods[key] || null;

  const prevMoney = getPrevPeriodMoney(state.periods, targetPeriod);

  const note = buildSalaryNote({
    periodStart: targetPeriod.periodStart,
    periodEnd: targetPeriod.periodEnd,
    inEvents: snapshot?.inEvents || [],
    carryEvents: snapshot?.carryEvents || [],
    outEvents: [],
    prevSalary: prevMoney,
  });

  return NextResponse.json({
    period: `${formatDM(targetPeriod.periodStart)}-${formatDM(targetPeriod.periodEnd)}`,
    salary_note: note,
    totalMoney: snapshot?.totalMoney || 0,
    locked: snapshot?.locked === true,
  });
}
