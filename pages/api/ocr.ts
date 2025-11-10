import type { NextApiRequest, NextApiResponse } from 'next';
import { getVisionClient } from '../../lib/visionClient';

type Platform = 'tiktok' | 'shopee';
type DetectedPlatform = Platform | 'unknown';

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

const normalizeGMV = (s: string) => (s || '').replace(/[^\d]/g, '');

const pickLeftHeaderTime = (lines: string[]) => {
  const re = /([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/;
  const candidates = lines.filter(text => re.test(text) && !/UTC/i.test(text));
  return candidates.length ? (candidates[0].match(re)?.[1] || '') : '';
};

const findShopeeStartTime = (text: string) => {
  const vn = text.match(/Bắt\s*đầu\s*lúc[:：]?\s*([0-9:]{8}\s+\d{2}[-\/]\d{2}[-\/]\d{4})/i);
  if (vn) return vn[1];
  const kk = text.match(/Bat\s*dau\s*luc[:：]?\s*([0-9:]{8}\s+\d{2}[-\/]\d{2}[-\/]\d{4})/i);
  return kk ? kk[1] : '';
};

const encodeStartForForm = (s: string) => {
  const trimmed = (s || '').trim();
  return trimmed ? trimmed.replace(/:/g, '%3A').replace(/\s+/g, '+') : '';
};

const detectPlatform = (fullText: string): DetectedPlatform => {
  const text = (fullText || '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('gmv trực tiếp') || text.includes('thời lượng:') || text.includes('room_id=')) {
    return 'tiktok';
  }
  if (text.includes('doanh thu (đ)') || text.includes('bắt đầu lúc') || text.includes('shoppe') || text.includes('doanhthu')) {
    return 'shopee';
  }
  return 'unknown';
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

    const platformInput: Platform | undefined = platform === 'tiktok' || platform === 'shopee'
      ? platform
      : undefined;

    const client = getVisionClient();
    const content = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const [result] = await client.textDetection({
      image: { content: Buffer.from(content, 'base64') }
    });

    const annotations = result.textAnnotations || [];
    const fullText = annotations[0]?.description || '';
    const lines = fullText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    const detected = detectPlatform(fullText);
    if (platformInput && detected !== 'unknown' && detected !== platformInput) {
      console.warn(`Platform mismatch: user=${platformInput}, detected=${detected}`);
    }
    const finalPlatform: Platform = detected !== 'unknown' ? detected : (platformInput || 'tiktok');

    let gmv = '';
    let startTime = '';

    if (finalPlatform === 'tiktok') {
      const idx = lines.findIndex(line => /GMV\s+trực\s+tiếp/i.test(line) || /\bGMV\b/i.test(line));
      if (idx >= 0) {
        for (let k = idx + 1; k <= idx + 3; k += 1) {
          const candidate = lines[k];
          if (!candidate) break;
          const num = normalizeGMV(candidate);
          if (num) {
            gmv = num;
            break;
          }
        }
      }
      if (!gmv) {
        const nums = lines.map(line => normalizeGMV(line)).filter(n => /^\d+$/.test(n));
        gmv = nums.sort((a, b) => b.length - a.length)[0] || '';
      }
      startTime = pickLeftHeaderTime(lines);
    } else {
      const idx = lines.findIndex(line => /Doanh\s*thu\s*\(đ\)/i.test(line));
      if (idx >= 0) {
        for (let k = idx + 1; k <= idx + 3; k += 1) {
          const candidate = lines[k];
          if (!candidate) break;
          const num = normalizeGMV(candidate);
          if (num) {
            gmv = num;
            break;
          }
        }
      }
      if (!gmv) {
        const nums = lines.map(line => normalizeGMV(line)).filter(n => /^\d+$/.test(n));
        gmv = nums.sort((a, b) => b.length - a.length)[0] || '';
      }
      startTime = findShopeeStartTime(fullText);
    }

    const startTimeEncoded = encodeStartForForm(startTime);

    return res.status(200).json({
      ok: true,
      data: {
        gmv,
        startTime,
        startTimeEncoded,
        platformDetected: finalPlatform
      }
    });
  } catch (error: any) {
    console.error('Vision OCR failed', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Unexpected error' });
  }
}
