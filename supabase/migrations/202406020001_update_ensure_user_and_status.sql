-- Update ensure_user_and_status RPC to correctly initialize new users
-- and keep track of login statistics.

create extension if not exists pgcrypto;

create or replace function public.ensure_user_and_status(
  p_name text,
  p_fp text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_name text := nullif(trim(p_name), '');
  v_norm text;
  v_user users_trial%rowtype;
  v_first_login timestamptz;
  v_trial_expires timestamptz;
  v_login_count integer;
  v_status text;
  v_days_left integer;
begin
  if v_name is null then
    raise exception 'Name is required';
  end if;

  v_norm := lower(v_name);

  select *
    into v_user
  from users_trial
  where name_norm = v_norm
  limit 1;

  if not found then
    insert into users_trial (
      id,
      name,
      first_login_at,
      trial_expires_at,
      last_login_at,
      login_count,
      is_blocked
    )
    values (
      gen_random_uuid(),
      v_name,
      v_now,
      v_now + interval '14 days',
      v_now,
      1,
      false
    )
    returning * into v_user;
  else
    v_first_login := coalesce(v_user.first_login_at, v_now);
    v_trial_expires := coalesce(v_user.trial_expires_at, v_first_login + interval '14 days');
    v_login_count := coalesce(v_user.login_count, 0) + 1;

    update users_trial
       set first_login_at = v_first_login,
           trial_expires_at = v_trial_expires,
           last_login_at = v_now,
           login_count = v_login_count
     where id = v_user.id
     returning * into v_user;
  end if;

  if v_user.is_blocked then
    v_status := 'blocked';
  elsif v_now > v_user.trial_expires_at then
    v_status := 'expired';
  else
    v_status := 'active';
  end if;

  v_days_left := greatest(
    0,
    floor(extract(epoch from (v_user.trial_expires_at - v_now)) / 86400)
  );

  return jsonb_build_object(
    'user_id', v_user.id,
    'name', v_user.name,
    'first_login_at', v_user.first_login_at,
    'trial_expires_at', v_user.trial_expires_at,
    'last_login_at', v_user.last_login_at,
    'login_count', v_user.login_count,
    'status', v_status,
    'days_left', v_days_left
  );
end;
$$;
