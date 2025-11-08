export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getSupabaseServiceRoleClient } from '../../../lib/supabaseAdmin';

function levenshtein(a, b) {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q') || '';
  const trimmed = query.trim();
  if (!trimmed) {
    return NextResponse.json({ suggestions: [] });
  }

  const limitParam = Number(searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 2)) : 2;

  const supabase = getSupabaseServiceRoleClient();

  let suggestions = [];
  const { data, error } = await supabase.rpc('suggest_user_names', {
    p_query: trimmed,
    p_limit: limit,
  });

  if (!error && Array.isArray(data)) {
    suggestions = data
      .map((row) => (typeof row?.name === 'string' ? row.name : null))
      .filter(Boolean)
      .slice(0, limit);
  } else {
    const { data: fallbackRows, error: fallbackError } = await supabase
      .from('users_trial')
      .select('name, is_blocked')
      .or('is_blocked.is.null,is_blocked.eq.false')
      .ilike('name', `%${trimmed}%`)
      .limit(25);

    if (fallbackError) {
      console.error('suggest-names fallback query error', fallbackError);
      return NextResponse.json({ suggestions: [] });
    }

    suggestions = (fallbackRows || [])
      .map((row) => ({
        name: row.name,
        distance: levenshtein(row.name || '', trimmed),
      }))
      .filter((row) => typeof row.name === 'string' && row.name.trim().length > 0)
      .sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit)
      .map((row) => row.name);
  }

  return NextResponse.json({ suggestions });
}
