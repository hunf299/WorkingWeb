const DEFAULT_LANG = 'vie+eng';

export function preprocessToDataURL(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const contrasted = Math.min(255, Math.max(0, (gray - 128) * 1.35 + 128));
    data[i] = contrasted;
    data[i + 1] = contrasted;
    data[i + 2] = contrasted;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function mapWords(data) {
  if (!data?.words) return [];
  return data.words
    .map(word => {
      const text = (word.text || '').trim();
      if (!text) return null;
      const bbox = word.bbox || {};
      return {
        text,
        x: bbox.x0 || 0,
        y: bbox.y0 || 0,
        w: Math.max(0, (bbox.x1 || 0) - (bbox.x0 || 0)),
        h: Math.max(0, (bbox.y1 || 0) - (bbox.y0 || 0)),
        conf: word.conf
      };
    })
    .filter(Boolean);
}

async function ocrTSV(Tesseract, dataURL) {
  const { data } = await Tesseract.recognize(dataURL, DEFAULT_LANG, { logger: () => {} });
  return mapWords(data);
}

function pad(box, padding = 10, maxW = Infinity, maxH = Infinity) {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  const w = Math.min(maxW - x, box.w + padding * 2);
  const h = Math.min(maxH - y, box.h + padding * 2);
  return { ...box, x, y, w, h };
}

function cropBoxToDataURL(img, box) {
  const canvas = document.createElement('canvas');
  const width = Math.max(1, Math.floor(box.w));
  const height = Math.max(1, Math.floor(box.h));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, width, height);
  return preprocessToDataURL(canvas);
}

async function ocrLine(Tesseract, dataURL, whitelist) {
  const { data } = await Tesseract.recognize(dataURL, DEFAULT_LANG, {
    tessedit_char_whitelist: whitelist,
    tessedit_pageseg_mode: 7
  });
  return (data?.text || '').replace(/\s+/g, ' ').trim();
}

async function extractTikTok(Tesseract, img, options = {}) {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const full = options.full || preprocessToDataURL(img);
  const words = options.words || await ocrTSV(Tesseract, full);

  const timeRe = /([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/;
  let timeBoxes = words.filter(box => timeRe.test(box.text) && !/UTC/i.test(box.text));
  const leftHalf = timeBoxes.filter(box => box.x < W * 0.5);
  if (leftHalf.length) {
    timeBoxes = leftHalf;
  }
  const timeBox = timeBoxes.sort((a, b) => (a.x - b.x) || (a.y - b.y))[0];
  let startTime = '';
  if (timeBox) {
    const crop = cropBoxToDataURL(img, pad(timeBox, 10, W, H));
    startTime = await ocrLine(
      Tesseract,
      crop,
      '0123456789: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    );
  }

  const label = words.find(box => /GMV\s+trực\s+tiếp\s*\(đ\)/i.test(box.text))
    || words.find(box => /\bGMV\b/i.test(box.text));

  let gmv = '';
  if (label) {
    const x = Math.max(0, label.x - 40);
    const y = label.y + label.h + 12;
    const w = Math.min(W - x, Math.max(label.w + 300, W * 0.35));
    const h = Math.min(H - y, H * 0.18);
    const crop = cropBoxToDataURL(img, { text: '', x, y, w, h });
    const raw = await ocrLine(Tesseract, crop, '0123456789.,');
    gmv = raw.replace(/[^\d]/g, '');
  } else {
    const x = Math.round(W * 0.3);
    const y = Math.round(H * 0.28);
    const w = Math.round(W * 0.4);
    const h = Math.round(H * 0.22);
    const crop = cropBoxToDataURL(img, { text: '', x, y, w, h });
    const raw = await ocrLine(Tesseract, crop, '0123456789.,');
    gmv = raw.replace(/[^\d]/g, '');
  }

  return { platform: 'tiktok', gmv, startTime };
}

async function extractShopee(Tesseract, img, options = {}) {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const full = options.full || preprocessToDataURL(img);
  const words = options.words || await ocrTSV(Tesseract, full);

  const gmvLabel = words.find(box => /Doanh\s*thu\s*\(đ\)/i.test(box.text));
  let gmv = '';
  if (gmvLabel) {
    const x = Math.max(0, gmvLabel.x - 0.02 * W);
    const y = gmvLabel.y + gmvLabel.h + 0.02 * H;
    const w = Math.min(W - x, gmvLabel.w + 0.18 * W);
    const h = 0.12 * H;
    const crop = cropBoxToDataURL(img, {
      text: '',
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h)
    });
    const raw = await ocrLine(Tesseract, crop, '0123456789.,');
    gmv = raw.replace(/[^\d]/g, '');
  }

  let startLabel = words.find(box => /Bắt\s*đầu\s*lúc\s*:*/i.test(box.text))
    || words.find(box => /Bat\s*dau\s*luc\s*:*/i.test(box.text));
  let startTime = '';
  if (startLabel) {
    const x = startLabel.x + startLabel.w + 8;
    const y = Math.max(0, startLabel.y - 4);
    const w = Math.min(W - x, 0.22 * W);
    const h = startLabel.h + 12;
    const crop = cropBoxToDataURL(img, { text: '', x, y, w, h });
    let raw = await ocrLine(
      Tesseract,
      crop,
      '0123456789: -/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    );
    const parts = raw.split(':');
    if (parts.length > 1 && /Bat|Bắt/i.test(parts[0])) {
      raw = parts.slice(1).join(':').trim();
    }
    startTime = raw;
  } else {
    const x = Math.round(W * 0.76);
    const y = Math.round(H * 0.75);
    const w = Math.round(W * 0.22);
    const h = Math.round(H * 0.08);
    const crop = cropBoxToDataURL(img, { text: '', x, y, w, h });
    const raw = await ocrLine(
      Tesseract,
      crop,
      '0123456789: -/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    );
    const match = raw.match(/\d{2}:\d{2}:\d{2}\s+\d{2}[-\/]\d{2}[-\/]\d{4}/);
    startTime = (match && match[0]) || raw.trim();
  }

  return { platform: 'shopee', gmv, startTime };
}

export async function extractFromImage(Tesseract, img) {
  const full = preprocessToDataURL(img);
  const words = await ocrTSV(Tesseract, full);
  const hasTikTok = words.some(box => /GMV\s+trực\s+tiếp/i.test(box.text) || /\bGMV\b/i.test(box.text));
  const hasShopee = words.some(box => /Doanh\s*thu\s*\(đ\)/i.test(box.text))
    || words.some(box => /Bắt\s*đầu\s*lúc/i.test(box.text))
    || words.some(box => /Bat\s*dau\s*luc/i.test(box.text));

  if (hasTikTok && !hasShopee) {
    return extractTikTok(Tesseract, img, { full, words });
  }
  if (hasShopee && !hasTikTok) {
    return extractShopee(Tesseract, img, { full, words });
  }
  const tiktok = await extractTikTok(Tesseract, img, { full, words });
  if (tiktok.gmv || tiktok.startTime) {
    return tiktok;
  }
  return extractShopee(Tesseract, img, { full, words });
}
