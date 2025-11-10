import type { NextApiRequest, NextApiResponse } from 'next';
import { getVisionClient } from '../../lib/visionClient';

type Platform = 'tiktok' | 'shopee';

type OcrResponse = {
  ok: true;
  data: {
    gmv: string;
    startTime: string;
    startTimeEncoded: string;
    platformDetected: Platform;
  };
} | {
  ok: false;
  error: string;
};

type VWord = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
};

const toWords = (anns: any[]): VWord[] => {
  return (anns || [])
    .slice(1)
    .filter(a => a.description)
    .map(a => {
      const vs = a.boundingPoly?.vertices || a.boundingPoly?.normalizedVertices || [];
      const xs = vs.map((v: any) => v.x || 0);
      const ys = vs.map((v: any) => v.y || 0);
      const x0 = xs.length ? Math.min(...xs) : 0;
      const y0 = ys.length ? Math.min(...ys) : 0;
      const x1 = xs.length ? Math.max(...xs) : 0;
      const y1 = ys.length ? Math.max(...ys) : 0;
      return {
        text: a.description as string,
        x0,
        y0,
        x1,
        y1,
        cx: (x0 + x1) / 2,
        cy: (y0 + y1) / 2,
        w: x1 - x0,
        h: y1 - y0
      };
    });
};

const digitsOnly = (s: string) => (s || '').replace(/\D+/g, '');

const normalizeShopeeGMV = (s: string) => {
  if (!s) return '';
  const noDots = s.replace(/\./g, '');
  const [beforeComma] = noDots.split(',');
  return digitsOnly(beforeComma);
};

const isTimeLike = (s: string) =>
  /([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/.test(s) ||
  /\d{2}:\d{2}:\d{2}\s+\d{2}[-\/]\d{2}[-\/]\d{4}/.test(s) ||
  /\bUTC\b/.test(s);

const joinLine = (ws: VWord[]) =>
  ws.sort((a, b) => a.cx - b.cx).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();

const sameRow = (a: VWord, b: VWord, tol = 14) =>
  Math.abs(a.cy - b.cy) < tol;

const below = (a: VWord, b: VWord, tol = 6) =>
  a.cy > b.cy + Math.max(a.h, b.h) * 0.4 - tol;

const rightOf = (a: VWord, b: VWord, tol = 6) =>
  a.cx > b.x1 - tol;

const encodeStartForForm = (s: string) =>
  (s || '').trim().replace(/:/g, '%3A').replace(/\s+/g, '+');

const extractTikTokFromVision = (result: any) => {
  const anns = result.textAnnotations || [];
  const words = toWords(anns);
  const fullText = anns[0]?.description || '';
  const imageW = Math.max(...words.map(w => w.x1), 0);
  const width = imageW > 0 ? imageW : 1;
  const leftThreshold = width * 0.55;

  const lineMap = new Map<number, VWord[]>();
  for (const w of words) {
    const key = Math.round(w.cy / 12);
    const arr = lineMap.get(key) || [];
    arr.push(w);
    lineMap.set(key, arr);
  }

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

  const lineGroups = Array.from(lineMap.values()).map(line =>
    line.slice().sort((a, b) => a.cx - b.cx)
  );
  lineGroups.sort((a, b) => (a[0]?.cy || 0) - (b[0]?.cy || 0));

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
    const linesMap = new Map<number, VWord[]>();
    for (const w of belowRow) {
      const key = Math.round(w.cy / 12);
      const arr = linesMap.get(key) || [];
      arr.push(w);
      linesMap.set(key, arr);
    }
    const candidates = Array.from(linesMap.values())
      .map(line => ({ line, avgH: line.reduce((sum, w) => sum + w.h, 0) / line.length }));
    candidates.sort((a, b) => b.avgH - a.avgH);
    if (candidates.length) {
      const text = joinLine(candidates[0].line);
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

  return {
    platformDetected: 'tiktok' as const,
    gmv,
    startTime,
    startTimeEncoded: encodeStartForForm(startTime)
  };
};

const extractShopeeFromVision = (result: any) => {
  const anns = result.textAnnotations || [];
  const words = toWords(anns);
  const fullText = anns[0]?.description || '';

  const labelIdx = words.findIndex(w => /Doanh\s*thu/i.test(w.text));
  let gmv = '';
  if (labelIdx >= 0) {
    const label = words[labelIdx];
    const labelRow = words.filter(w => sameRow(w, label));
    const labelLeft = Math.min(...labelRow.map(w => w.x0));
    const labelRight = Math.max(...labelRow.map(w => w.x1));

    const belowWords = words.filter(w =>
      below(w, label, 2) &&
      w.x0 >= labelLeft - 40 &&
      w.x1 <= labelRight + 300
    );

    const linesMap = new Map<number, VWord[]>();
    for (const w of belowWords) {
      const key = Math.round(w.cy / 12);
      const arr = linesMap.get(key) || [];
      arr.push(w);
      linesMap.set(key, arr);
    }
    const candidates = Array.from(linesMap.values())
      .map(line => ({ line, avgH: line.reduce((sum, w) => sum + w.h, 0) / line.length }));
    candidates.sort((a, b) => b.avgH - a.avgH);

    if (candidates.length) {
      const text = joinLine(candidates[0].line);
      if (!/:/.test(text)) gmv = normalizeShopeeGMV(text);
    }
  }

  if (!gmv) {
    const lines = fullText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const nums = lines
      .filter(s => !/:/.test(s) && !/UTC/i.test(s))
      .map(s => normalizeShopeeGMV(s))
      .filter(n => /^\d+$/.test(n));
    gmv = nums.sort((a, b) => b.length - a.length)[0] || '';
  }

  let startTime = '';
  const labelStart = words.find(w => /Bắt\s*đầu\s*lúc/i.test(w.text)) ||
    words.find(w => /Bat\s*dau\s*luc/i.test(w.text));
  if (labelStart) {
    const sameRowWords = words.filter(w => sameRow(w, labelStart));
    const rightWords = sameRowWords.filter(w => rightOf(w, labelStart)).sort((a, b) => a.cx - b.cx);
    let line = joinLine(rightWords);
    const parts = line.split(':');
    if (parts.length > 1) line = parts.slice(1).join(':').trim();
    if (!/\d{4}$/.test(line)) {
      const nextRow = words.filter(w => below(w, labelStart, 2) && w.x0 > labelStart.x0 + labelStart.w / 2);
      const nextLine = joinLine(nextRow);
      if (/\d{2}[-\/]\d{2}[-\/]\d{4}/.test(nextLine)) line = `${line} ${nextLine}`.trim();
    }
    startTime = line;
  } else {
    const m = fullText.match(/Bắt\s*đầu\s*lúc[:：]?\s*([0-9:]{8}\s+\d{2}[-\/]\d{2}[-\/]\d{4})/i) ||
      fullText.match(/Bat\s*dau\s*luc[:：]?\s*([0-9:]{8}\s+\d{2}[-\/]\d{2}[-\/]\d{4})/i);
    if (m) startTime = m[1];
  }

  return {
    platformDetected: 'shopee' as const,
    gmv,
    startTime,
    startTimeEncoded: encodeStartForForm(startTime)
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<OcrResponse>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  try {
    const { imageBase64, platform } = req.body as { imageBase64?: string; platform?: Platform };
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: 'Missing imageBase64' });
    }

    const client = getVisionClient();
    const content = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const [result] = await client.textDetection({
      image: { content: Buffer.from(content, 'base64') }
    });

    const providedPlatform: Platform | undefined =
      platform === 'tiktok' || platform === 'shopee' ? platform : undefined;

    const full = result.textAnnotations?.[0]?.description?.toLowerCase() || '';
    let platformDetected: Platform = /doanh thu|bắt đầu lúc|bat dau luc/.test(full)
      ? 'shopee'
      : 'tiktok';

    if (providedPlatform && providedPlatform !== platformDetected) {
      console.warn(`Platform mismatch: user=${providedPlatform}, detected=${platformDetected}`);
      platformDetected = providedPlatform;
    }

    const data = platformDetected === 'tiktok'
      ? extractTikTokFromVision(result)
      : extractShopeeFromVision(result);

    return res.status(200).json({
      ok: true,
      data
    });
  } catch (error: any) {
    console.error('Vision OCR failed', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Unexpected error' });
  }
}
