export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getSupabaseServiceRoleClient } from '../../../lib/supabaseAdmin';

function parseSalaryDetail(detail) {
  const base = { shopee: 0, lazada: 0, tiktok: 0 };
  if (typeof detail !== 'string') return base;

  const extractCount = (label) => {
    const regex = new RegExp(`${label}[^0-9]*([0-9]+)`, 'i');
    const match = detail.match(regex);
    if (!match) return 0;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : 0;
  };

  return {
    shopee: extractCount('shopee'),
    lazada: extractCount('lazada'),
    tiktok: extractCount('tiktok'),
  };
}

function formatSalaryDetail(counts) {
  return `(sl Shopee): ${counts.shopee} + (sl Tiktok): ${counts.tiktok} + (sl Lazada): ${counts.lazada}`;
}

export async function POST(req) {
  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const coorNameRaw = typeof payload?.coor_name === 'string' ? payload.coor_name.trim() : '';
  const shopeeCount = Number(payload?.new_shopee_count) || 0;
  const lazadaCount = Number(payload?.new_lazada_count) || 0;
  const tiktokCount = Number(payload?.new_tiktok_count) || 0;
  const totalMoney = Number(payload?.new_total_money) || 0;

  if (!coorNameRaw) {
    return NextResponse.json({ error: 'Coordinator name is required' }, { status: 400 });
  }

  if ([shopeeCount, lazadaCount, tiktokCount, totalMoney].some(value => !Number.isFinite(value) || value < 0)) {
    return NextResponse.json({ error: 'Invalid numeric payload' }, { status: 400 });
  }

  if (totalMoney <= 0) {
    return NextResponse.json({ error: 'Total money must be greater than 0' }, { status: 400 });
  }

  const lookupName = coorNameRaw.includes('_')
    ? coorNameRaw.split('_').pop().trim()
    : coorNameRaw;

  if (!lookupName) {
    return NextResponse.json({ error: 'Cannot extract coordinator name' }, { status: 400 });
  }

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
  const mergedCounts = parseSalaryDetail(user.salary_detail);
  mergedCounts.shopee += shopeeCount;
  mergedCounts.lazada += lazadaCount;
  mergedCounts.tiktok += tiktokCount;

  const nextSalary = existingSalary + totalMoney;
  const nextSalaryDetail = formatSalaryDetail(mergedCounts);

  const { data: updatedUser, error: updateError } = await supabase
    .from('users_trial')
    .update({
      salary: nextSalary,
      salary_detail: nextSalaryDetail,
    })
    .eq('id', user.id)
    .select('salary, salary_detail')
    .single();

  if (updateError) {
    console.error('calculate-salary update error', updateError);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  return NextResponse.json({
    salary: updatedUser.salary,
    salary_detail: updatedUser.salary_detail,
    user_name: user.name,
  });
}
