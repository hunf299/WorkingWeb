export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseServiceRoleClient } from '../../../../lib/supabaseAdmin';

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const COOKIE_NAME = 'trial_user_id';
const SECURE_COOKIE = process.env.NODE_ENV === 'production';

function getUserIdFromCookies() {
  try {
    const cookieStore = cookies();
    const stored = cookieStore.get(COOKIE_NAME);
    const value = typeof stored?.value === 'string' ? stored.value.trim() : '';
    return value || null;
  } catch (err) {
    console.error('Không đọc được cookie trial_user_id', err);
    return null;
  }
}

function createClearedCookieResponse(body) {
  const response = NextResponse.json(body);
  response.cookies.set({
    name: COOKIE_NAME,
    value: '',
    maxAge: 0,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIE,
  });
  return response;
}

export async function GET() {
  const userId = getUserIdFromCookies();
  if (!userId) {
    return NextResponse.json({ exists: false });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('users_trial')
    .select('email')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('trial-users/email GET error', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  const email = typeof data?.email === 'string' ? data.email.trim() : '';
  if (!email) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({ exists: true, email });
}

export async function POST(req) {
  const userId = getUserIdFromCookies();
  if (!userId) {
    return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const email = typeof payload?.email === 'string' ? payload.email.trim() : '';
  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'Email không hợp lệ.' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('users_trial')
    .upsert({ id: userId, email }, { onConflict: 'id' })
    .select('email')
    .single();

  if (error) {
    console.error('trial-users/email POST error', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  const savedEmail = typeof data?.email === 'string' ? data.email.trim() : email;
  return NextResponse.json({ ok: true, email: savedEmail });
}

export async function DELETE() {
  return createClearedCookieResponse({ ok: true });
}
