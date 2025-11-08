-- Provide fuzzy suggestions for user names when authentication fails.

create extension if not exists fuzzystrmatch;

create or replace function public.suggest_user_names(
  p_query text,
  p_limit int default 2
)
returns table (
  name text,
  distance integer
)
language sql
security definer
set search_path = public
as $$
  select s.name,
         s.distance
  from (
    select u.name,
           levenshtein(lower(trim(u.name)), lower(trim(p_query))) as distance
    from users_trial u
    where u.is_blocked is false
      and nullif(trim(coalesce(p_query, '')), '') is not null
  ) as s
  order by s.distance asc, s.name asc
  limit greatest(1, coalesce(p_limit, 2));
$$;
