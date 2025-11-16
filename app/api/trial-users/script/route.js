export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseServiceRoleClient } from '../../../../../lib/supabaseAdmin';

const COOKIE_NAME = 'trial_user_id';

function getUserIdFromCookies() {
  try {
    const cookieStore = cookies();
    const stored = cookieStore.get(COOKIE_NAME);
    const value = typeof stored?.value === 'string' ? stored.value.trim() : '';
    return value || null;
  } catch (error) {
    console.error('Không đọc được cookie trial_user_id', error);
    return null;
  }
}

export async function POST(req) {
  const userId = getUserIdFromCookies();
  if (!userId) {
    return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const scriptInput = typeof payload?.script === 'string' ? payload.script : '';
  const script = scriptInput.trim();

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('users_trial')
    .update({ script })
    .eq('id', userId)
    .select('script')
    .maybeSingle();

  if (error) {
    console.error('trial-users/script POST error', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Không tìm thấy người dùng.' }, { status: 404 });
  }

  const savedScript = typeof data?.script === 'string' ? data.script : script;
  return NextResponse.json({ ok: true, script: savedScript });
}
