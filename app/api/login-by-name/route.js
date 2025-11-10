export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getSupabaseServiceRoleClient } from '../../../lib/supabaseAdmin';

const DAY_MS = 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'trial_user_id';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const SECURE_COOKIE = process.env.NODE_ENV === 'production';

function addDaysISO(baseDate, days) {
  return new Date(baseDate.getTime() + days * DAY_MS).toISOString();
}

function computeDaysLeft(trialExpiresAt, now) {
  if (!trialExpiresAt) {
    return 0;
  }
  const expires = new Date(trialExpiresAt).getTime();
  if (Number.isNaN(expires)) {
    return 0;
  }
  const diff = expires - now.getTime();
  if (diff <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(diff / DAY_MS));
}

function setTrialUserCookie(response, userId) {
  if (userId) {
    response.cookies.set({
      name: COOKIE_NAME,
      value: String(userId),
      maxAge: COOKIE_MAX_AGE,
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: SECURE_COOKIE,
    });
  } else {
    response.cookies.set({
      name: COOKIE_NAME,
      value: '',
      maxAge: 0,
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: SECURE_COOKIE,
    });
  }
}

export async function POST(req) {
  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const name = typeof payload?.name === 'string' ? payload.name : '';
  const trimmed = name.trim();
  if (!trimmed) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const nameNorm = trimmed.toLowerCase();
  const now = new Date();
  const nowIso = now.toISOString();

  const supabase = getSupabaseServiceRoleClient();

  const { data: user, error } = await supabase
    .from('users_trial')
    .select(
      'id, name, email, first_login_at, trial_expires_at, last_login_at, login_count, is_blocked'
    )
    .eq('name_norm', nameNorm)
    .maybeSingle();

  if (error) {
    console.error('login-by-name select error', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (!user) {
    const response = NextResponse.json({
      status: 'not_found',
      message: 'Tên không tồn tại, vui lòng nhập lại.',
    });
    setTrialUserCookie(response, null);
    return response;
  }

  if (user.is_blocked) {
    const response = NextResponse.json({ status: 'blocked' });
    setTrialUserCookie(response, null);
    return response;
  }

  const currentLoginCount = user.login_count ?? 0;
  let firstLoginAt = user.first_login_at;
  let trialExpiresAt = user.trial_expires_at;
  let nextLoginCount = currentLoginCount;

  if (!currentLoginCount || currentLoginCount <= 0) {
    firstLoginAt = nowIso;
    trialExpiresAt = addDaysISO(now, 14);
    nextLoginCount = 1;
  } else {
    if (!firstLoginAt) {
      firstLoginAt = nowIso;
    }
    if (!trialExpiresAt) {
      const firstLoginDate = new Date(firstLoginAt);
      trialExpiresAt = addDaysISO(
        Number.isNaN(firstLoginDate.getTime()) ? now : firstLoginDate,
        14,
      );
    }
    nextLoginCount = currentLoginCount + 1;
  }

  const { data: updatedUser, error: updateError } = await supabase
    .from('users_trial')
    .update({
      first_login_at: firstLoginAt,
      trial_expires_at: trialExpiresAt,
      last_login_at: nowIso,
      login_count: nextLoginCount,
    })
    .eq('id', user.id)
    .select(
      'id, name, email, first_login_at, trial_expires_at, last_login_at, login_count, is_blocked'
    )
    .single();

  if (updateError) {
    console.error('login-by-name update error', updateError);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  const expiresAtDate = updatedUser.trial_expires_at
    ? new Date(updatedUser.trial_expires_at)
    : null;
  const isExpired = expiresAtDate ? now > expiresAtDate : false;
  const status = isExpired ? 'expired' : 'active';
  const daysLeft = computeDaysLeft(updatedUser.trial_expires_at, now);

  const responsePayload = {
    user_id: updatedUser.id,
    name: updatedUser.name,
    email: updatedUser.email,
    first_login_at: updatedUser.first_login_at,
    trial_expires_at: updatedUser.trial_expires_at,
    last_login_at: updatedUser.last_login_at,
    login_count: updatedUser.login_count,
    status,
    days_left: daysLeft,
  };
  const response = NextResponse.json(responsePayload);
  if (status === 'active') {
    setTrialUserCookie(response, updatedUser.id);
  } else {
    setTrialUserCookie(response, null);
  }
  return response;
}
