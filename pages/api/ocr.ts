import type { NextApiRequest, NextApiResponse } from 'next';
import { getVisionClient } from '../../lib/visionClient';

type Platform = 'tiktok' | 'shopee';

type OcrSuccessData = {
  gmv: string;
  orders: string;
  startTime: string;
  startTimeEncoded: string;
  platformDetected: Platform;
  gmvCandidates: string[];
  needsReview: boolean;
  recognizedText: string;
  sessionId: string;
};

type OcrResponse = {
  ok: true;
  data: OcrSuccessData;
} | {
  ok: false;
  error: string;
};

type VWord = {
  text: string;
  x0: number; y0: number; x1: number; y1: number;
  cx: number; cy: number; w: number; h: number;
};

type ExtractOpts = {
  ambiguityMode?: 'auto' | 'returnBoth';
  gmvOverride?: string | null;
};

const toWords = (anns: any[]): VWord[] => {
  const items = (anns || []).slice(1);
  return items
    .map((a: any) => {
      const vs = a.boundingPoly?.vertices || a.boundingPoly?.normalizedVertices || [];
      const xs = vs.map((v: any) => v.x || 0);
      const ys = vs.map((v: any) => v.y || 0);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const w = x1 - x0;
      const h = y1 - y0;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      return {
        text: String(a.description || '').trim(),
        x0,
        y0,
        x1,
        y1,
        cx,
        cy,
        w,
        h
      } as VWord;
    })
    .filter((w: VWord) => !!w.text);
};

const sameRow = (a: VWord, b: VWord, tolerance = 0.6) => {
  const hAvg = (a.h + b.h) / 2 || 1;
  return Math.abs(a.cy - b.cy) <= hAvg * tolerance;
};

const rightOf = (a: VWord, b: VWord) => a.cx > b.cx;

const below = (a: VWord, b: VWord, mul = 1.5) =>
  a.cy > b.y1 + Math.max(a.h, b.h) / mul;

const groupWordsByLine = (words: VWord[], yTol = 0.65) => {
  const arr = [...words].sort((p, q) => p.cy - q.cy || p.cx - q.cx);
  const lines: VWord[][] = [];
  for (const w of arr) {
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push([w]);
    } else {
      const ref = last[0];
      if (sameRow(w, ref, yTol)) {
        last.push(w);
      } else {
        lines.push([w]);
      }
    }
  }
  for (const line of lines) {
    line.sort((p, q) => p.cx - q.cx);
  }
  return lines;
};

const joinLine = (line: VWord[]) =>
  line.map(w => w.text).join(' ').replace(/\s{2,}/g, ' ').trim();

const digitsOnly = (s: string) => (s || '').replace(/\D+/g, '');

const LIVESTREAM_PARAM_KEYS = [
  'room_id',
  'roomid',
  'liveid',
  'live_id',
  'livestreamid',
  'livestream_id',
  'id'
];

const URL_CANDIDATE_REGEX = /(https?:\/\/[^\s]+|(?:shop\.tiktok\.com|tiktok|creator\.shopee\.vn|banhang\.shopee\.vn)[^\s]*)/gi;

const normalizeUrlCandidate = (raw: string) => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  const withoutSlashes = trimmed.replace(/^\/+/, '');
  return `https://${withoutSlashes}`;
};

const extractIdFromUrlCandidate = (raw: string) => {
  const collapsed = (raw || '').replace(/\s+/g, '');
  if (!collapsed) return '';
  const normalized = normalizeUrlCandidate(collapsed);
  try {
    const url = new URL(normalized);
    for (const key of LIVESTREAM_PARAM_KEYS) {
      const value = url.searchParams.get(key);
      if (value && /\d/.test(value)) {
        const match = value.match(/\d{5,}/);
        if (match) return match[0];
      }
    }
    const segments = url.pathname.split('/').filter(Boolean).reverse();
    for (const segment of segments) {
      const match = segment.match(/\d{5,}/);
      if (match) return match[0];
    }
    if (url.hash) {
      const hashMatch = url.hash.match(/\d{5,}/);
      if (hashMatch) return hashMatch[0];
    }
  } catch (err) {
    // ignore invalid URL formats and fall back below
  }
  const fallback = collapsed.match(/\d{5,}/g);
  return fallback && fallback.length ? fallback[fallback.length - 1] : '';
};

const shouldConsiderLineForPlatform = (collapsed: string, platform: Platform) => {
  const lower = collapsed.toLowerCase();
  if (platform === 'tiktok') {
    return /tiktok|room|live|shop/.test(lower);
  }
  return /shopee|live|dashboard|banhang|creator/.test(lower);
};

const extractSessionIdFromTexts = (texts: string[], platform: Platform): string => {
  const reversed = [...texts].reverse();
  for (const text of reversed) {
    if (!text) continue;
    const lines = text.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const urlMatches = Array.from(line.matchAll(URL_CANDIDATE_REGEX)).map(match => match[0]);
      for (const candidate of urlMatches) {
        const id = extractIdFromUrlCandidate(candidate);
        if (id) return id;
      }
      const collapsed = line.replace(/\s+/g, '');
      if (!shouldConsiderLineForPlatform(collapsed, platform)) continue;
      const id = extractIdFromUrlCandidate(collapsed);
      if (id) return id;
      const digits = collapsed.match(/\d{5,}/g);
      if (digits && digits.length) {
        return digits[digits.length - 1];
      }
    }
  }
  return '';
};

const normalizeShopeeGMV = (s: string) => {
  let cleaned = (s || '');

  const decimalCommaMatch = cleaned.match(/,\s*(\d{1,2})(?=[^0-9]|$)/);
  if (decimalCommaMatch?.index !== undefined) {
    cleaned = cleaned.slice(0, decimalCommaMatch.index);
  }

  return cleaned
    .replace(/[.,:\s₫đvndVND₫₫]/g, '')
    .replace(/[^0-9]/g, '');
};

const selectLineCandidate = (lines: VWord[][]): VWord[] | null => {
  let best: { line: VWord[]; score: number } | null = null;
  for (const line of lines) {
    const raw = joinLine(line);
    const norm = normalizeShopeeGMV(raw);
    if (!/^\d+$/.test(norm)) continue;
    const score = norm.length;
    if (!best || score > best.score) {
      best = { line, score };
    }
  }
  return best ? best.line : null;
};

const encodeStartForForm = (s: string) => encodeURIComponent(s || '');

const logMissingFields = (platform: Platform, obj: any) => {
  // stub: bạn có hệ thống log riêng có thể thay ở đây
  // console.debug(`[${platform}]`, obj);
};

const isTimeLike = (s: string) =>
  /([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/.test(s) ||
  /\d{2}:\d{2}:\d{2}\s+\d{2}[-\/]\d{2}[-\/]\d{4}/.test(s) ||
  /\bUTC\b/.test(s);

const rectOf = (arr: VWord[]) => {
  const x0 = Math.min(...arr.map(w => w.x0));
  const x1 = Math.max(...arr.map(w => w.x1));
  const y0 = Math.min(...arr.map(w => w.y0));
  const y1 = Math.max(...arr.map(w => w.y1));
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
};

const estimateCharW = (all: VWord[]) => {
  const widths = all.map(w => w.w).filter(n => n > 0).sort((a, b) => a - b);
  if (!widths.length) return 10;
  const mid = widths[Math.floor(widths.length / 2)];
  return Math.max(6, Math.min(24, mid));
};

const makeBand = (cx: number, charW: number, scale = 6) => {
  const half = Math.max(140, charW * scale);
  return { left: cx - half, right: cx + half };
};

const inBand = (w: VWord, band: { left: number; right: number }) =>
  w.cx >= band.left && w.cx <= band.right;

const getLabelRect = (all: VWord[], re: RegExp) => {
  const idx = all.findIndex(w => re.test(w.text));
  if (idx < 0) return null;
  const row = all.filter(w => sameRow(w, all[idx]));
  return rectOf(row);
};

const STAT_LABELS: RegExp[] = [
  /L[uư][oơ]t\s*xem.*1\s*ph[uú]t/i,
  /B[iì]nh\s*l[uư][aă]n/i,
  /Th[êe]m\s*v[àa]o\s*gi[ỏo]\s*h[àa]ng/i
];

const getStatsBelt = (all: VWord[]) => {
  const rects = STAT_LABELS.map(re => getLabelRect(all, re)).filter(Boolean) as ReturnType<typeof rectOf>[];
  if (!rects.length) return null;
  const y0 = Math.min(...rects.map(r => r.y0));
  const y1 = Math.max(...rects.map(r => r.y1));
  const x0 = Math.min(...rects.map(r => r.x0));
  const x1 = Math.max(...rects.map(r => r.x1));
  return { x0, x1, y0, y1 };
};

const GPM_LABELS: RegExp[] = [
  /GPM\s*\(\s*[đd]\s*\)/i,
  /\bGPM\b/i,
  /L[ơo]i\s*nh[uư][aâ]n/i,
  /Bi[êe]n\s*l[ơo]i\s*nh[uư][aâ]n/i,
  /Gross\s*Profit/i,
  /Margin/i
];

const getGpmRects = (all: VWord[]) => {
  const rects = GPM_LABELS.map(re => getLabelRect(all, re)).filter(Boolean) as ReturnType<typeof rectOf>[];
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map(r => r.x0));
  const x1 = Math.max(...rects.map(r => r.x1));
  const y0 = Math.min(...rects.map(r => r.y0));
  const y1 = Math.max(...rects.map(r => r.y1));
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2 };
};

const isLikelyGPMLine = (s: string) => {
  const norm = normalizeShopeeGMV(s);
  if (/(\bGPM\b|\bGross\b|\bMargin\b|L[ơo]i\s*nh[uư][aâ]n|Bi[êe]n\s*l[ơo]i\s*nh[uư][aâ]n)/i.test(s)) return true;
  if (/^\d+$/.test(norm) && norm.length <= 4) return true;
  if (/[–-]\s*\d/.test(s)) return true;
  return false;
};

const extractTikTokFromVision = (result: any) => {
  const anns = result.textAnnotations || [];
  const words = toWords(anns);
  const fullText = anns[0]?.description || '';
  const imageW = Math.max(...words.map(w => w.x1), 0);
  const width = imageW > 0 ? imageW : 1;
  const leftThreshold = width * 0.55;

  const lineGroups = groupWordsByLine(words);

  const monthMap = new Map([
    ['jan', 'Jan'],
    ['feb', 'Feb'],
    ['mar', 'Mar'],
    ['apr', 'Apr'],
    ['may', 'May'],
    ['jun', 'Jun'],
    ['jul', 'Jul'],
    ['aug', 'Aug'],
    ['sep', 'Sep'],
    ['oct', 'Oct'],
    ['nov', 'Nov'],
    ['dec', 'Dec']
  ]);

  const collectTime = (line: VWord[], startIdx: number) => {
    const parts: string[] = [];
    let endIdx = startIdx - 1;
    for (let idx = startIdx; idx < line.length && parts.length < 5; idx += 1) {
      const raw = (line[idx].text || '').trim();
      if (!raw) continue;
      if (/UTC/i.test(raw)) return null;
      if (!/[0-9:]/.test(raw)) break;
      const cleaned = raw.replace(/[^0-9:]/g, '');
      if (!cleaned) break;
      parts.push(cleaned);
      const normalized = parts
        .join(' ')
        .replace(/\s*:\s*/g, ':')
        .replace(/\s+/g, ' ')
        .trim();
      const match = normalized.match(/\b\d{2}:\d{2}:\d{2}\b/);
      if (match) {
        endIdx = idx;
        return { value: match[0], endIdx };
      }
    }
    return null;
  };

  type StartCandidate = { text: string; x: number; priority: number };
  const startCandidates: StartCandidate[] = [];

  for (const line of lineGroups) {
    for (let i = 0; i < line.length; i += 1) {
      const monthRaw = (line[i].text || '').replace(/[^A-Za-z]/g, '').toLowerCase();
      const month = monthMap.get(monthRaw);
      if (!month) continue;
      const dayWord = line[i + 1];
      if (!dayWord) continue;
      const dayDigits = (dayWord.text || '').replace(/\D+/g, '');
      if (!dayDigits) continue;

      const timeResult = collectTime(line, i + 2);
      if (!timeResult) continue;

      const usedWords = line.slice(i, timeResult.endIdx + 1);
      if (!usedWords.length) continue;
      if (usedWords.some(w => /UTC/i.test(w.text))) continue;

      const maxCx = Math.max(...usedWords.map(w => w.cx));
      if (maxCx > leftThreshold) continue;

      const minCx = Math.min(...usedWords.map(w => w.cx));
      const priority = i === 0 ? 0 : 1;
      startCandidates.push({
        text: `${month} ${dayDigits} ${timeResult.value}`.replace(/\s+/g, ' ').trim(),
        x: minCx,
        priority
      });
    }
  }

  startCandidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.x !== b.x) return a.x - b.x;
    return 0;
  });

  let startTime = startCandidates[0]?.text || '';

  if (!startTime) {
    const lineMatch = fullText
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/\s*:\s*/g, ':'))
      .find(s => !/UTC/i.test(s) && /[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/.test(s));
    if (lineMatch) {
      const m = lineMatch.match(/([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/);
      if (m) startTime = m[1];
    }
  }

  if (!startTime) {
    const m = fullText
      .replace(/\s*:\s*/g, ':')
      .match(/([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})(?![^\n]*UTC)/);
    if (m) startTime = m[1];
  }

  const labelIdx = words.findIndex(w => /GMV/i.test(w.text));
  let gmv = '';
  if (labelIdx >= 0) {
    const labelRow = words.filter(w => sameRow(w, words[labelIdx]));
    const labelRightEdge = Math.max(...labelRow.map(w => w.x1));
    const belowRow = words
      .filter(w => below(w, words[labelIdx], 2) && w.x0 >= labelRightEdge - 60);
    const candidateLine = selectLineCandidate(groupWordsByLine(belowRow));
    if (candidateLine) {
      const text = joinLine(candidateLine);
      const normalized = text.replace(/\s*:\s*/g, ':');
      if (!isTimeLike(normalized) && !/:/.test(normalized)) gmv = digitsOnly(normalized);
    }
  }

  if (!gmv) {
    const lines = fullText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const nums = lines
      .map(s => s.replace(/\s*:\s*/g, ':'))
      .filter(s => !isTimeLike(s) && !/:/.test(s))
      .map(s => digitsOnly(s))
      .filter(n => /^\d+$/.test(n));
    gmv = nums.sort((a, b) => b.length - a.length)[0] || '';
  }

  let orders = '';
  const ordersIdx = words.findIndex(w => /Orders?/i.test(w.text) || /Đơn/i.test(w.text));
  if (ordersIdx >= 0) {
    const label = words[ordersIdx];
    const labelRow = words.filter(w => sameRow(w, label));
    const labelRight = Math.max(...labelRow.map(w => w.x1));
    const sameRowRight = labelRow.filter(w => rightOf(w, label)).sort((a, b) => a.cx - b.cx);
    const rightDigits = digitsOnly(joinLine(sameRowRight));
    if (rightDigits) {
      orders = rightDigits;
    }
    if (!orders) {
      const belowWords = words.filter(w =>
        below(w, label, 2) &&
        w.x0 >= label.x0 - 40 &&
        w.x1 <= labelRight + 200
      );
      const candidateLine = selectLineCandidate(groupWordsByLine(belowWords));
      if (candidateLine) {
        const digits = digitsOnly(joinLine(candidateLine));
        if (digits) orders = digits;
      }
    }
  }

  if (!orders) {
    const orderLine = fullText
      .split(/\r?\n/)
      .map(s => s.trim())
      .map(s => s.replace(/\s*:\s*/g, ':'))
      .find(s => (/Orders?/i.test(s) || /Đơn/i.test(s)) && !/:/.test(s));
    if (orderLine) {
      const digits = digitsOnly(orderLine);
      if (digits) orders = digits;
    }
  }

  logMissingFields('tiktok', { gmv, orders, startTime });

  return {
    platformDetected: 'tiktok' as const,
    gmv,
    gmvCandidates: [],
    needsReview: false,
    orders,
    startTime,
    startTimeEncoded: encodeStartForForm(startTime),
    recognizedText: fullText || '',
    sessionId: ''
  };
};

const extractShopeeFromVision = (result: any, opts: ExtractOpts = {}) => {
  const anns = result?.textAnnotations || [];
  const words = toWords(anns);
  const fullText = anns[0]?.description || '';

  const ambiguityMode = opts.ambiguityMode || 'auto';
  const gmvOverride = (opts.gmvOverride || '').replace(/\D+/g, '') || '';

  let gmv = '';
  let gmvCandidates: string[] = [];
  let needsReview = false;

  {
    const dtRect = getLabelRect(words, /Doanh\s*thu/i);
    const gpmRectMerged = getGpmRects(words);
    const statsBelt = getStatsBelt(words);

    if (dtRect) {
      const charW = estimateCharW(words);
      const dtBand = makeBand(dtRect.cx, charW, 5.5);

      const belowWords = words.filter(w => {
        const under = w.cy > dtRect.y1 + Math.max(w.h, 8);
        const inCol = inBand(w, dtBand);
        const aboveBelt = !statsBelt || w.y1 < statsBelt.y0 - 6;
        return under && inCol && aboveBelt;
      });

      const grouped = groupWordsByLine(belowWords)
        .map(line => {
          const top = Math.min(...line.map(w => w.y0));
          return { line, top, deltaY: top - dtRect.y1 };
        })
        .filter(x => x.deltaY >= 0)
        .sort((a, b) => a.deltaY - b.deltaY)
        .slice(0, 2)
        .map(x => x.line);

      type Cand = {
        normalized: string;
        score: number;
        raw: string;
        lineTop: number;
        lineCx: number;
        inGpmCol: boolean;
      };
      const candidates: Cand[] = [];

      for (const line of grouped) {
        const raw = joinLine(line);
        if (!raw || /:/.test(raw)) continue;
        if (isLikelyGPMLine(raw)) continue;
        if (!/\d/.test(raw)) continue;

        const normalized = normalizeShopeeGMV(raw);
        if (!/^\d+$/.test(normalized)) continue;

        const centers = line.map(w => w.cx);
        const lineCx = centers.reduce((s, v) => s + v, 0) / centers.length;
        const lineTop = Math.min(...line.map(w => w.y0));

        let inGpmCol = false;
        let gpmPenalty = 0;
        if (gpmRectMerged) {
          inGpmCol = lineCx >= gpmRectMerged.x0 && lineCx <= gpmRectMerged.x1;
          if (inGpmCol) {
            gpmPenalty += 2.2;
          }
        }

        const len = normalized.length;
        const distToDT = Math.abs(lineCx - dtRect.cx) / 100;
        const deltaY = lineTop - dtRect.y1;
        const verticalBonus = (Math.max(0, 180 - Math.min(360, deltaY)) / 180) * 0.9;

        let beltPenalty = 0;
        if (statsBelt && lineTop >= statsBelt.y0 - 8) beltPenalty = 3.0;

        const score = len + verticalBonus - distToDT - gpmPenalty - beltPenalty;
        candidates.push({ normalized, score, raw, lineTop, lineCx, inGpmCol });
      }

      if (candidates.length) {
        candidates.sort((a, b) => b.score - a.score);
        const top1 = candidates[0];

        if (!gmv && top1) {
          gmv = top1.normalized;
        }

        if (gmvOverride) {
          const best = candidates.find(c => c.normalized === gmvOverride);
          if (best) gmv = best.normalized;
          else if (/^\d+$/.test(gmvOverride)) gmv = gmvOverride;
        }

        if (ambiguityMode === 'returnBoth') {
          const preferred: string[] = [];
          const normalizedOverride = gmvOverride && /^\d+$/.test(gmvOverride) ? gmvOverride : '';

          if (gmv) preferred.push(gmv);
          if (normalizedOverride && normalizedOverride !== gmv) {
            preferred.push(normalizedOverride);
          }

          for (const cand of candidates.slice(0, 4)) {
            if (cand.normalized && cand.normalized !== gmv) {
              preferred.push(cand.normalized);
            }
          }

          for (const cand of candidates) {
            if (cand.normalized) preferred.push(cand.normalized);
          }

          const unique = Array.from(new Set(preferred.filter(Boolean)));
          if (unique.length) {
            gmvCandidates = unique.slice(0, 4);
            if (gmvCandidates.length >= 2) {
              needsReview = true;
            }
          }
        }
      } else if (gmvOverride && /^\d+$/.test(gmvOverride)) {
        gmv = gmvOverride;
      }
    }

    if (!gmv) {
      const lines = (fullText || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const scored = lines
        .map((s, i, arr) => {
          if (!/\d/.test(s) || /:/.test(s)) return null;
          if (isLikelyGPMLine(s)) return null;

          const norm = normalizeShopeeGMV(s);
          if (!/^\d+$/.test(norm)) return null;

          const nearDT =
            /Doanh\s*thu/i.test(arr[i - 1] || '') ||
            /Doanh\s*thu/i.test(arr[i + 1] || '');
          const score = norm.length + (nearDT ? 0.7 : 0);
          return { norm, score };
        })
        .filter(Boolean) as { norm: string; score: number }[];

      if (scored.length) {
        scored.sort((a, b) => b.score - a.score);
        gmv = scored[0].norm;
      }
    }
  }

  let orders = '';
  {
    const orderIdx = words.findIndex(w => /Đơn\s*hàng/i.test(w.text));
    if (orderIdx >= 0) {
      const label = words[orderIdx];
      const labelRow = words.filter(w => sameRow(w, label));
      const labelLeft = Math.min(...labelRow.map(w => w.x0));
      const labelRight = Math.max(...labelRow.map(w => w.x1));

      const sameRowRight = labelRow
        .filter(w => rightOf(w, label))
        .sort((a, b) => a.cx - b.cx);
      const rightDigits = digitsOnly(joinLine(sameRowRight));
      if (rightDigits) orders = rightDigits;

      if (!orders) {
        const belowWords = words.filter(w =>
          below(w, label, 2) &&
          w.x0 >= labelLeft - 40 &&
          w.x1 <= labelRight + 220
        );
        const candidateLine = selectLineCandidate(groupWordsByLine(belowWords));
        if (candidateLine) {
          const digits = digitsOnly(joinLine(candidateLine));
          if (digits) orders = digits;
        }
      }
    }

    if (!orders) {
      const orderLine = (fullText || '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .map(s => s.replace(/\s*:\s*/g, ':'))
        .find(s => (/Đơn\s*hàng/i.test(s) || /Orders?/i.test(s)) && !/:/.test(s));
      if (orderLine) {
        const digits = digitsOnly(orderLine);
        if (digits) orders = digits;
      }
    }
  }

  let startTime = '';
  {
    const labelStart =
      words.find(w => /Bắt\s*đầu\s*lúc/i.test(w.text)) ||
      words.find(w => /Bat\s*dau\s*luc/i.test(w.text));
    if (labelStart) {
      const sameRowWords = words.filter(w => sameRow(w, labelStart));
      const rightWords = sameRowWords
        .filter(w => rightOf(w, labelStart))
        .sort((a, b) => a.cx - b.cx);
      let line = joinLine(rightWords);
      const parts = line.split(':');
      if (parts.length > 1) line = parts.slice(1).join(':').trim();

      if (!/\d{4}$/.test(line)) {
        const nextRow = words.filter(
          w => below(w, labelStart, 2) && w.x0 > labelStart.x0 + labelStart.w / 2
        );
        const nextLine = joinLine(nextRow);
        if (/\d{2}[-\/]\d{2}[-\/]\d{4}/.test(nextLine)) {
          line = `${line} ${nextLine}`.trim();
        }
      }
      startTime = line;
    } else {
      const m =
        fullText.match(/Bắt\s*đầu\s*lúc[:：]?\s*([0-9:]{8}\s+\d{2}[-\/]\d{2}[-\/]\d{4})/i) ||
        fullText.match(/Bat\s*dau\s*luc[:：]?\s*([0-9:]{8}\s+\d{2}[-\/]\d{2}[-\/]\d{4})/i);
      if (m) startTime = m[1];
    }
  }

  logMissingFields('shopee', { gmv, gmvCandidates, needsReview, orders, startTime });

  return {
    platformDetected: 'shopee' as const,
    gmv,
    gmvCandidates,
    needsReview,
    orders,
    startTime,
    startTimeEncoded: encodeStartForForm(startTime),
    recognizedText: fullText || '',
    sessionId: ''
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<OcrResponse>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  try {
    const { imagesBase64, platform, options } = req.body as {
      imagesBase64?: string[];
      platform?: string;
      options?: ExtractOpts;
    };
    const client = getVisionClient();

    const base64List = Array.isArray(imagesBase64)
      ? imagesBase64.filter(item => typeof item === 'string' && item.trim())
      : [];

    if (!base64List.length) {
      return res.status(400).json({ ok: false, error: 'Thiếu ảnh để OCR.' });
    }

    const buffers: Buffer[] = [];
    for (const item of base64List) {
      const cleaned = item.trim();
      if (!cleaned) continue;
      const content = cleaned.replace(/^data:image\/\w+;base64,/, '');
      try {
        const buffer = Buffer.from(content, 'base64');
        if (buffer.length) {
          buffers.push(buffer);
        }
      } catch (err) {
        // bỏ qua chunk không hợp lệ
      }
    }

    if (!buffers.length) {
      return res.status(400).json({ ok: false, error: 'Không có dữ liệu ảnh để OCR.' });
    }

    const normalizedPlatform: Platform | null =
      platform === 'tiktok' || platform === 'shopee' ? platform : null;

    if (!normalizedPlatform) {
      return res.status(400).json({ ok: false, error: 'Không xác định được sàn để OCR.' });
    }

    const rawOptions = options && typeof options === 'object' ? options : undefined;
    const extractOptions: ExtractOpts | undefined = rawOptions
      ? {
          ambiguityMode:
            rawOptions.ambiguityMode === 'returnBoth'
              ? 'returnBoth'
              : rawOptions.ambiguityMode === 'auto'
                ? 'auto'
                : undefined,
          gmvOverride:
            typeof rawOptions.gmvOverride === 'string'
              ? rawOptions.gmvOverride
              : rawOptions.gmvOverride === null
                ? null
                : undefined
        }
      : undefined;

    const detections = await Promise.all(
      buffers.map(buffer =>
        client.textDetection({
          image: { content: buffer }
        })
      )
    );

    const visionResults = detections
      .map(resultArray => (Array.isArray(resultArray) ? resultArray[0] : null))
      .filter(Boolean) as any[];

    if (!visionResults.length) {
      return res.status(400).json({ ok: false, error: 'Không trích xuất được dữ liệu.' });
    }

    const primaryResult = visionResults[0];
    const recognizedTexts = visionResults.map(result => {
      const full = result?.textAnnotations?.[0]?.description || '';
      return typeof full === 'string' ? full : '';
    });

    const baseData = normalizedPlatform === 'tiktok'
      ? extractTikTokFromVision(primaryResult)
      : extractShopeeFromVision(primaryResult, extractOptions);

    const aggregatedText = recognizedTexts.filter(Boolean).join('\n\n');
    const sessionIdRaw = extractSessionIdFromTexts(recognizedTexts, normalizedPlatform);
    const sessionId = digitsOnly(sessionIdRaw);

    const data: OcrSuccessData = {
      ...baseData,
      recognizedText: aggregatedText || baseData.recognizedText || '',
      sessionId
    };

    return res.status(200).json({
      ok: true,
      data
    });
  } catch (error: any) {
    console.error('Vision OCR failed', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Unexpected error' });
  }
}
