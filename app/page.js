'use client';

import { useEffect, useMemo, useState } from 'react';
import { parseSlot } from '../lib/parse';
import { buildICS } from '../lib/ics';
import { extractFromImage } from '../lib/ocr';

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function fromYMD(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

function rawDateToYMD(rawDate) {
  if (!rawDate) return null;
  const normalized = rawDate.trim();
  let d, m, y;
  if (normalized.includes('/')) {
    const parts = normalized.split('/').map(p => p.trim());
    if (parts.length !== 3) return null;
    [d, m, y] = parts;
  } else if (normalized.includes('-')) {
    const parts = normalized.split('-').map(p => p.trim());
    if (parts.length !== 3) return null;
    if (parts[0].length === 4) {
      [y, m, d] = parts;
    } else {
      [d, m, y] = parts;
    }
  } else {
    return null;
  }
  if (!d || !m || !y) return null;
  const dd = d.padStart(2, '0');
  const mm = m.padStart(2, '0');
  const yyyy = y.padStart(4, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function fmtHM(dt) {
  return dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

/** lấy nhãn bucket 2 giờ cho 1 Date (ví dụ 08:xx -> "08:00–10:00") */
function twoHourBucket(dt) {
  const h = dt.getHours();
  const base = Math.floor(h / 2) * 2; // 0,2,4,...,22
  const h1 = String(base).padStart(2, '0');
  const h2 = String((base + 2) % 24).padStart(2, '0');
  return `${h1}:00–${h2}:00`;
}

const DAY_RANGE_OPTIONS = [
  1, 2, 3, 4, 5, 6, 7, 15, 30
].map(n => ({
  value: n,
  label: n === 1
    ? '1 ngày'
    : n === 30
      ? '1 tháng (30 ngày)'
      : `${n} ngày`
}));

function groupEventsByBucket(events) {
  const map = new Map();
  for (const e of events) {
    const key = twoHourBucket(e.start);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => Number(a.slice(0, 2)) - Number(b.slice(0, 2)))
    .map(([bucket, items]) => ({
      bucket,
      items: items.slice().sort((a, b) => a.start - b.start)
    }));
}

const BRAND_CANONICAL_REPLACEMENTS = [
  { pattern: /\bTTS\b/g, replacement: 'TIKTOK' },
  { pattern: /\bSHP\b/g, replacement: 'SHOPEE' },
  { pattern: /\bLZD\b/g, replacement: 'LAZADA' }
];

const BRAND_CANONICAL_KEYWORDS = ['TIKTOK', 'SHOPEE', 'LAZADA'];

const SPECIAL_HOST_LINKS = {
  'điểu nhi': 'https://zalo.me/g/pcmwxc142'
};

const GOOGLE_FORM_BASE_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeZAOqU-pF3DEa7PB_GL4xzWg5K1lhIqy0m2LuUnDf_HV4_QA/viewform';

const FORM_ENTRY_IDS = {
  email: 'entry.1317689542',
  keyLivestream: 'entry.1361227754',
  livestreamId1: 'entry.59862848',
  livestreamId2: 'entry.488105340',
  gmv: 'entry.1865421413',
  startTime: 'entry.2116389673'
};

function encodeForPrefill(text) {
  return (text || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildPrefilledFormLink(values) {
  const params = new URLSearchParams({
    [FORM_ENTRY_IDS.email]: encodeForPrefill(values.email || ''),
    [FORM_ENTRY_IDS.keyLivestream]: values.keyLivestream || '',
    [FORM_ENTRY_IDS.livestreamId1]: values.id1 || '',
    [FORM_ENTRY_IDS.gmv]: values.gmv || '',
    [FORM_ENTRY_IDS.startTime]: encodeForPrefill(values.startTimeText || '')
  });

  if (values.id2) {
    params.set(FORM_ENTRY_IDS.livestreamId2, values.id2);
  }

  return `${GOOGLE_FORM_BASE_URL}?${params.toString()}`;
}

function extractLivestreamIdFromText(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const shopeeMatch = trimmed.match(/creator\.shopee\.vn\/dashboard\/live\/(\d+)/i);
  if (shopeeMatch) return shopeeMatch[1];

  const tiktokMatch = trimmed.match(/[?&]room_id=(\d+)/i);
  if (tiktokMatch) return tiktokMatch[1];

  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  const digitMatches = trimmed.match(/\d{5,}/g);
  if (digitMatches && digitMatches.length) {
    return digitMatches[digitMatches.length - 1];
  }

  return '';
}

function sanitizeNumericString(value) {
  return (value || '').replace(/[^0-9]/g, '');
}

function isValidEmail(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return false;
  if (!trimmed.includes('@')) return false;
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  return emailRegex.test(trimmed);
}

async function loadImageElement(source) {
  if (!source) {
    throw new Error('Không có ảnh để xử lý.');
  }

  if (typeof window === 'undefined') {
    throw new Error('OCR chỉ khả dụng trên trình duyệt.');
  }

  if (source instanceof HTMLImageElement) {
    return source;
  }

  const dataUrl = await new Promise((resolve, reject) => {
    if (typeof source === 'string') {
      resolve(source);
      return;
    }

    if (source instanceof Blob) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Không đọc được file ảnh.'));
      reader.readAsDataURL(source);
      return;
    }

    reject(new Error('Định dạng ảnh không hỗ trợ.'));
  });

  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không tải được ảnh.'));
    img.src = dataUrl;
  });
}

const TESSERACT_CDN_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let tesseractLoaderPromise = null;

function loadTesseractFromCdn() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('OCR chỉ khả dụng trên trình duyệt.'));
  }
  if (window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (!tesseractLoaderPromise) {
    tesseractLoaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TESSERACT_CDN_URL;
      script.async = true;
      script.onload = () => {
        if (window.Tesseract) {
          resolve(window.Tesseract);
        } else {
          reject(new Error('Không tải được Tesseract.'));
        }
      };
      script.onerror = () => {
        reject(new Error('Không thể tải thư viện OCR.'));
      };
      document.body.appendChild(script);
    }).catch(err => {
      tesseractLoaderPromise = null;
      throw err;
    });
  }
  return tesseractLoaderPromise;
}

function normalizeBrandLabel(label) {
  if (!label) return '';
  let upper = label.toUpperCase();
  for (const { pattern, replacement } of BRAND_CANONICAL_REPLACEMENTS) {
    upper = upper.replace(pattern, replacement);
  }
  return upper.replace(/\s+/g, ' ').trim();
}

function extractTokensFromCanonical(canonicalLabel) {
  const tokens = new Set();
  if (!canonicalLabel) return tokens;
  for (const keyword of BRAND_CANONICAL_KEYWORDS) {
    if (canonicalLabel.includes(keyword)) {
      tokens.add(keyword);
    }
  }
  return tokens;
}

function extractBrandCore(label) {
  if (!label) return '';
  const cleaned = label.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const [head] = cleaned.split(/\s*[-–—:]\s*/);
  return head ? head.trim() : '';
}

function normalizeBrandCore(core) {
  if (!core) return '';
  return core.replace(/\s+/g, ' ').trim().toUpperCase();
}

function removeDiacritics(str) {
  if (!str) return '';
  if (typeof str.normalize === 'function') {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return str;
}

function simplifyBrandForMatch(value) {
  if (!value) return '';
  const upper = removeDiacritics(value.toUpperCase());
  return upper.replace(/[^A-Z0-9]/g, '');
}

function longestCommonSubsequenceLength(a, b) {
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  const dp = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  return dp[n];
}

function computeNormalizedSimilarity(a, b) {
  if (!a || !b) return 0;
  const lcs = longestCommonSubsequenceLength(a, b);
  if (!lcs) return 0;
  return lcs / Math.max(a.length, b.length);
}

function createBrandMetadata(label) {
  const canonical = normalizeBrandLabel(label);
  const aliases = new Set();
  const tokens = extractTokensFromCanonical(canonical);
  const coreRaw = extractBrandCore(label);
  const brandCore = normalizeBrandCore(coreRaw);

  if (canonical) {
    aliases.add(canonical);
  }

  const withoutPrefix = canonical.replace(/^BRAND\s*[-:–]\s*/, '').trim();
  if (withoutPrefix) {
    aliases.add(withoutPrefix);
    const parts = withoutPrefix
      .split(/\s*&\s*|\s*\/\s*|\s*,\s*|\s*\+\s*/)
      .map(part => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    for (const part of parts) {
      aliases.add(part);
      aliases.add(`BRAND - ${part}`);
    }
  }

  if (brandCore) {
    aliases.add(brandCore);
    aliases.add(`BRAND - ${brandCore}`);
  }

  const aliasSimplified = new Set();
  for (const alias of aliases) {
    const simplified = simplifyBrandForMatch(alias);
    if (simplified) aliasSimplified.add(simplified);
  }

  const canonicalSimplified = simplifyBrandForMatch(canonical);
  const brandCoreSimplified = simplifyBrandForMatch(brandCore);

  return {
    canonical,
    canonicalSimplified,
    aliases,
    aliasSimplified,
    tokens,
    brandCore,
    brandCoreSimplified
  };
}

export default function Page() {
  const [rawItems, setRawItems] = useState([]);      // dữ liệu raw từ sheet
  const [selectedDateStr, setSelectedDateStr] = useState(toYMD(new Date())); // yyyy-mm-dd
  const [daysToShow, setDaysToShow] = useState(1);   // số ngày hiển thị bắt đầu từ ngày chọn
  const [query, setQuery] = useState('');            // filter/search
  const [filterBrand, setFilterBrand] = useState('');
  const [filterTime, setFilterTime] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [filterSessionType, setFilterSessionType] = useState('');
  const [filterHost, setFilterHost] = useState('');
  const [filterCoordinator, setFilterCoordinator] = useState('');
  const [hostLinks, setHostLinks] = useState([]);
  const [brandLinks, setBrandLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [trialUser, setTrialUser] = useState(null);
  const [hasAppliedLoginSearch, setHasAppliedLoginSearch] = useState(false);
  const [pendingVerificationName, setPendingVerificationName] = useState(null);
  const [prefillModal, setPrefillModal] = useState(null);
  const isActiveUser = trialUser?.status === 'active';

  const hostLinkMap = useMemo(() => {
    const map = new Map();
    for (const entry of hostLinks) {
      const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
      const link = typeof entry?.link === 'string' ? entry.link.trim() : '';
      if (!name || !link) continue;
      map.set(name.toLowerCase(), link);
    }
    for (const [rawName, link] of Object.entries(SPECIAL_HOST_LINKS)) {
      const normalizedName = typeof rawName === 'string' ? rawName.trim().toLowerCase() : '';
      const normalizedLink = typeof link === 'string' ? link.trim() : '';
      if (!normalizedName || !normalizedLink) continue;
      map.set(normalizedName, normalizedLink);
    }
    return map;
  }, [hostLinks]);

  const normalizedBrandLinks = useMemo(() => {
    return brandLinks
      .map(entry => {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        const link = typeof entry?.link === 'string' ? entry.link.trim() : '';
        const {
          canonical,
          canonicalSimplified,
          aliases,
          aliasSimplified,
          tokens,
          brandCore,
          brandCoreSimplified
        } = createBrandMetadata(name);
        return {
          name,
          link,
          canonical,
          canonicalSimplified,
          aliases,
          aliasSimplified,
          tokens,
          brandCore,
          brandCoreSimplified
        };
      })
      .filter(entry => entry.name && entry.link);
  }, [brandLinks]);

  function findHostLink(hostName) {
    if (!hostName) return null;
    const normalized = hostName.trim();
    if (!normalized) return null;
    return hostLinkMap.get(normalized.toLowerCase()) || null;
  }

  function countMissingTokens(entryTokens, targetTokens) {
    if (!targetTokens?.size) return 0;
    if (!entryTokens?.size) return targetTokens.size;
    let missing = 0;
    for (const token of targetTokens) {
      if (!entryTokens.has(token)) missing += 1;
    }
    return missing;
  }

  function countExtraTokens(entryTokens, targetTokens) {
    const entrySize = entryTokens?.size ?? 0;
    const targetSize = targetTokens?.size ?? 0;
    return Math.max(0, entrySize - targetSize);
  }

  function computeEntrySimilarity(entry, targetMeta) {
    if (!targetMeta) return 0;
    const comparisons = [];

    if (entry.brandCoreSimplified && targetMeta.brandCoreSimplified) {
      comparisons.push(computeNormalizedSimilarity(entry.brandCoreSimplified, targetMeta.brandCoreSimplified));
    }

    if (entry.canonicalSimplified && targetMeta.canonicalSimplified) {
      comparisons.push(computeNormalizedSimilarity(entry.canonicalSimplified, targetMeta.canonicalSimplified));
    }

    if (entry.canonicalSimplified) {
      if (targetMeta.brandCoreSimplified) {
        comparisons.push(computeNormalizedSimilarity(entry.canonicalSimplified, targetMeta.brandCoreSimplified));
      }
      for (const targetAlias of targetMeta.aliasSimplified) {
        comparisons.push(computeNormalizedSimilarity(entry.canonicalSimplified, targetAlias));
      }
    }

    if (entry.brandCoreSimplified) {
      if (targetMeta.canonicalSimplified) {
        comparisons.push(computeNormalizedSimilarity(entry.brandCoreSimplified, targetMeta.canonicalSimplified));
      }
      for (const targetAlias of targetMeta.aliasSimplified) {
        comparisons.push(computeNormalizedSimilarity(entry.brandCoreSimplified, targetAlias));
      }
    }

    for (const alias of entry.aliasSimplified) {
      if (targetMeta.brandCoreSimplified) {
        comparisons.push(computeNormalizedSimilarity(alias, targetMeta.brandCoreSimplified));
      }
      if (targetMeta.canonicalSimplified) {
        comparisons.push(computeNormalizedSimilarity(alias, targetMeta.canonicalSimplified));
      }
      for (const targetAlias of targetMeta.aliasSimplified) {
        comparisons.push(computeNormalizedSimilarity(alias, targetAlias));
      }
    }

    if (!comparisons.length) return 0;
    return Math.max(...comparisons);
  }

  function findBrandLink(brandName) {
    if (!brandName) return null;
    const normalized = brandName.trim();
    if (!normalized) return null;
    const targetMeta = createBrandMetadata(normalized);
    const targetTokens = targetMeta.tokens;

    if (!targetMeta.canonical && !targetMeta.brandCore && !targetTokens.size) {
      return null;
    }

    const scored = normalizedBrandLinks
      .map(entry => {
        const similarity = computeEntrySimilarity(entry, targetMeta);
        const missingTokens = countMissingTokens(entry.tokens, targetTokens);
        const extraTokens = countExtraTokens(entry.tokens, targetTokens);
        return { entry, similarity, missingTokens, extraTokens };
      })
      .filter(candidate => candidate.similarity > 0 || candidate.missingTokens === 0);

    if (!scored.length) {
      return null;
    }

    scored.sort((a, b) => {
      if (a.missingTokens !== b.missingTokens) return a.missingTokens - b.missingTokens;
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      if (a.extraTokens !== b.extraTokens) return a.extraTokens - b.extraTokens;
      const aLen = a.entry.canonical?.length ?? Infinity;
      const bLen = b.entry.canonical?.length ?? Infinity;
      return aLen - bLen;
    });

    const best = scored[0];
    if (!best) return null;

    if (best.missingTokens > 0 && targetTokens.size) {
      return null;
    }

    if (best.similarity <= 0) {
      return null;
    }

    if (best.similarity < 0.3) {
      return null;
    }

    return best.entry.link;
  }

  function openPrefillModalForEvent(event) {
    if (!event) return;
    const initialEmail = typeof trialUser?.email === 'string' ? trialUser.email.trim() : '';
    setPrefillModal({
      event,
      values: {
        email: initialEmail,
        keyLivestream: (event.keyLivestream || '').trim(),
        id1: '',
        id2: '',
        gmv: '',
        startTimeText: ''
      },
      emailLocked: Boolean(initialEmail),
      showOptionalId: false,
      ocrStatus: 'idle',
      ocrProgress: 0,
      ocrError: '',
      ocrMessage: '',
      ocrFileName: '',
      formErrors: {},
      link: '',
      copyFeedback: ''
    });
  }

  function closePrefillModal() {
    setPrefillModal(null);
  }

  function setPrefillValues(updater) {
    setPrefillModal(prev => {
      if (!prev) return prev;
      const nextValues = typeof updater === 'function' ? updater(prev.values) : updater;
      const clearedErrors = { ...(prev.formErrors || {}) };
      for (const key of Object.keys(nextValues)) {
        if (clearedErrors[key]) {
          delete clearedErrors[key];
        }
      }
      return {
        ...prev,
        values: { ...prev.values, ...nextValues },
        formErrors: clearedErrors,
        copyFeedback: ''
      };
    });
  }

  function handlePrefillFieldChange(field, value) {
    setPrefillValues(values => {
      const next = { ...values };
      if (field === 'gmv') {
        next.gmv = sanitizeNumericString(value);
      } else if (field === 'id1' || field === 'id2') {
        const extracted = extractLivestreamIdFromText(value);
        next[field] = extracted || sanitizeNumericString(value);
      } else if (field === 'email') {
        next.email = value;
      } else if (field === 'keyLivestream') {
        next.keyLivestream = value;
      } else if (field === 'startTimeText') {
        next.startTimeText = value;
      }
      return next;
    });
  }

  function toggleOptionalLivestreamId(show) {
    setPrefillModal(prev => {
      if (!prev) return prev;
      const nextErrors = { ...(prev.formErrors || {}) };
      if (!show) {
        delete nextErrors.id2;
      }
      return {
        ...prev,
        showOptionalId: show,
        values: show ? prev.values : { ...prev.values, id2: '' },
        formErrors: show ? prev.formErrors : nextErrors,
        copyFeedback: ''
      };
    });
  }

  function unlockPrefillEmail() {
    setPrefillModal(prev => (prev ? { ...prev, emailLocked: false } : prev));
  }

  async function handlePrefillOcr(file) {
    if (!file) return;
    const fileName = typeof file === 'object' && file && 'name' in file ? file.name : '';
    setPrefillModal(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        ocrStatus: 'running',
        ocrProgress: 0,
        ocrError: '',
        ocrMessage: '',
        ocrFileName: fileName,
        copyFeedback: ''
      };
    });

    try {
      const Tesseract = await loadTesseractFromCdn();
      const image = await loadImageElement(file);
      setPrefillModal(prev => {
        if (!prev || prev.ocrStatus !== 'running') return prev;
        return { ...prev, ocrProgress: 0.2 };
      });

      const extracted = await extractFromImage(Tesseract, image);
      const hasGmv = Boolean(extracted.gmv);
      const hasStart = Boolean(extracted.startTime);
      const platformLabel = extracted.platform === 'tiktok'
        ? 'TikTok Shop Live'
        : extracted.platform === 'shopee'
          ? 'Shopee Live'
          : '';

      setPrefillModal(prev => {
        if (!prev) return prev;
        const nextValues = { ...prev.values };
        if (hasGmv) {
          nextValues.gmv = extracted.gmv;
        }
        if (hasStart) {
          nextValues.startTimeText = extracted.startTime;
        }
        const clearedErrors = { ...(prev.formErrors || {}) };
        if (hasGmv && clearedErrors.gmv) delete clearedErrors.gmv;
        if (hasStart && clearedErrors.startTimeText) delete clearedErrors.startTimeText;
        let successMessage = hasGmv && hasStart
          ? 'Đã trích xuất GMV và giờ bắt đầu.'
          : hasGmv
            ? 'Đã trích xuất GMV, vui lòng kiểm tra lại.'
            : hasStart
              ? 'Đã trích xuất giờ bắt đầu, vui lòng kiểm tra lại.'
              : '';
        if (successMessage && platformLabel) {
          successMessage = `${successMessage} (${platformLabel}).`;
        }
        return {
          ...prev,
          values: nextValues,
          formErrors: clearedErrors,
          ocrStatus: hasGmv || hasStart ? 'success' : 'error',
          ocrProgress: 1,
          ocrMessage: successMessage,
          ocrError: hasGmv || hasStart ? '' : 'Không trích xuất được dữ liệu, vui lòng nhập tay.'
        };
      });
    } catch (err) {
      console.error('OCR extraction failed', err);
      setPrefillModal(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          ocrStatus: 'error',
          ocrProgress: 0,
          ocrError: err?.message ? `${err.message} Vui lòng nhập tay.` : 'Không trích xuất được dữ liệu, vui lòng nhập tay.'
        };
      });
    }
  }

  function handleGeneratePrefilledLink(event) {
    event.preventDefault();
    if (!prefillModal) return;
    const rawValues = prefillModal.values || {};

    const email = (rawValues.email || '').trim();
    const keyLivestream = (rawValues.keyLivestream || '').trim();
    const id1 = extractLivestreamIdFromText(rawValues.id1) || sanitizeNumericString(rawValues.id1);
    const id2Raw = extractLivestreamIdFromText(rawValues.id2) || sanitizeNumericString(rawValues.id2);
    const gmv = sanitizeNumericString(rawValues.gmv);
    const startTimeText = (rawValues.startTimeText || '').trim();

    const errors = {};
    if (!isValidEmail(email)) {
      errors.email = 'Email không hợp lệ.';
    }
    if (!keyLivestream) {
      errors.keyLivestream = 'Vui lòng nhập Key livestream.';
    }
    if (!id1) {
      errors.id1 = 'Cần ID phiên livestream 1.';
    }
    if (!gmv) {
      errors.gmv = 'GMV phải là số.';
    }
    if (!startTimeText) {
      errors.startTimeText = 'Vui lòng nhập giờ bắt đầu thực tế.';
    }

    const normalizedValues = {
      email,
      keyLivestream,
      id1,
      id2: id2Raw,
      gmv,
      startTimeText
    };

    if (Object.keys(errors).length > 0) {
      setPrefillModal(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          values: { ...prev.values, ...normalizedValues },
          formErrors: { ...prev.formErrors, ...errors },
          link: '',
          copyFeedback: ''
        };
      });
      return;
    }

    const link = buildPrefilledFormLink(normalizedValues);
    setPrefillModal(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        values: { ...prev.values, ...normalizedValues },
        formErrors: {},
        link,
        copyFeedback: ''
      };
    });
  }

  function resetPrefillToForm() {
    setPrefillModal(prev => {
      if (!prev) return prev;
      return { ...prev, link: '', copyFeedback: '' };
    });
  }

  async function handleCopyPrefilledLink() {
    if (!prefillModal?.link) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prefillModal.link);
        setPrefillModal(prev => (prev ? { ...prev, copyFeedback: 'Đã sao chép link vào clipboard.' } : prev));
        return;
      }
    } catch (err) {
      console.error('Copy prefilled link failed', err);
    }
    setPrefillModal(prev => (prev ? { ...prev, copyFeedback: 'Không thể sao chép tự động, vui lòng copy thủ công.' } : prev));
  }

  // fetch sheet
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/sheet', { cache: 'no-store' });
        const j = await r.json();
        setRawItems(j.items || []);
        setHostLinks(Array.isArray(j.hostLinks) ? j.hostLinks : []);
        setBrandLinks(Array.isArray(j.brandLinks) ? j.brandLinks : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Đọc trạng thái đăng nhập từ localStorage (nếu có)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('trial_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setTrialUser(parsed);
        setNameInput(parsed?.name || '');
        if (parsed?.status === 'active') {
          setShowLoginModal(false);
        } else {
          setShowLoginModal(true);
        }
        const cachedName = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
        if (cachedName) {
          setPendingVerificationName(cachedName);
        }
        return;
      } catch (err) {
        console.warn('Không đọc được trial_user từ localStorage', err);
      }
    }
    setShowLoginModal(true);
  }, []);

  // Lưu trạng thái vào localStorage mỗi khi cập nhật
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!trialUser) return;
    window.localStorage.setItem('trial_user', JSON.stringify(trialUser));
  }, [trialUser]);

  // Sau khi đăng nhập thành công, tự động áp dụng tìm kiếm theo tên
  useEffect(() => {
    if (!trialUser) return;
    if (trialUser.status === 'active' && trialUser.name && !hasAppliedLoginSearch) {
      setQuery(trialUser.name);
      setHasAppliedLoginSearch(true);
    }
  }, [trialUser, hasAppliedLoginSearch]);

  useEffect(() => {
    if (!isActiveUser) {
      setShowFiltersModal(false);
    }
  }, [isActiveUser]);

  useEffect(() => {
    if (!showFiltersModal) return;
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setShowFiltersModal(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showFiltersModal]);

  useEffect(() => {
    if (!prefillModal) return;
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        closePrefillModal();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [prefillModal]);

  function applyTrialStatusResponse(response, fallbackName) {
    const status = response?.status;
    const normalizedName = (response?.name || fallbackName || '').trim();
    if (!status) {
      setTrialUser(null);
      setLoginError('Đăng nhập thất bại.');
      setShowLoginModal(true);
      return;
    }

    if (status === 'active') {
      setHasAppliedLoginSearch(false);
      setTrialUser(response);
      setNameInput(normalizedName);
      setShowLoginModal(false);
      setLoginError('');
      return;
    }

    if (status === 'expired') {
      setTrialUser(response);
      setNameInput(normalizedName);
      setLoginError('Thời gian dùng thử đã hết. Vui lòng liên hệ để gia hạn.');
      setShowLoginModal(true);
      return;
    }

    if (status === 'blocked') {
      setTrialUser({ status: 'blocked', name: normalizedName });
      setNameInput(normalizedName);
      setLoginError('Tài khoản của bạn đã bị chặn.');
      setShowLoginModal(true);
      return;
    }

    if (status === 'not_found') {
      setTrialUser(null);
      setNameInput(normalizedName);
      setLoginError(response?.message || 'Tên không tồn tại, vui lòng nhập lại.');
      setShowLoginModal(true);
      return;
    }

    setTrialUser(null);
    setNameInput(normalizedName);
    setLoginError('Đăng nhập thất bại.');
    setShowLoginModal(true);
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name) {
      setLoginError('Vui lòng nhập tên của bạn.');
      return;
    }
    setLoginError('');
    setNameInput(name);
    setLoggingIn(true);
    try {
      const res = await fetch('/api/login-by-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const response = await res.json();
      if (!res.ok) {
        const errorMessage = typeof response?.error === 'string'
          ? response.error
          : 'Đăng nhập thất bại.';
        throw new Error(errorMessage);
      }

      applyTrialStatusResponse(response, name);
    } catch (err) {
      console.error(err);
      const message = typeof err?.message === 'string'
        ? err.message
        : 'Đăng nhập thất bại.';
      const friendlyMessage = /permission denied/i.test(message)
        ? 'Không thể xác minh tên ở thời điểm hiện tại. Vui lòng thử lại sau.'
        : message;
      const finalMessage = friendlyMessage || 'Đăng nhập thất bại.';
      setLoginError(finalMessage);
      setShowLoginModal(true);
      if (/không tồn tại/i.test(finalMessage) || /not\s+found/i.test(finalMessage)) {
        setTrialUser(null);
      }
    } finally {
      setLoggingIn(false);
    }
  }

  async function refreshTrialStatus(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return;
    try {
      const res = await fetch('/api/login-by-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      const response = await res.json();
      if (!res.ok) {
        console.error('refreshTrialStatus failed', response);
        return;
      }
      applyTrialStatusResponse(response, trimmed);
    } catch (err) {
      console.error('refreshTrialStatus error', err);
    }
  }

  useEffect(() => {
    if (!pendingVerificationName) return;
    let cancelled = false;
    (async () => {
      await refreshTrialStatus(pendingVerificationName);
      if (!cancelled) {
        setPendingVerificationName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingVerificationName]);

  function resetFilters() {
    setFilterBrand('');
    setFilterTime('');
    setFilterRoom('');
    setFilterSessionType('');
    setFilterHost('');
    setFilterCoordinator('');
  }

  function handleLogout() {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('trial_user');
    }
    setTrialUser(null);
    setNameInput('');
    setQuery('');
    setShowLoginModal(true);
    setLoggingIn(false);
    setLoginError('');
    setHasAppliedLoginSearch(false);
    resetFilters();
    setShowFiltersModal(false);
  }
  const trialInfo = useMemo(() => {
    if (!trialUser) return null;
    if (!trialUser.trial_expires_at) return null;
    try {
      const expireDate = new Date(trialUser.trial_expires_at);
      const formatted = expireDate.toLocaleDateString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
      return { formatted, daysLeft: trialUser.days_left };
    } catch (err) {
      return null;
    }
  }, [trialUser]);

  // Chuyển rawItems -> events của các ngày đang chọn (parse ngày + time slot)
  const selectedDayEvents = useMemo(() => {
    const startDay = fromYMD(selectedDateStr);
    const rangeMap = new Map();
    const rangeLength = Math.max(1, daysToShow);
    for (let i = 0; i < rangeLength; i++) {
      const d = new Date(startDay);
      d.setDate(d.getDate() + i);
      rangeMap.set(toYMD(d), d);
    }
    const out = [];
    for (const it of rawItems) {
      const dateKey = rawDateToYMD(it.rawDate);
      if (!dateKey) continue;
      const matchedDay = rangeMap.get(dateKey);
      if (!matchedDay) continue;
      const slot = parseSlot(it.timeSlot, matchedDay);
      if (!slot) continue;
      out.push({
        title: it.brandChannel,           // Summary = brandChannel
        start: slot.start,
        end: slot.end,
        sessionType: it.sessionType,
        talent1: it.talent1,
        talent2: it.talent2,
        room: it.room,
        coor: it.coor,
        keyLivestream: it.keyLivestream,
        rawDate: it.rawDate,
        timeSlot: it.timeSlot,
        date: matchedDay,
        dateKey,
        dateLabel: matchedDay.toLocaleDateString('vi-VN', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit'
        })
      });
    }
    // sort theo start time
    return out.sort((a, b) => a.start - b.start);
  }, [rawItems, selectedDateStr, daysToShow]);

  const filterOptions = useMemo(() => {
    const brands = new Set();
    const times = new Set();
    const rooms = new Set();
    const sessionTypes = new Set();
    const hosts = new Set();
    const coordinators = new Set();

    for (const e of selectedDayEvents) {
      const title = (e.title || '').trim();
      if (title) brands.add(title);

      const slot = (e.timeSlot || '').trim();
      if (slot) times.add(slot);

      const room = (e.room || '').trim();
      if (room) rooms.add(room);

      const sessionType = (e.sessionType || '').trim();
      if (sessionType) sessionTypes.add(sessionType);

      const talent1 = (e.talent1 || '').trim();
      if (talent1) hosts.add(talent1);

      const talent2 = (e.talent2 || '').trim();
      if (talent2) hosts.add(talent2);

      const coor = (e.coor || '').trim();
      if (coor) coordinators.add(coor);
    }

    const sort = arr => Array.from(arr).sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));

    return {
      brands: sort(brands),
      times: sort(times),
      rooms: sort(rooms),
      sessionTypes: sort(sessionTypes),
      hosts: sort(hosts),
      coordinators: sort(coordinators)
    };
  }, [selectedDayEvents]);

  const hasActiveFilters = useMemo(
    () => Boolean(filterBrand || filterTime || filterRoom || filterSessionType || filterHost || filterCoordinator),
    [filterBrand, filterTime, filterRoom, filterSessionType, filterHost, filterCoordinator]
  );
  const filterButtonLabel = hasActiveFilters ? 'Bộ lọc (đang áp dụng)' : 'Bộ lọc';

  // Áp dụng filter/search (theo text)
  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return selectedDayEvents.filter(e => {
      const brand = (e.title || '').trim();
      if (filterBrand && brand !== filterBrand) return false;

      const timeSlot = (e.timeSlot || '').trim();
      if (filterTime && timeSlot !== filterTime) return false;

      const room = (e.room || '').trim();
      if (filterRoom && room !== filterRoom) return false;

      const sessionType = (e.sessionType || '').trim();
      if (filterSessionType && sessionType !== filterSessionType) return false;

      if (filterHost) {
        const hosts = [e.talent1, e.talent2]
          .map(h => (h || '').trim())
          .filter(Boolean);
        if (!hosts.includes(filterHost)) return false;
      }

      const coordinator = (e.coor || '').trim();
      if (filterCoordinator && coordinator !== filterCoordinator) return false;

      if (!q) return true;

      const hay = [
        e.title, e.sessionType, e.talent1, e.talent2 || '',
        e.room || '', e.coor || '', e.timeSlot || '', e.dateLabel
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [selectedDayEvents, query, filterBrand, filterTime, filterRoom, filterSessionType, filterHost, filterCoordinator]);

  // Group theo bucket 2 giờ (dựa trên start time)
  const groupedSingleDay = useMemo(() => {
    if (daysToShow > 1) return [];
    return groupEventsByBucket(filteredEvents);
  }, [filteredEvents, daysToShow]);

  const groupedMultipleDays = useMemo(() => {
    if (daysToShow <= 1) return [];
    const dayMap = new Map();
    for (const e of filteredEvents) {
      if (!dayMap.has(e.dateKey)) {
        dayMap.set(e.dateKey, {
          date: e.date,
          label: e.dateLabel,
          events: []
        });
      }
      dayMap.get(e.dateKey).events.push(e);
    }
    return Array.from(dayMap.values())
      .sort((a, b) => a.date - b.date)
      .map(day => ({
        dayKey: toYMD(day.date),
        dayLabel: day.label,
        buckets: groupEventsByBucket(day.events)
      }));
  }, [filteredEvents, daysToShow]);

  const prefillValues = prefillModal?.values || {};
  const prefillFormErrors = prefillModal?.formErrors || {};
  const showPrefillOptionalId = prefillModal ? (prefillModal.showOptionalId || Boolean(prefillValues.id2)) : false;

  // Tải ICS cho các ca đang hiển thị (áp dụng filter hiện tại)
  function downloadICSForDay() {
    if (!filteredEvents.length) {
      alert('Không có ca nào khớp với bộ lọc hiện tại');
      return;
    }
    // Nhóm theo brand/title để chỉ alarm cho ca đầu chuỗi liên tiếp
    const byTitle = new Map();
    for (const e of filteredEvents) {
      if (!byTitle.has(e.title)) byTitle.set(e.title, []);
      byTitle.get(e.title).push(e);
    }

    const TOLERANCE = 5 * 60 * 1000; // 5 phút
    const entries = [];
    for (const arr of byTitle.values()) {
      arr.sort((a,b)=>a.start-b.start);
      let prevEnd = null;
      for (const ev of arr) {
        const contiguous = prevEnd && Math.abs(ev.start - prevEnd) <= TOLERANCE;
        const hasAlarm = !contiguous; // chỉ ca đầu chuỗi mới có alarm
        entries.push({
          title: ev.title,
          start: ev.start,
          end: ev.end,
          location: ev.room,
          desc:
`Session type: ${ev.sessionType}
Talent: ${ev.talent1}${ev.talent2 ? ', ' + ev.talent2 : ''}
Room: ${ev.room}
Coordinator: ${ev.coor}
Time slot: ${ev.timeSlot}
Nguồn: Google Sheet ${ev.rawDate}`,
          alarm: hasAlarm
        });
        prevEnd = ev.end;
      }
    }

    const ics = buildICS(entries, 30);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = fromYMD(selectedDateStr);
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
    const suffix = daysToShow > 1 ? `-${String(daysToShow)}d` : '';
    a.href = url; a.download = `work-${y}${m}${dd}${suffix}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="container">
      <div className="page-header">
        <h1>Lịch làm việc</h1>
        {trialUser && (
          <button
            type="button"
            className="icon-button"
            onClick={handleLogout}
            disabled={loggingIn}
            aria-label="Đăng xuất"
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              className="icon"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9l3.75 3-3.75 3M21 12H9"
              />
            </svg>
            <span className="sr-only">Đăng xuất</span>
          </button>
        )}
      </div>

      {/* Toolbar: chọn ngày + tìm kiếm + nút ICS */}
      <div className="toolbar">
        <div className="toolbar-row">
          <label className="lbl" htmlFor="pick-date">Ngày</label>
          <input
            id="pick-date"
            type="date"
            className="date-input"
            value={selectedDateStr}
            onChange={e => setSelectedDateStr(e.target.value)}
          />
        </div>

        <div className="toolbar-row">
          <label className="lbl" htmlFor="days-to-show">Số ngày</label>
          <select
            id="days-to-show"
            className="date-input"
            value={daysToShow}
            onChange={e => setDaysToShow(Math.max(1, Number(e.target.value) || 1))}
          >
            {DAY_RANGE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-row toolbar-row--search">
          <label className="lbl" htmlFor="q">Tìm</label>
          <div className="search-box">
            <input
              id="q"
              type="text"
              className="text-input"
              placeholder="Brand / Session / Talent / Room / Coordinator…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              disabled={!isActiveUser}
            />
          </div>
          {query && (
            <button className="btn ghost" onClick={() => setQuery('')}>Xóa</button>
          )}
        </div>

        <div className="toolbar-actions">
          <div className="toolbar-buttons">
            <button
              type="button"
              className="btn ghost filter-trigger"
              onClick={() => setShowFiltersModal(true)}
              disabled={!isActiveUser}
              aria-haspopup="dialog"
              aria-expanded={showFiltersModal}
              aria-controls="filters-modal"
              aria-label={filterButtonLabel}
              title={filterButtonLabel}
              data-active={hasActiveFilters}
            >
              <span className="filter-trigger-label">Bộ lọc</span>
              {hasActiveFilters && <span className="filter-trigger-indicator" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="btn"
              onClick={downloadICSForDay}
              disabled={!isActiveUser}
            >
              Tải lịch đang xem (.ics)
            </button>
          </div>
        </div>
      </div>

      {/* Danh sách nhóm theo 2h */}
      {loading ? (
        <div className="event-card"><i>Đang tải dữ liệu…</i></div>
      ) : daysToShow > 1 ? (
        groupedMultipleDays.length ? (
          groupedMultipleDays.map(day => (
            <div key={day.dayKey} className="day-section">
              <div className="day-head">{day.dayLabel}</div>
              {day.buckets.map(g => (
                <div key={g.bucket} className="group">
                  <div className="group-head">{g.bucket}</div>
                  {g.items.map((e, i) => {
                    const brandLink = findBrandLink(e.title);
                    const hostEntries = (() => {
                      const entries = [];
                      const seen = new Set();
                      for (const raw of [e.talent1, e.talent2]) {
                        const name = (raw || '').trim();
                        if (!name) continue;
                        const key = name.toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        entries.push({ name, link: findHostLink(name) });
                      }
                      return entries;
                    })();
                    return (
                      <div key={i} className="event-card">
                        <button
                          type="button"
                          className="prefill-trigger"
                          onClick={() => openPrefillModalForEvent(e)}
                          title="Điền Google Form tự động"
                          aria-label="Điền Google Form tự động"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            className="prefill-trigger-icon"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M16.862 4.487a2.1 2.1 0 112.97 2.97L8.654 18.636a4.2 4.2 0 01-1.768 1.043l-3.118.89.89-3.118a4.2 4.2 0 011.043-1.768L16.862 4.487z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15.75 6.375l1.875 1.875"
                            />
                          </svg>
                        </button>
                        <div className="event-title-row">
                          <h2 className="event-title">{e.title}</h2>
                          {brandLink && (
                            <a
                              href={brandLink}
                              className="zalo-link-button"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              💬 Zalo
                            </a>
                          )}
                        </div>
                        <div className="event-time">⏰ {fmtHM(e.start)}–{fmtHM(e.end)}</div>
                        <div className="event-date">📅 {e.dateLabel}</div>
                        <div className="event-meta">
                          <div className="meta-line">
                            <span aria-hidden="true">📍</span>
                            <div className="meta-line-content">
                              <span>{e.room || '-'}</span>
                            </div>
                          </div>
                          <div className="meta-line">
                            <span aria-hidden="true">📝</span>
                            <div className="meta-line-content">
                              <span>Session type: {e.sessionType || '—'}</span>
                            </div>
                          </div>
                          <div className="meta-line">
                            <span aria-hidden="true">🎤</span>
                            <div className="meta-line-content meta-line-content--hosts">
                              {hostEntries.length ? (
                                hostEntries.map(entry => (
                                  <span key={entry.name} className="meta-host-entry">
                                    <span>{entry.name}</span>
                                    {entry.link && (
                                      <a
                                        href={entry.link}
                                        className="zalo-link-button zalo-link-button--inline"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        💬 Zalo
                                      </a>
                                    )}
                                  </span>
                                ))
                              ) : (
                                <span>—</span>
                              )}
                            </div>
                          </div>
                          <div className="meta-line">
                            <span aria-hidden="true">🖥️</span>
                            <div className="meta-line-content">
                              <span>{e.coor || '—'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))
        ) : (
          <p>Không có sự kiện trong khoảng ngày này.</p>
        )
      ) : groupedSingleDay.length ? (
        groupedSingleDay.map(g => (
          <div key={g.bucket} className="group">
            <div className="group-head">{g.bucket}</div>
            {g.items.map((e, i) => {
              const brandLink = findBrandLink(e.title);
              const hostEntries = (() => {
                const entries = [];
                const seen = new Set();
                for (const raw of [e.talent1, e.talent2]) {
                  const name = (raw || '').trim();
                  if (!name) continue;
                  const key = name.toLowerCase();
                  if (seen.has(key)) continue;
                  seen.add(key);
                  entries.push({ name, link: findHostLink(name) });
                }
                return entries;
              })();
              return (
                <div key={i} className="event-card">
                  <button
                    type="button"
                    className="prefill-trigger"
                    onClick={() => openPrefillModalForEvent(e)}
                    title="Điền Google Form tự động"
                    aria-label="Điền Google Form tự động"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="prefill-trigger-icon"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16.862 4.487a2.1 2.1 0 112.97 2.97L8.654 18.636a4.2 4.2 0 01-1.768 1.043l-3.118.89.89-3.118a4.2 4.2 0 011.043-1.768L16.862 4.487z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.75 6.375l1.875 1.875"
                      />
                    </svg>
                  </button>
                  <div className="event-title-row">
                    <h2 className="event-title">{e.title}</h2>
                    {brandLink && (
                      <a
                        href={brandLink}
                        className="zalo-link-button"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        💬 Zalo
                      </a>
                    )}
                  </div>
                  <div className="event-time">⏰ {fmtHM(e.start)}–{fmtHM(e.end)}</div>
                  <div className="event-meta">
                    <div className="meta-line">
                      <span aria-hidden="true">📍</span>
                      <div className="meta-line-content">
                        <span>{e.room || '-'}</span>
                      </div>
                    </div>
                    <div className="meta-line">
                      <span aria-hidden="true">📝</span>
                      <div className="meta-line-content">
                        <span>Session type: {e.sessionType || '—'}</span>
                      </div>
                    </div>
                    <div className="meta-line">
                      <span aria-hidden="true">🎤</span>
                      <div className="meta-line-content meta-line-content--hosts">
                        {hostEntries.length ? (
                          hostEntries.map(entry => (
                            <span key={entry.name} className="meta-host-entry">
                              <span>{entry.name}</span>
                              {entry.link && (
                                <a
                                  href={entry.link}
                                  className="zalo-link-button zalo-link-button--inline"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  💬 Zalo
                                </a>
                              )}
                            </span>
                          ))
                        ) : (
                          <span>—</span>
                        )}
                      </div>
                    </div>
                    <div className="meta-line">
                      <span aria-hidden="true">🖥️</span>
                      <div className="meta-line-content">
                        <span>{e.coor || '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))
      ) : (
        <p>Không có sự kiện cho ngày này.</p>
      )}

      {prefillModal && (
        <div
          className="modal-backdrop prefill-modal-backdrop"
          onClick={closePrefillModal}
        >
          <div
            className="modal-card prefill-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prefill-modal-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="prefill-modal-header">
              <div className="prefill-modal-title-block">
                <h2 id="prefill-modal-title">Điền Google Form</h2>
                <p className="prefill-modal-subtitle">
                  {prefillModal.event?.title || 'Phiên livestream'}
                </p>
                <div className="prefill-modal-summary">
                  <span>📅 {prefillModal.event?.dateLabel || '—'}</span>
                  <span>
                    ⏰
                    {prefillModal.event?.start && prefillModal.event?.end
                      ? ` ${fmtHM(prefillModal.event.start)}–${fmtHM(prefillModal.event.end)}`
                      : ' —'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-button"
                onClick={closePrefillModal}
                aria-label="Đóng điền form"
              >
                ×
              </button>
            </div>

            <div className="prefill-modal-body">
              {prefillModal.link ? (
                <div className="prefill-result" role="group" aria-labelledby="prefill-modal-title">
                  <div className="prefill-result-grid">
                    <div className="prefill-result-item">
                      <span className="prefill-result-label">Email</span>
                      <span className="prefill-result-value">{prefillValues.email || '—'}</span>
                    </div>
                    <div className="prefill-result-item">
                      <span className="prefill-result-label">Key livestream</span>
                      <span className="prefill-result-value">{prefillValues.keyLivestream || '—'}</span>
                    </div>
                    <div className="prefill-result-item">
                      <span className="prefill-result-label">ID phiên 1</span>
                      <span className="prefill-result-value">{prefillValues.id1 || '—'}</span>
                    </div>
                    {prefillValues.id2 && (
                      <div className="prefill-result-item">
                        <span className="prefill-result-label">ID phiên 2</span>
                        <span className="prefill-result-value">{prefillValues.id2}</span>
                      </div>
                    )}
                    <div className="prefill-result-item">
                      <span className="prefill-result-label">GMV</span>
                      <span className="prefill-result-value">{prefillValues.gmv || '—'}</span>
                    </div>
                    <div className="prefill-result-item">
                      <span className="prefill-result-label">Start time</span>
                      <span className="prefill-result-value">{prefillValues.startTimeText || '—'}</span>
                    </div>
                  </div>
                  <div className="prefill-result-link">
                    <label htmlFor="prefill-result-link-input">Link form</label>
                    <textarea
                      id="prefill-result-link-input"
                      className="prefill-result-textarea"
                      value={prefillModal.link}
                      readOnly
                    />
                  </div>
                  {prefillModal.copyFeedback && (
                    <div className="prefill-status-message">{prefillModal.copyFeedback}</div>
                  )}
                  <div className="prefill-result-actions">
                    <button type="button" className="btn ghost" onClick={resetPrefillToForm}>
                      Sửa
                    </button>
                    <button type="button" className="btn ghost" onClick={handleCopyPrefilledLink}>
                      Copy link
                    </button>
                    <a
                      href={prefillModal.link}
                      className="btn"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mở form
                    </a>
                    <button type="button" className="btn ghost" onClick={closePrefillModal}>
                      Đóng
                    </button>
                  </div>
                </div>
              ) : (
                <form className="prefill-form" onSubmit={handleGeneratePrefilledLink}>
                  <div className="prefill-field">
                    <label htmlFor="prefill-email">Email</label>
                    <div className="prefill-field-control">
                      <input
                        id="prefill-email"
                        type="email"
                        className="text-input"
                        placeholder="example@gmail.com"
                        value={prefillValues.email || ''}
                        onChange={e => handlePrefillFieldChange('email', e.target.value)}
                        disabled={prefillModal.emailLocked}
                        autoComplete="email"
                      />
                      {prefillModal.emailLocked && (
                        <button
                          type="button"
                          className="prefill-edit-button"
                          onClick={unlockPrefillEmail}
                        >
                          Sửa
                        </button>
                      )}
                    </div>
                    {prefillFormErrors.email && <div className="prefill-error">{prefillFormErrors.email}</div>}
                  </div>

                  <div className="prefill-field">
                    <label htmlFor="prefill-key">Key livestream</label>
                    <input
                      id="prefill-key"
                      type="text"
                      className="text-input"
                      placeholder="112025NSN14211H2 - G02"
                      value={prefillValues.keyLivestream || ''}
                      onChange={e => handlePrefillFieldChange('keyLivestream', e.target.value)}
                    />
                    {prefillFormErrors.keyLivestream && (
                      <div className="prefill-error">{prefillFormErrors.keyLivestream}</div>
                    )}
                  </div>

                  <div className="prefill-field">
                    <label htmlFor="prefill-id1">ID phiên livestream 1</label>
                    <input
                      id="prefill-id1"
                      type="text"
                      className="text-input"
                      placeholder="Dán link Shopee / TikTok hoặc nhập ID"
                      value={prefillValues.id1 || ''}
                      onChange={e => handlePrefillFieldChange('id1', e.target.value)}
                    />
                    <div className="prefill-hint">Tự động lấy số từ link creator.shopee.vn hoặc room_id.</div>
                    {prefillFormErrors.id1 && <div className="prefill-error">{prefillFormErrors.id1}</div>}
                  </div>

                  {showPrefillOptionalId ? (
                    <div className="prefill-field">
                      <div className="prefill-field-header">
                        <label htmlFor="prefill-id2">ID phiên livestream 2 (tuỳ chọn)</label>
                        <button
                          type="button"
                          className="prefill-mini-button"
                          onClick={() => toggleOptionalLivestreamId(false)}
                        >
                          Xóa
                        </button>
                      </div>
                      <input
                        id="prefill-id2"
                        type="text"
                        className="text-input"
                        placeholder="Nhập thêm ID nếu có"
                        value={prefillValues.id2 || ''}
                        onChange={e => handlePrefillFieldChange('id2', e.target.value)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="prefill-add-button"
                      onClick={() => toggleOptionalLivestreamId(true)}
                    >
                      + Thêm ID phiên 2 (tuỳ chọn)
                    </button>
                  )}

                  <div className="prefill-field">
                    <label htmlFor="prefill-ocr">Ảnh báo cáo (tự OCR)</label>
                    <input
                      id="prefill-ocr"
                      type="file"
                      accept="image/*"
                      onChange={event => {
                        const file = event.target.files?.[0];
                        if (file) {
                          handlePrefillOcr(file);
                        }
                        event.target.value = '';
                      }}
                    />
                    {prefillModal.ocrFileName && (
                      <div className="prefill-hint">Đã chọn: {prefillModal.ocrFileName}</div>
                    )}
                    {prefillModal.ocrStatus === 'running' && (
                      <div className="prefill-status-message">Đang trích xuất… {Math.round((prefillModal.ocrProgress || 0) * 100)}%</div>
                    )}
                    {prefillModal.ocrMessage && (
                      <div className="prefill-status-message prefill-status-message--success">{prefillModal.ocrMessage}</div>
                    )}
                    {prefillModal.ocrError && (
                      <div className="prefill-status-message prefill-status-message--error">{prefillModal.ocrError}</div>
                    )}
                  </div>

                  <div className="prefill-field">
                    <label htmlFor="prefill-gmv">GMV</label>
                    <input
                      id="prefill-gmv"
                      type="text"
                      inputMode="numeric"
                      className="text-input"
                      placeholder="27504935"
                      value={prefillValues.gmv || ''}
                      onChange={e => handlePrefillFieldChange('gmv', e.target.value)}
                    />
                    {prefillFormErrors.gmv && <div className="prefill-error">{prefillFormErrors.gmv}</div>}
                  </div>

                  <div className="prefill-field">
                    <label htmlFor="prefill-start-time">Giờ start time thực tế</label>
                    <input
                      id="prefill-start-time"
                      type="text"
                      className="text-input"
                      placeholder="Nov 11 20:05:05"
                      value={prefillValues.startTimeText || ''}
                      onChange={e => handlePrefillFieldChange('startTimeText', e.target.value)}
                    />
                    <div className="prefill-hint">Có thể chỉnh sửa thủ công sau khi OCR.</div>
                    {prefillFormErrors.startTimeText && (
                      <div className="prefill-error">{prefillFormErrors.startTimeText}</div>
                    )}
                  </div>

                  <div className="prefill-form-actions">
                    <button type="submit" className="btn">Tạo link</button>
                    <button type="button" className="btn ghost" onClick={closePrefillModal}>
                      Đóng
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {showLoginModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Đăng nhập bằng tên</h2>
            <p className="modal-desc">Nhập tên của bạn để đăng nhập và tìm kiếm lịch làm việc.</p>
            <form className="modal-form" onSubmit={handleLoginSubmit}>
              <input
                type="text"
                className="text-input"
                placeholder="Ví dụ: Nguyễn Văn A"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                disabled={loggingIn}
              />
              <button className="btn" type="submit" disabled={loggingIn}>
                {loggingIn ? 'Đang xử lý…' : 'Xác thực'}
              </button>
            </form>
            {loginError && <div className="modal-error">{loginError}</div>}
            {trialUser && trialUser.status !== 'active' && trialUser.status !== 'blocked' && trialUser.status !== 'expired' && (
              <div className="modal-hint">Trạng thái: {trialUser.status}</div>
            )}
            {trialUser && (trialUser.status === 'expired' || trialUser.status === 'blocked') && (
              <div className="modal-hint">
                <strong>Trạng thái:</strong> {trialUser.status === 'expired' ? 'Dùng thử đã hết hạn' : 'Đã bị chặn'}
              </div>
            )}
            {isActiveUser && trialInfo && (
              <div className="modal-hint">
                Dùng thử còn lại {trialInfo.daysLeft} ngày (hết hạn vào {trialInfo.formatted}).
              </div>
            )}
            {trialUser && (
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={handleLogout}
                  disabled={loggingIn}
                >
                  Đăng xuất / Xóa tên đã lưu
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {showFiltersModal && (
        <div
          className="modal-backdrop filters-modal-backdrop"
          onClick={() => setShowFiltersModal(false)}
        >
          <div
            id="filters-modal"
            className="modal-card filters-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="filters-modal-title"
            aria-describedby="filters-modal-description"
            onClick={event => event.stopPropagation()}
          >
            <div className="filters-modal-header">
              <h2 id="filters-modal-title">Bộ lọc lịch</h2>
              <button
                type="button"
                className="modal-close-button"
                onClick={() => setShowFiltersModal(false)}
                aria-label="Đóng bộ lọc"
              >
                ×
              </button>
            </div>
            <p id="filters-modal-description" className="modal-desc">
              Chọn các tiêu chí lọc để thu hẹp danh sách lịch hiển thị.
            </p>
            <div className="filters-modal-body">
              <div className="filters-grid">
                <div className="filter-group">
                  <label className="filter-label" htmlFor="filter-brand">Brand</label>
                  <select
                    id="filter-brand"
                    className="date-input"
                    value={filterBrand}
                    onChange={e => setFilterBrand(e.target.value)}
                    disabled={!isActiveUser}
                  >
                    <option value="">Tất cả</option>
                    {filterOptions.brands.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label className="filter-label" htmlFor="filter-time">Khung giờ</label>
                  <select
                    id="filter-time"
                    className="date-input"
                    value={filterTime}
                    onChange={e => setFilterTime(e.target.value)}
                    disabled={!isActiveUser}
                  >
                    <option value="">Tất cả</option>
                    {filterOptions.times.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label className="filter-label" htmlFor="filter-room">Phòng</label>
                  <select
                    id="filter-room"
                    className="date-input"
                    value={filterRoom}
                    onChange={e => setFilterRoom(e.target.value)}
                    disabled={!isActiveUser}
                  >
                    <option value="">Tất cả</option>
                    {filterOptions.rooms.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label className="filter-label" htmlFor="filter-session">Session type</label>
                  <select
                    id="filter-session"
                    className="date-input"
                    value={filterSessionType}
                    onChange={e => setFilterSessionType(e.target.value)}
                    disabled={!isActiveUser}
                  >
                    <option value="">Tất cả</option>
                    {filterOptions.sessionTypes.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label className="filter-label" htmlFor="filter-host">Host</label>
                  <select
                    id="filter-host"
                    className="date-input"
                    value={filterHost}
                    onChange={e => setFilterHost(e.target.value)}
                    disabled={!isActiveUser}
                  >
                    <option value="">Tất cả</option>
                    {filterOptions.hosts.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label className="filter-label" htmlFor="filter-coordinator">Coordinator</label>
                  <select
                    id="filter-coordinator"
                    className="date-input"
                    value={filterCoordinator}
                    onChange={e => setFilterCoordinator(e.target.value)}
                    disabled={!isActiveUser}
                  >
                    <option value="">Tất cả</option>
                    {filterOptions.coordinators.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="filters-modal-footer">
              <button
                type="button"
                className="btn ghost"
                onClick={resetFilters}
                disabled={!hasActiveFilters}
              >
                Xóa bộ lọc
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setShowFiltersModal(false)}
              >
                Xong
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
