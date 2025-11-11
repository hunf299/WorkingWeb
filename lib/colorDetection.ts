import { inflateSync } from 'zlib';

type Platform = 'tiktok' | 'shopee';

type DecodedImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  format: 'png' | 'jpeg' | 'unknown';
};

type ColorMetrics = {
  headerDark: number;
  overallDark: number;
  panelAccent: number;
  overallAccent: number;
  headerAccent: number;
  panelOrange: number;
  overallOrange: number;
  panelValid: boolean;
};

type ColorAnalysis = {
  metrics: ColorMetrics;
  tiktokColorPass: boolean;
  shopeeColorPass: boolean;
  colorDecision: Platform | null;
};

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const srgbToLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const rgbToXyz = (r: number, g: number, b: number) => {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
  return { x: x * 100, y: y * 100, z: z * 100 };
};

const xyzToLab = (x: number, y: number, z: number) => {
  const refX = 95.047;
  const refY = 100.0;
  const refZ = 108.883;

  const fx = labPivot(x / refX);
  const fy = labPivot(y / refY);
  const fz = labPivot(z / refZ);

  const L = Math.max(0, 116 * fy - 16);
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return { L, a, b };
};

const labPivot = (t: number) => {
  const delta = 6 / 29;
  if (t > delta ** 3) {
    return Math.cbrt(t);
  }
  return t / (3 * delta * delta) + 4 / 29;
};

const rgbToLab = (r: number, g: number, b: number) => {
  const { x, y, z } = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
};

const deltaE = (a: { L: number; a: number; b: number }, b: { L: number; a: number; b: number }) => {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
};

const rgbToHsv = (r: number, g: number, b: number) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
};

const paethPredictor = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

const applyPngFilter = (
  type: number,
  row: Uint8Array,
  prev: Uint8Array,
  bytesPerPixel: number
) => {
  const result = new Uint8Array(row.length);
  switch (type) {
    case 0:
      result.set(row);
      break;
    case 1:
      for (let i = 0; i < row.length; i += 1) {
        const left = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0;
        result[i] = (row[i] + left) & 0xff;
      }
      break;
    case 2:
      for (let i = 0; i < row.length; i += 1) {
        const up = prev[i] || 0;
        result[i] = (row[i] + up) & 0xff;
      }
      break;
    case 3:
      for (let i = 0; i < row.length; i += 1) {
        const left = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0;
        const up = prev[i] || 0;
        result[i] = (row[i] + Math.floor((left + up) / 2)) & 0xff;
      }
      break;
    case 4:
      for (let i = 0; i < row.length; i += 1) {
        const left = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0;
        const up = prev[i] || 0;
        const upLeft = i >= bytesPerPixel ? prev[i - bytesPerPixel] : 0;
        result[i] = (row[i] + paethPredictor(left, up, upLeft)) & 0xff;
      }
      break;
    default:
      throw new Error(`Unsupported PNG filter type ${type}`);
  }
  return result;
};

const decodePng = (buffer: Buffer): DecodedImage => {
  const data = new Uint8Array(buffer);
  if (data.length < 8 || !PNG_SIGNATURE.every((v, idx) => data[idx] === v)) {
    throw new Error('Invalid PNG signature');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Uint8Array[] = [];

  let offset = 8;
  while (offset < data.length) {
    const length =
      (data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3];
    offset += 4;
    const type = String.fromCharCode(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3]
    );
    offset += 4;
    const chunk = data.subarray(offset, offset + length);
    offset += length + 4; // skip CRC

    if (type === 'IHDR') {
      width =
        (chunk[0] << 24) |
        (chunk[1] << 16) |
        (chunk[2] << 8) |
        chunk[3];
      height =
        (chunk[4] << 24) |
        (chunk[5] << 16) |
        (chunk[6] << 8) |
        chunk[7];
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'IDAT') {
      idatParts.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (interlace !== 0) {
    throw new Error('Interlaced PNGs are not supported');
  }

  if (bitDepth !== 8) {
    throw new Error('Only 8-bit depth PNGs are supported');
  }

  if (colorType !== 6 && colorType !== 2 && colorType !== 0 && colorType !== 4) {
    throw new Error('Unsupported PNG color type');
  }

  const bytesPerPixel =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 2;

  const raw = inflateSync(Buffer.concat(idatParts.map(part => Buffer.from(part))));
  const stride = width * bytesPerPixel;
  const imageData = new Uint8Array(width * height * bytesPerPixel);
  let inPos = 0;
  let outPos = 0;
  const prevRow = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filterType = raw[inPos++];
    const row = raw.subarray(inPos, inPos + stride);
    inPos += stride;
    const recon = applyPngFilter(filterType, row, prevRow, bytesPerPixel);
    imageData.set(recon, outPos);
    prevRow.set(recon);
    outPos += stride;
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  if (colorType === 6 || colorType === 2 || colorType === 0 || colorType === 4) {
    for (let i = 0, j = 0; i < imageData.length; i += bytesPerPixel, j += 4) {
      if (colorType === 6) {
        rgba[j] = imageData[i];
        rgba[j + 1] = imageData[i + 1];
        rgba[j + 2] = imageData[i + 2];
        rgba[j + 3] = imageData[i + 3];
      } else if (colorType === 2) {
        rgba[j] = imageData[i];
        rgba[j + 1] = imageData[i + 1];
        rgba[j + 2] = imageData[i + 2];
        rgba[j + 3] = 255;
      } else if (colorType === 0) {
        const v = imageData[i];
        rgba[j] = v;
        rgba[j + 1] = v;
        rgba[j + 2] = v;
        rgba[j + 3] = 255;
      } else {
        const v = imageData[i];
        rgba[j] = v;
        rgba[j + 1] = v;
        rgba[j + 2] = v;
        rgba[j + 3] = imageData[i + 1];
      }
    }
  }

  return { width, height, data: rgba, format: 'png' };
};

const resizeImage = (img: DecodedImage): DecodedImage => {
  const { width, height, data } = img;
  if (width === 0 || height === 0) {
    return img;
  }
  const desiredWidth = clamp(width, 480, 640);
  if (width <= desiredWidth) {
    return img;
  }
  const scale = desiredWidth / width;
  const newWidth = Math.round(width * scale);
  const newHeight = Math.max(1, Math.round(height * scale));
  const resized = new Uint8ClampedArray(newWidth * newHeight * 4);
  for (let y = 0; y < newHeight; y += 1) {
    const srcY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < newWidth; x += 1) {
      const srcX = Math.min(width - 1, Math.floor(x / scale));
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * newWidth + x) * 4;
      resized[dstIdx] = data[srcIdx];
      resized[dstIdx + 1] = data[srcIdx + 1];
      resized[dstIdx + 2] = data[srcIdx + 2];
      resized[dstIdx + 3] = data[srcIdx + 3];
    }
  }
  return { width: newWidth, height: newHeight, data: resized, format: img.format };
};

const decodeImage = (buffer: Buffer): DecodedImage => {
  if (buffer.length >= 8 && PNG_SIGNATURE.every((v, idx) => buffer[idx] === v)) {
    return decodePng(buffer);
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { width: 0, height: 0, data: new Uint8ClampedArray(), format: 'jpeg' };
  }
  return { width: 0, height: 0, data: new Uint8ClampedArray(), format: 'unknown' };
};

const computeMetrics = (img: DecodedImage, originalWidth: number): ColorAnalysis => {
  const target = resizeImage(img);
  const { width, height, data } = target;
  if (width === 0 || height === 0) {
    return {
      metrics: {
        headerDark: 0,
        overallDark: 0,
        panelAccent: 0,
        overallAccent: 0,
        headerAccent: 0,
        panelOrange: 0,
        overallOrange: 0,
        panelValid: false
      },
      tiktokColorPass: false,
      shopeeColorPass: false,
      colorDecision: null
    };
  }

  const darkTarget = rgbToLab(32, 32, 34);
  const accentTarget = rgbToLab(149, 48, 68);
  const smallImage = originalWidth > 0 && originalWidth < 800;
  const toleranceBoost = (smallImage ? 1.2 : 1) * (img.format === 'jpeg' ? 1.2 : 1);
  const darkDelta = 11 * toleranceBoost;
  const accentDelta = 21 * toleranceBoost;

  const marginX = Math.max(1, Math.round(width * 0.03));
  const marginY = Math.max(1, Math.round(height * 0.03));
  const headerY = Math.round(height * 0.15);
  const panelY0 = Math.round(height * 0.3);
  const panelY1 = Math.round(height * 0.7);
  const panelX0 = Math.round(width * 0.2);
  const panelX1 = Math.round(width * 0.8);

  let total = 0;
  let headerCount = 0;
  let panelCount = 0;

  let darkTotal = 0;
  let darkHeader = 0;
  let accentTotal = 0;
  let accentPanel = 0;
  let accentHeader = 0;
  let orangeTotal = 0;
  let orangePanel = 0;

  for (let y = marginY; y < height - marginY; y += 1) {
    const inHeader = y < headerY;
    const inPanelY = y >= panelY0 && y <= panelY1;
    for (let x = marginX; x < width - marginX; x += 1) {
      const inPanel = inPanelY && x >= panelX0 && x <= panelX1;
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (a < 32) continue;

      total += 1;
      if (inHeader) headerCount += 1;
      if (inPanel) panelCount += 1;

      const lab = rgbToLab(r, g, b);
      const dDark = deltaE(lab, darkTarget);
      if (dDark <= darkDelta) {
        darkTotal += 1;
        if (inHeader) darkHeader += 1;
      }

      const dAccent = deltaE(lab, accentTarget);
      if (dAccent <= accentDelta) {
        accentTotal += 1;
        if (inPanel) accentPanel += 1;
        if (inHeader) accentHeader += 1;
      }

      const { h, s, v } = rgbToHsv(r, g, b);
      if (s >= 0.7 && v >= 0.7) {
        let hue = h;
        if (hue < 0) hue += 360;
        if ((hue >= 10 && hue <= 30) || (hue >= 5 && hue < 10) || (hue > 30 && hue <= 35)) {
          orangeTotal += 1;
          if (inPanel) orangePanel += 1;
        }
      }
    }
  }

  const panelValid = panelCount >= total * 0.05;
  const totalDen = total || 1;
  const headerDen = headerCount || 1;
  const panelDen = panelValid ? panelCount : totalDen;

  const headerDark = darkHeader / headerDen;
  const overallDark = darkTotal / totalDen;
  const panelAccent = accentPanel / panelDen;
  const overallAccent = accentTotal / totalDen;
  const headerAccent = accentHeader / headerDen;
  const panelOrange = orangePanel / panelDen;
  const overallOrange = orangeTotal / totalDen;

  let tiktokColorPass = false;
  const darkPass = headerDark >= 0.35 || overallDark >= 0.28;
  if (darkPass) {
    let accentPass = panelAccent >= 0.04 || overallAccent >= 0.02;
    if (!accentPass && headerDark >= 0.45 && overallAccent >= 0.015) {
      accentPass = true;
    }
    if (headerAccent > 0.08 && headerDark < 0.28) {
      accentPass = false;
    }
    tiktokColorPass = accentPass;
  }

  let shopeeColorPass = false;
  if (panelOrange >= 0.18) {
    shopeeColorPass = true;
  } else if (overallOrange >= 0.08 || panelOrange >= 0.12) {
    shopeeColorPass = true;
  }

  let colorDecision: Platform | null = null;
  if (tiktokColorPass && !shopeeColorPass) {
    colorDecision = 'tiktok';
  } else if (!tiktokColorPass && shopeeColorPass) {
    colorDecision = 'shopee';
  } else if (tiktokColorPass && shopeeColorPass) {
    const tiktokScore = headerDark * 0.6 + Math.max(panelAccent, overallAccent) * 0.4;
    const shopeeScore = Math.max(panelOrange, overallOrange);
    if (headerDark - panelOrange > 0.15) {
      colorDecision = 'tiktok';
    } else if (panelOrange - panelAccent > 0.08 && overallAccent < 0.02) {
      colorDecision = 'shopee';
    } else if (tiktokScore >= shopeeScore) {
      colorDecision = 'tiktok';
    } else {
      colorDecision = 'shopee';
    }
  }

  return {
    metrics: {
      headerDark,
      overallDark,
      panelAccent,
      overallAccent,
      headerAccent,
      panelOrange,
      overallOrange,
      panelValid
    },
    tiktokColorPass,
    shopeeColorPass,
    colorDecision
  };
};

export const analyzePlatformColors = (
  buffer: Buffer,
  originalWidth: number
): ColorAnalysis => {
  try {
    const decoded = decodeImage(buffer);
    if (decoded.width === 0 || decoded.height === 0) {
      return computeMetrics(decoded, originalWidth);
    }
    return computeMetrics(decoded, originalWidth || decoded.width);
  } catch (error) {
    console.warn('Color analysis failed', error);
    return {
      metrics: {
        headerDark: 0,
        overallDark: 0,
        panelAccent: 0,
        overallAccent: 0,
        headerAccent: 0,
        panelOrange: 0,
        overallOrange: 0,
        panelValid: false
      },
      tiktokColorPass: false,
      shopeeColorPass: false,
      colorDecision: null
    };
  }
};

export type { ColorAnalysis, ColorMetrics };
