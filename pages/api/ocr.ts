import type { NextApiRequest, NextApiResponse } from 'next';
import { getVisionClient } from '../../lib/visionClient';

type Platform = 'tiktok' | 'shopee';

type OcrSuccessData = {
  gmv: string;
  orders: string;
  startTime: string;
  startTimeEncoded: string;
  platformDetected: Platform;
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
  const cleaned = s.replace(/[\s.]/g, '');
  const [beforeComma] = cleaned.split(',');
  return digitsOnly(beforeComma);
};

const isTimeLike = (s: string) =>
  /([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/.test(s) ||
  /\d{2}:\d{2}:\d{2}\s+\d{2}[-\/]\d{2}[-\/]\d{4}/.test(s) ||
  /\bUTC\b/.test(s);

const joinLine = (ws: VWord[]) =>
  ws.sort((a, b) => a.cx - b.cx).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();

const groupWordsByLine = (words: VWord[]) => {
  const map = new Map<number, VWord[]>();
  for (const w of words) {
    const key = Math.round(w.cy / 12);
    const arr = map.get(key) || [];
    arr.push(w);
    map.set(key, arr);
  }
  return Array.from(map.values())
    .map(line => line.slice().sort((a, b) => a.cx - b.cx))
    .sort((a, b) => (a[0]?.cy || 0) - (b[0]?.cy || 0));
};

const selectLineCandidate = (lines: VWord[][], options: { excludeGpm?: boolean } = {}) => {
  const scored = lines
    .filter(line => line.length > 0)
    .map(line => ({ line, avgH: line.reduce((sum, w) => sum + w.h, 0) / line.length }));
  scored.sort((a, b) => b.avgH - a.avgH);
  if (options.excludeGpm) {
    const withoutGpm = scored.find(entry => !entry.line.some(w => /GPM/i.test(w.text)));
    if (withoutGpm) return withoutGpm.line;
  }
  return scored[0]?.line || null;
};

const filterOutGpmWords = (line: VWord[]) => line.filter(w => !/GM[PM]/i.test(w.text));

const logMissingFields = (platform: Platform, fields: Record<string, string>) => {
  const missing = Object.entries(fields).filter(([, value]) => !value);
  if (!missing.length) return;
  console.warn(`[OCR] Missing fields for ${platform}`, {
    missing: missing.map(([key]) => key),
    extracted: fields
  });
};

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
    orders,
    startTime,
    startTimeEncoded: encodeStartForForm(startTime)
  };
};

const extractShopeeFromVision = (result: any) => {
  const anns = result.textAnnotations || [];
  const words = toWords(anns);
  const fullText = anns[0]?.description || '';

  // ========= Helpers cục bộ (chỉ dùng trong hàm) =========
  const rectOf = (arr: VWord[]) => {
    const x0 = Math.min(...arr.map(w => w.x0));
    const x1 = Math.max(...arr.map(w => w.x1));
    const y0 = Math.min(...arr.map(w => w.y0));
    const y1 = Math.max(...arr.map(w => w.y1));
    return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  };

  const getLabelRect = (all: VWord[], re: RegExp) => {
    const idx = all.findIndex(w => re.test(w.text));
    if (idx < 0) return null;
    const row = all.filter(w => sameRow(w, all[idx]));
    return rectOf(row);
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
    (w.cx >= band.left && w.cx <= band.right);

  const STAT_LABELS: RegExp[] = [
    /L[uư][oơ]t\s*xem.*1\s*ph[uú]t/i,           // "Lượt xem live >1 phút" (nới dấu)
    /B[iì]nh\s*l[uư][aă]n/i,                   // "Bình luận"
    /Th[êe]m\s*v[àa]o\s*gi[ỏo]\s*h[àa]ng/i     // "Thêm vào giỏ hàng"
  ];

  const getStatsBelt = (all: VWord[]) => {
    const rects = STAT_LABELS
      .map(re => getLabelRect(all, re))
      .filter((r): r is ReturnType<typeof rectOf> => !!r);

    if (!rects.length) return null;
    const y0 = Math.min(...rects.map(r => r.y0));
    const y1 = Math.max(...rects.map(r => r.y1));
    const x0 = Math.min(...rects.map(r => r.x0));
    const x1 = Math.max(...rects.map(r => r.x1));
    return { x0, x1, y0, y1 };
  };
  // =======================================================

  // -------- GMV (Doanh thu) --------
  let gmv = '';
  {
    const dtRect = getLabelRect(words, /Doanh\s*thu/i);
    const gpmRect = getLabelRect(words, /GM[PM]/i);
    const statsBelt = getStatsBelt(words);

    if (dtRect) {
      const charW = estimateCharW(words);
      const dtBand = makeBand(dtRect.cx, charW, 6);
      const gpmBand = gpmRect ? makeBand(gpmRect.cx, charW, 6) : null;

      // Chỉ lấy những từ ngay dưới nhãn "Doanh thu" và trong băng cột của nó
      const belowWords = words.filter(w =>
        w.cy > dtRect.y1 + Math.max(w.h, 8) && inBand(w, dtBand)
      );

      const lineGroups = groupWordsByLine(belowWords);
      type Cand = { normalized: string; score: number };
      const candidates: Cand[] = [];

      for (const line of lineGroups) {
        const raw = joinLine(line);
        if (!raw || /:/.test(raw)) continue;   // tránh dòng thời gian / nhãn có :
        if (!/\d/.test(raw)) continue;         // phải có số

        const normalized = normalizeShopeeGMV(raw);
        if (!/^\d+$/.test(normalized)) continue;

        const centers = line.map(w => w.cx);
        const lineCx = centers.reduce((s, v) => s + v, 0) / centers.length;
        const lineTop = Math.min(...line.map(w => w.y0));

        // Điểm hoá:
        // + len: số dài (GMV) tốt
        // + verticalBonus: càng gần ngay dưới nhãn càng tốt
        // - distToDT: lệch cột Doanh thu bị trừ
        // - gpmPenalty: nếu rơi trong băng cột của GPM bị trừ
        // - beltPenalty: nếu chạm/ở dưới "vành đai chỉ số" → trừ mạnh (vì thường là vùng GPM)
        const len = normalized.length;

        const distToDT = Math.abs(lineCx - dtRect.cx) / 100; // penalty nhẹ
        const deltaY = lineTop - dtRect.y1;
        const verticalBonus = Math.max(0, 220 - Math.min(420, deltaY)) / 220 * 0.8; // 0..0.8

        let gpmPenalty = 0;
        if (gpmBand && lineCx >= gpmBand.left && lineCx <= gpmBand.right) gpmPenalty += 1;

        let beltPenalty = 0;
        if (statsBelt && lineTop >= statsBelt.y0 - 8) {
          beltPenalty = 2.5; // có thể tăng 3–4 nếu còn “ăn nhầm” GPM
        }

        const score = len + verticalBonus - distToDT - gpmPenalty - beltPenalty;
        candidates.push({ normalized, score });
      }

      if (candidates.length) {
        candidates.sort((a, b) => b.score - a.score);
        gmv = candidates[0].normalized;
      }
    }

    // Fallback toàn văn: ưu tiên số dài gần dòng "Doanh thu"
    if (!gmv) {
      const lines = fullText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const scored = lines.map((s, i, arr) => {
        if (!/\d/.test(s) || /:/.test(s)) return null;
        const norm = normalizeShopeeGMV(s);
        if (!/^\d+$/.test(norm)) return null;

        const nearDT =
          /Doanh\s*thu/i.test(arr[i - 1] || '') ||
          /Doanh\s*thu/i.test(arr[i + 1] || '');
        const score = norm.length + (nearDT ? 0.7 : 0);
        return { norm, score };
      }).filter(Boolean) as { norm: string; score: number }[];

      if (scored.length) {
        scored.sort((a, b) => b.score - a.score);
        gmv = scored[0].norm;
      }
    }
  }

  // -------- Orders (Đơn hàng) – giữ nguyên logic cũ, thêm chút nới vùng --------
  let orders = '';
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
    const orderLine = fullText
      .split(/\r?\n/)
      .map(s => s.trim())
      .map(s => s.replace(/\s*:\s*/g, ':'))
      .find(s => (/Đơn\s*hàng/i.test(s) || /Orders?/i.test(s)) && !/:/.test(s));
    if (orderLine) {
      const digits = digitsOnly(orderLine);
      if (digits) orders = digits;
    }
  }

  // -------- Start time (giữ nguyên ý tưởng cũ, nới regex) --------
  let startTime = '';
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

  logMissingFields('shopee', { gmv, orders, startTime });

  return {
    platformDetected: 'shopee' as const,
    gmv,
    orders,
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
    const { imageBase64, platform } = req.body as { imageBase64?: string; platform?: string };
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: 'Missing imageBase64' });
    }

    const client = getVisionClient();
    const content = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(content, 'base64');

    const [result] = await client.textDetection({
      image: { content: imageBuffer }
    });

    const normalizedPlatform: Platform | null =
      platform === 'tiktok' || platform === 'shopee' ? platform : null;

    if (!normalizedPlatform) {
      return res.status(400).json({ ok: false, error: 'Không xác định được sàn để OCR.' });
    }

    const data = normalizedPlatform === 'tiktok'
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
