'use client';

import Image from 'next/image';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { parseSlot } from '../lib/parse';
import { buildICS } from '../lib/ics';
import HelpButton from './components/HelpButton';
import HelpModal from './components/HelpModal';
import SHPPic1 from '../SHP_pic1.png';
import SHPPic2 from '../SHP_pic2.png';
import TTSPic1 from '../TTS_pic1.jpeg';
import TTSPic2 from '../TTS_pic2.jpg';

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

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    // ignore and fallback below
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);

  let success = false;
  try {
    textarea.select();
    success = document.execCommand('copy');
  } catch (error) {
    success = false;
  }

  document.body.removeChild(textarea);
  return success;
}

const DEFAULT_HOST_MESSAGE_TEMPLATE = 'Mình có live lúc Time ở Room nha';

function applyHostMessageTemplate(template, timeLabel, roomLabel) {
  const base = typeof template === 'string' && template.trim()
    ? template
    : DEFAULT_HOST_MESSAGE_TEMPLATE;
  const safeTime = timeLabel || '';
  const safeRoom = roomLabel || '-';
  return base
    .replace(/\bTime\b/g, safeTime)
    .replace(/\bRoom\b/g, safeRoom);
}

function buildHostZaloMessage(event, template) {
  const timeLabel = fmtHM(event.start);
  const primaryRoomRaw = typeof event?.primaryRoom === 'string' ? event.primaryRoom.trim() : '';
  const parts = Array.isArray(event.roomParts)
    ? event.roomParts.map(part => part.trim()).filter(Boolean)
    : [];
  const fallbackRoom = typeof event.room === 'string' ? event.room.trim() : '';
  const combinedRoom = parts.length ? parts.join(' / ') : (fallbackRoom || '-');
  const roomLabel = primaryRoomRaw || combinedRoom;
  return applyHostMessageTemplate(template, timeLabel, roomLabel);
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

function buildPrefilledFormLink(values) {
  const params = new URLSearchParams({
    [FORM_ENTRY_IDS.email]: (values.email || '').trim(),
    [FORM_ENTRY_IDS.keyLivestream]: values.keyLivestream || '',
    [FORM_ENTRY_IDS.livestreamId1]: values.id1 || '',
    [FORM_ENTRY_IDS.gmv]: values.gmv || '',
    [FORM_ENTRY_IDS.startTime]: (values.startTimeText || '').trim()
  });

  if (values.id2) {
    params.set(FORM_ENTRY_IDS.livestreamId2, values.id2);
  }

  if (values.startTimeEncoded) {
    params.delete(FORM_ENTRY_IDS.startTime);
  }

  let query = params.toString();
  if (values.startTimeEncoded) {
    query = query
      ? `${query}&${FORM_ENTRY_IDS.startTime}=${values.startTimeEncoded}`
      : `${FORM_ENTRY_IDS.startTime}=${values.startTimeEncoded}`;
  }

  return `${GOOGLE_FORM_BASE_URL}?${query}`;
}

function parseLivestreamInput(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return { id: '', platform: 'unknown' };
  }

  const lower = trimmed.toLowerCase();
  let parsedUrl = null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      parsedUrl = new URL(trimmed);
    } catch (error) {
      parsedUrl = null;
    }
  }

  const urlHost = parsedUrl?.hostname?.toLowerCase() || '';
  const urlPath = parsedUrl?.pathname?.toLowerCase() || '';

  let platform = 'unknown';
  if (
    urlHost.includes('creator.shopee.vn') ||
    (urlHost.includes('banhang.shopee.vn') && urlPath.includes('/creator-center/dashboard/live')) ||
    lower.includes('creator.shopee.vn') ||
    lower.includes('banhang.shopee.vn/creator-center/dashboard/live/')
  ) {
    platform = 'shopee';
  } else if (urlHost.includes('shop.tiktok.com') || lower.includes('shop.tiktok.com')) {
    platform = 'tiktok';
  }

  let id = '';
  if (parsedUrl) {
    const searchParams = parsedUrl.searchParams;
    const paramKeys = ['room_id', 'roomid', 'liveid', 'live_id', 'livestreamid', 'livestream_id', 'id'];
    for (const key of paramKeys) {
      const value = searchParams.get(key);
      if (value && /\d+/.test(value)) {
        const match = value.match(/\d+/);
        if (match) {
          id = match[0];
          break;
        }
      }
    }

    if (!id) {
      const segments = parsedUrl.pathname.split('/').filter(Boolean).reverse();
      for (const segment of segments) {
        const numeric = segment.match(/\d+/);
        if (numeric) {
          id = numeric[0];
          break;
        }
      }
    }

    if (!id && parsedUrl.hash) {
      const hashMatch = parsedUrl.hash.match(/\d+/);
      if (hashMatch) {
        id = hashMatch[0];
      }
    }
  }

  if (!id) {
    if (platform === 'shopee') {
      const shopeeMatch = trimmed.match(/live\/(\d+)/i);
      if (shopeeMatch) {
        id = shopeeMatch[1];
      }
    } else if (platform === 'tiktok') {
      const tiktokMatch = trimmed.match(/room_id=(\d+)/i);
      if (tiktokMatch) {
        id = tiktokMatch[1];
      }
    }
  }

  if (!id) {
    if (/^\d+$/.test(trimmed)) {
      id = trimmed;
    } else {
      const digitMatches = trimmed.match(/\d{5,}/g);
      if (digitMatches && digitMatches.length) {
        id = digitMatches[digitMatches.length - 1];
      }
    }
  }

  id = (id || '').replace(/[^0-9]/g, '');

  return { id, platform };
}

function extractLivestreamIdFromText(raw) {
  return parseLivestreamInput(raw).id;
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

async function readImageAsDataURL(source) {
  if (!source) {
    throw new Error('Không có ảnh để xử lý.');
  }

  if (typeof window === 'undefined') {
    throw new Error('OCR chỉ khả dụng trên trình duyệt.');
  }

  if (source instanceof Blob) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('Không đọc được file ảnh.'));
      reader.readAsDataURL(source);
    });
  }

  if (source instanceof HTMLImageElement) {
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(source, 0, 0);
    return canvas.toDataURL('image/png');
  }

  throw new Error('Định dạng ảnh không hỗ trợ.');
}

function inferPlatformFromEvent(event) {
  if (!event) return '';
  const direct = (event.platform || '').toString().toLowerCase();
  if (direct === 'tiktok' || direct === 'shopee') {
    return direct;
  }
  const hints = [event.brandChannel, event.sessionType, event.room, event.title]
    .filter(Boolean)
    .map(text => text.toString().toLowerCase());
  if (hints.some(text => text.includes('shopee') || text.includes('shp'))) {
    return 'shopee';
  }
  if (hints.some(text => text.includes('tiktok') || text.includes('tts'))) {
    return 'tiktok';
  }
  return '';
}

function normalizePlatformFromSheet(value) {
  const raw = (value || '').toString().trim().toLowerCase();
  if (!raw) return 'unknown';
  if (raw.includes('tiktok') || raw.includes('tik tok') || raw.includes('tts')) {
    return 'tiktok';
  }
  if (raw.includes('shopee') || raw.includes('shp')) {
    return 'shopee';
  }
  return 'unknown';
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

const HELP_TABS = [
  {
    id: 'quick-guide',
    label: 'Hướng dẫn nhanh',
    content: (
      <div className="help-tab-panel">
        <ol className="help-numbered">
          <li>
            <p>Truy cập và tìm lịch bằng tên</p>
            <p>Khi vào trang, bạn sẽ thấy cửa sổ yêu cầu nhập tên.</p>
            <p>Bước 1: Nhập tên của bạn vào ô “Ví dụ: Nguyễn Văn A”.</p>
            <p>Bước 2: Nhấn Xác thực để tiếp tục.</p>
          </li>
          <li>
            <p>Màn hình xem lịch làm việc</p>
            <p>Sau khi nhập tên, hệ thống sẽ hiển thị:</p>
            <ul>
              <li>Thanh tìm kiếm tên</li>
              <li>Nút tải lịch</li>
              <li>Nút sửa script nhắc live / Đăng xuất</li>
            </ul>
            <p>
              Bạn có thể đổi ngày hoặc áp dụng bộ lọc để xem lịch theo nhu cầu qua nút mở rộng bên cạnh nút tải lịch.
            </p>
          </li>
          <li>
            <p>Xem chi tiết ca làm</p>
            <p>Lịch được chia theo từng khung 2 giờ</p>
            <ul>
              <li>✏️ Chỉnh sửa script nhắc live</li>
              <li>📄 Điền report</li>
            </ul>
          </li>
          <li>
            <p>Tải lịch</p>
            <p>Nhấn nút Tải lịch (biểu tượng download) để xuất lịch làm việc theo ngày</p>
          </li>
          <li>
            <p>Quản lý tài khoản</p>
            <p>Ở góc trên cùng bên phải:</p>
            <ul>
              <li>Biểu tượng người dùng: chỉnh sửa script nhắc live</li>
              <li>Đăng xuất: thoát khỏi hệ thống</li>
            </ul>
          </li>
          <li>
            <p>Điền report ca làm</p>
            <ul>
              <li>Nhấn để mở công cụ tự động điền form báo cáo</li>
              <li>Hoàn thành theo yêu cầu của từng ca</li>
            </ul>
          </li>
        </ol>
      </div>
    )
  },
  {
    id: 'view-schedule',
    label: 'Xem lịch',
    content: (
      <div className="help-tab-panel">
        <ol className="help-numbered">
          <li>
            <p>Ô tìm kiếm nâng cao</p>
            <p>
              Ở đầu màn hình có thanh tìm kiếm cho phép bạn tìm nhanh theo nhiều tiêu chí: Brand, Session, Talent, Room, Coordinator
            </p>
            <p>👉 Chỉ cần nhập từ khóa bất kỳ, hệ thống sẽ hiển thị chính xác các ca liên quan.</p>
          </li>
          <li>
            <p>Chọn ngày</p>
            <p>Bạn có thể chọn ngày bắt đầu xem lịch trong tuỳ chọn mở rộng (mũi tên) bằng cách:</p>
            <ol>
              <li>Nhấn vào ô Ngày</li>
              <li>Lịch dạng popup sẽ xuất hiện</li>
              <li>Chọn ngày mong muốn</li>
              <li>Nhấn Xóa nếu muốn bỏ chọn</li>
            </ol>
          </li>
          <li>
            <p>Chọn số ngày muốn xem</p>
            <p>
              Ngay bên cạnh ô ngày là tùy chọn số ngày: 1 ngày, 2 ngày, 3 ngày, 4 ngày, 5 ngày, 6 ngày, 7 ngày, 15 ngày, 1 tháng
            </p>
            <p>👉 Chọn số ngày để hệ thống hiển thị lịch liên tục theo khoảng bạn mong muốn.</p>
          </li>
          <li>
            <p>Bộ lọc chi tiết</p>
            <p>
              Nhấn nút Bộ lọc trong tuỳ chọn mở rộng (mũi tên) để thu hẹp kết quả theo các thông tin chuyên sâu: Khung giờ, Brand, Session, Talent, Room, Coordinator
            </p>
            <p>Bạn có thể:</p>
            <ul>
              <li>Nhấn Xóa bộ lọc để làm mới</li>
              <li>Nhấn Xong để áp dụng</li>
            </ul>
          </li>
          <li>
            <p>Tải lịch</p>
            <p>Ở góc phải có nút Tải lịch: Nhấn một lần để tải lịch theo khoảng bạn đã chọn</p>
          </li>
          <li>
            <p>Giao diện lịch làm việc</p>
            <p>
              Sau khi nhập tên hoặc tìm kiếm, màn hình sẽ hiển thị danh sách các ca của mỗi người dùng theo từng khung giờ:
            </p>
            <p>
              Mỗi ca gồm: Tên brand + nền tảng (Shopee, TikTok…), Thời gian, Địa điểm, Session type, Host, Coordinator
            </p>
            <p>Các ca được nhóm rõ ràng theo mốc thời gian 2 giờ</p>
          </li>
        </ol>
      </div>
    )
  },
  {
    id: 'report',
    label: 'Điền report',
    content: (
      <div className="help-tab-panel">
        <ol className="help-numbered">
          <li>
            <p>Mở chức năng điền report</p>
            <p>Tại mỗi ca làm, bạn sẽ thấy nút: “Điền report” (biểu tượng cây bút)</p>
            <p>Nhấn vào nút để mở cửa sổ nhập liệu report.</p>
          </li>
          <li>
            <p>Giao diện nhập thông tin report</p>
            <p>Sau khi mở, bạn sẽ thấy giao diện "Điền Google Form" với các thông tin:</p>
            <p>🔹 Thông tin phiên live: Brand – Nền tảng, Ngày, Giờ live</p>
            <p>🔹 Các ô nhập dữ liệu</p>
            <ol>
              <li>Email → Tự điền vào lần đầu nhập liệu, các lần sau thông tin sẽ được hiển thị tự động</li>
              <li>Key live → Tự lấy từ dữ liệu hệ thống.</li>
              <li>
                Ảnh báo cáo → Bạn có thể:
                <ul>
                  <li>Nhấn Chọn tập tin để tải lên</li>
                  <li>Hoặc dán trực tiếp ảnh vào</li>
                  <li>
                    Lưu ý về ảnh hợp lệ để tách thông tin:
                    <ul>
                      <li>
                        SHP: ảnh 1 là ảnh chụp link dashboard + Doanh thu (đ), ảnh 2 là giờ bắt đầu. (Bạn chèn giúp mình ví dụ minh học cho ảnh 1 là file SHP_pic1 và ảnh 2 là file SHP_pic2 trong thư mục tổng của project)
                      </li>
                      <li>
                        TTS: ảnh 1 là ảnh chụp link dashboard, ảnh 2 là ảnh chụp giờ bắt đầu + GMV (đ). (Bạn chèn giúp mình ví dụ minh học cho ảnh 1 là file TTS_pic1 và ảnh 2 là file TTS_pic2 trong thư mục tổng của project)
                      </li>
                    </ul>
                  </li>
                  <li>
                    ⚠️ Hệ thống hỗ trợ tối đa 2 ảnh để tự động tách các thông tin trên và ảnh chụp chỉ chứa các trường cần nhập (không để lọt số khác vào ảnh).
                  </li>
                </ul>
              </li>
              <li>ID phiên 1 / ID phiên 2: Có thể nhập thủ công hoặc để hệ thống tự tách từ ảnh</li>
              <li>GMV: Nhập thủ công hoặc để hệ thống tự nhận dạng từ ảnh.</li>
              <li>Giờ bắt đầu: Tự động tách khi dán ảnh hoặc nhập theo định dạng thời gian</li>
            </ol>
            <p>Hệ thống sẽ hiển thị thông báo màu xanh: “Đã trích xuất ID phiên, GMV và giờ bắt đầu.” (nếu ảnh hợp lệ)</p>
            <div className="help-image-grid">
              <figure>
                <Image src={SHPPic1} alt="Ví dụ ảnh SHP_pic1" />
                <figcaption>SHP_pic1</figcaption>
              </figure>
              <figure>
                <Image src={SHPPic2} alt="Ví dụ ảnh SHP_pic2" />
                <figcaption>SHP_pic2</figcaption>
              </figure>
              <figure>
                <Image src={TTSPic1} alt="Ví dụ ảnh TTS_pic1" />
                <figcaption>TTS_pic1</figcaption>
              </figure>
              <figure>
                <Image src={TTSPic2} alt="Ví dụ ảnh TTS_pic2" />
                <figcaption>TTS_pic2</figcaption>
              </figure>
            </div>
          </li>
          <li>
            <p>Tạo link Form</p>
            <p>Sau khi điền toàn bộ thông tin:</p>
            <p>👉 Nhấn “Tạo link”</p>
            <p>Hệ thống lập tức mở giao diện mới hiển thị:</p>
            <ul>
              <li>Sửa: Chỉnh lại thông tin và tạo link lại.</li>
              <li>Copy link: Copy link điền form.</li>
              <li>Mở form: Mở trực tiếp Google Form với dữ liệu đã được điền sẵn.</li>
              <li>Đóng: Thoát giao diện report.</li>
            </ul>
          </li>
        </ol>
      </div>
    )
  },
  {
    id: 'zalo',
    label: 'Group Zalo',
    content: (
      <div className="help-tab-panel">
        <ol className="help-numbered">
          <li>
            <p>Nhấn vào biểu tượng Zalo trong từng ca làm</p>
            <p>Trong mỗi ca, bạn sẽ thấy nút Zalo màu xanh.</p>
            <p>👉 Khi nhấn vào nút này:</p>
            <ul>
              <li>Hệ thống sẽ dẫn bạn tới link group zalo của host/brand phù hợp</li>
              <li>Hệ thống tự động tạo tin nhắn nhắc live cho host dựa trên thông tin ca</li>
              <li>Tin nhắn sẽ được tự động copy vào bộ nhớ tạm</li>
              <li>Bạn chỉ cần dán/paste vào nhóm Zalo</li>
            </ul>
          </li>
          <li>
            <p>Chỉnh sửa Script nhắc live</p>
            <p>
              Để chỉnh sửa câu nhắc live, bạn nhấn vào biểu tượng: 👤 Sửa nhắc live (nằm góc trên bên phải màn hình lịch)
            </p>
            <p>Bạn có thể:</p>
            <ul>
              <li>✏️ Nhập câu nhắc theo ý bạn</li>
              <li>
                Lưu ý sử dụng đúng 2 biến để thế cho phần thời gian và địa điểm:
                <ul>
                  <li>Time</li>
                  <li>Room</li>
                </ul>
              </li>
              <li>👀 Xem ví dụ hiển thị</li>
              <li>
                Bên dưới sẽ có ví dụ hiển thị tự động giúp bạn kiểm tra xem câu nhắc đã đúng chưa.
              </li>
              <li>🔄 Khôi phục mặc định</li>
              <li>💾 Lưu</li>
              <li>Lưu script để hệ thống sử dụng cho tất cả các ca live sau này.</li>
            </ul>
          </li>
        </ol>
      </div>
    )
  }
];

export default function Page() {
  const [rawItems, setRawItems] = useState([]);      // dữ liệu raw từ sheet
  const [selectedDateStr, setSelectedDateStr] = useState(toYMD(new Date())); // yyyy-mm-dd
  const [daysToShow, setDaysToShow] = useState(1);   // số ngày hiển thị bắt đầu từ ngày chọn
  const [query, setQuery] = useState('');             // filter/search áp dụng
  const [searchInput, setSearchInput] = useState(''); // giá trị người dùng đang nhập
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [trialEmail, setTrialEmail] = useState('');
  const [trialEmailStatus, setTrialEmailStatus] = useState('idle');
  const [trialEmailError, setTrialEmailError] = useState('');
  const isMountedRef = useRef(true);
  const trialEmailFetchIdRef = useRef(0);
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
  const [hostScriptTemplate, setHostScriptTemplate] = useState(DEFAULT_HOST_MESSAGE_TEMPLATE);
  const [showHostScriptModal, setShowHostScriptModal] = useState(false);
  const [hostScriptDraft, setHostScriptDraft] = useState(DEFAULT_HOST_MESSAGE_TEMPLATE);
  const [hostScriptSaving, setHostScriptSaving] = useState(false);
  const [hostScriptSaveError, setHostScriptSaveError] = useState('');
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [activeHelpTabId, setActiveHelpTabId] = useState(HELP_TABS[0].id);
  const isActiveUser = trialUser?.status === 'active';
  const calendarCardBodyId = 'calendar-card-fields';
  const helpModalStorageKey = useMemo(() => {
    return trialUser?.user_id ? `help_modal_seen_${trialUser.user_id}` : null;
  }, [trialUser?.user_id]);

  useEffect(() => {
    const storedScript = typeof trialUser?.script === 'string' ? trialUser.script : '';
    const normalized = storedScript.trim() || DEFAULT_HOST_MESSAGE_TEMPLATE;
    setHostScriptTemplate(normalized);
  }, [trialUser?.script]);

  useEffect(() => {
    if (showHostScriptModal) return;
    const storedScript = typeof trialUser?.script === 'string' ? trialUser.script : '';
    const normalized = storedScript.trim() || DEFAULT_HOST_MESSAGE_TEMPLATE;
    setHostScriptDraft(normalized);
  }, [trialUser?.script, showHostScriptModal]);

  const updateSearch = useCallback((value, options = {}) => {
    const nextValue = typeof value === 'string' ? value : '';
    setSearchInput(nextValue);
    if (options.immediate) {
      setQuery(nextValue);
    }
  }, [setQuery, setSearchInput]);

  const toggleCalendarExpanded = useCallback(() => {
    setCalendarExpanded(prev => !prev);
  }, []);

  const openHelpModal = useCallback(() => {
    setActiveHelpTabId(HELP_TABS[0].id);
    setShowHelpModal(true);
  }, []);

  const closeHelpModal = useCallback(() => {
    if (helpModalStorageKey && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(helpModalStorageKey, 'true');
      } catch (error) {
        // ignore write errors
      }
    }
    setShowHelpModal(false);
  }, [helpModalStorageKey]);

  const handleSelectHelpTab = useCallback(tabId => {
    setActiveHelpTabId(tabId);
  }, []);

  const openHostScriptModal = useCallback(() => {
    setHostScriptDraft(hostScriptTemplate);
    setHostScriptSaveError('');
    setShowHostScriptModal(true);
  }, [hostScriptTemplate]);

  const closeHostScriptModal = useCallback(() => {
    setHostScriptSaveError('');
    setShowHostScriptModal(false);
  }, []);

  const handleSaveHostScriptTemplate = useCallback(async event => {
    event?.preventDefault?.();
    const normalized = hostScriptDraft.trim() || DEFAULT_HOST_MESSAGE_TEMPLATE;
    setHostScriptSaveError('');
    if (!trialUser?.user_id) {
      setHostScriptSaveError('Không tìm thấy thông tin người dùng để lưu script.');
      return;
    }
    setHostScriptSaving(true);
    try {
      const response = await fetch('/api/trial-users/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: normalized })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) {
        const message = typeof payload?.error === 'string'
          ? payload.error
          : 'Không lưu được script.';
        throw new Error(message);
      }
      const savedScript = typeof payload?.script === 'string' && payload.script.trim()
        ? payload.script
        : normalized;
      setHostScriptTemplate(savedScript);
      setTrialUser(prev => (prev ? { ...prev, script: savedScript } : prev));
      setShowHostScriptModal(false);
    } catch (err) {
      const message = typeof err?.message === 'string'
        ? err.message
        : 'Không lưu được script.';
      setHostScriptSaveError(message);
    } finally {
      setHostScriptSaving(false);
    }
  }, [hostScriptDraft, trialUser?.user_id, setTrialUser]);

  const handleResetHostScriptDraft = useCallback(() => {
    setHostScriptSaveError('');
    setHostScriptDraft(DEFAULT_HOST_MESSAGE_TEMPLATE);
  }, []);

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

  useEffect(() => {
    const handler = setTimeout(() => {
      setQuery(prev => (prev === searchInput ? prev : searchInput));
    }, 300);
    return () => {
      clearTimeout(handler);
    };
  }, [searchInput]);

  useEffect(() => {
    if (!trialUser?.user_id) return;
    if (typeof window === 'undefined') return;
    const loginCount = typeof trialUser?.login_count === 'number' ? trialUser.login_count : 0;
    if (loginCount > 1) return;
    try {
      const seen = window.localStorage.getItem(`help_modal_seen_${trialUser.user_id}`);
      if (!seen) {
        setActiveHelpTabId(HELP_TABS[0].id);
        setShowHelpModal(true);
      }
    } catch (error) {
      setActiveHelpTabId(HELP_TABS[0].id);
      setShowHelpModal(true);
    }
  }, [trialUser?.user_id, trialUser?.login_count]);

  const findHostLink = useCallback(hostName => {
    if (!hostName) return null;
    const normalized = hostName.trim();
    if (!normalized) return null;
    return hostLinkMap.get(normalized.toLowerCase()) || null;
  }, [hostLinkMap]);

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

  const findBrandLink = useMemo(() => {
    const cache = new Map();
    return brandName => {
      if (!brandName) return null;
      const normalized = brandName.trim();
      if (!normalized) return null;
      const cacheKey = normalized.toLowerCase();
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
      }
      const targetMeta = createBrandMetadata(normalized);
      const targetTokens = targetMeta.tokens;

      if (!targetMeta.canonical && !targetMeta.brandCore && !targetTokens.size) {
        cache.set(cacheKey, null);
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
        cache.set(cacheKey, null);
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
      if (!best) {
        cache.set(cacheKey, null);
        return null;
      }

      if (best.missingTokens > 0 && targetTokens.size) {
        cache.set(cacheKey, null);
        return null;
      }

      if (best.similarity <= 0) {
        cache.set(cacheKey, null);
        return null;
      }

      if (best.similarity < 0.3) {
        cache.set(cacheKey, null);
        return null;
      }

      const link = best.entry.link;
      cache.set(cacheKey, link);
      return link;
    };
  }, [normalizedBrandLinks]);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const loadTrialEmail = useCallback(async () => {
    if (!isMountedRef.current) {
      return { ok: false, email: '' };
    }

    if (!isActiveUser || !trialUser?.user_id) {
      trialEmailFetchIdRef.current += 1;
      setTrialEmail('');
      setTrialEmailStatus('idle');
      setTrialEmailError('');
      return { ok: false, email: '' };
    }

    const fetchId = trialEmailFetchIdRef.current + 1;
    trialEmailFetchIdRef.current = fetchId;

    setTrialEmailStatus(prev => (prev === 'saving' ? prev : 'loading'));
    setTrialEmailError('');

    try {
      const res = await fetch('/api/trial-users/email', { method: 'GET' });
      let payload = null;
      try {
        payload = await res.json();
      } catch (err) {
        payload = null;
      }

      if (!isMountedRef.current || trialEmailFetchIdRef.current !== fetchId) {
        return { ok: false, email: '' };
      }

      if (res.status === 401 || res.status === 403) {
        setTrialEmail('');
        setTrialEmailStatus(prev => (prev === 'saving' ? prev : 'ready'));
        setTrialEmailError('');
        return { ok: false, email: '' };
      }

      if (!res.ok) {
        const message = typeof payload?.error === 'string'
          ? payload.error
          : 'Không lấy được email.';
        setTrialEmail('');
        setTrialEmailStatus(prev => (prev === 'saving' ? prev : 'error'));
        setTrialEmailError(message);
        return { ok: false, email: '' };
      }

      const exists = Boolean(payload?.exists);
      const fetchedEmail = typeof payload?.email === 'string' ? payload.email.trim() : '';
      if (exists && fetchedEmail) {
        setTrialEmail(fetchedEmail);
      } else {
        setTrialEmail('');
      }
      setTrialEmailStatus(prev => (prev === 'saving' ? prev : 'ready'));
      setTrialEmailError('');
      return { ok: true, email: exists && fetchedEmail ? fetchedEmail : '' };
    } catch (err) {
      if (!isMountedRef.current || trialEmailFetchIdRef.current !== fetchId) {
        return { ok: false, email: '' };
      }
      console.error('Fetch trial email failed', err);
      setTrialEmail('');
      setTrialEmailStatus(prev => (prev === 'saving' ? prev : 'error'));
      setTrialEmailError('Không lấy được email. Vui lòng nhập thủ công.');
      return { ok: false, email: '' };
    }
  }, [isActiveUser, trialUser?.user_id]);

  function openPrefillModalForEvent(event) {
    if (!event) return;
    if (isActiveUser && trialEmailStatus !== 'loading' && trialEmailStatus !== 'saving') {
      loadTrialEmail();
    }
    const initialEmail = typeof trialEmail === 'string' ? trialEmail.trim() : '';
    const platformFromSheet = normalizePlatformFromSheet(event.platform || event.platformLabel || '');
    const fallbackPlatform = inferPlatformFromEvent(event);
    const initialPlatform = platformFromSheet !== 'unknown'
      ? platformFromSheet
      : fallbackPlatform || 'unknown';
    setPrefillModal({
      event,
      values: {
        email: initialEmail,
        keyLivestream: (event.keyLivestream || '').trim(),
        id1: '',
        id2: '',
        orders: '',
        gmv: '',
        startTimeText: '',
        startTimeEncoded: ''
      },
      platformDetected: initialPlatform,
      emailLocked: Boolean(initialEmail),
      emailUnlockedManually: false,
      showOptionalId: false,
      ocrStatus: 'idle',
      ocrProgress: 0,
      ocrError: '',
      ocrMessage: '',
      ocrFileName: '',
      ocrImages: [],
      gmvCandidates: [],
      gmvNeedsReview: false,
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
      const updateResult = typeof updater === 'function' ? updater(prev.values) : updater;
      const updates = updateResult && typeof updateResult === 'object' ? { ...updateResult } : {};
      let nextPlatform = prev.platformDetected || 'unknown';
      if (Object.prototype.hasOwnProperty.call(updates, 'platformDetected')) {
        const platformValue = updates.platformDetected;
        if (platformValue === 'shopee' || platformValue === 'tiktok' || platformValue === 'unknown') {
          nextPlatform = platformValue;
        } else {
          nextPlatform = 'unknown';
        }
        delete updates.platformDetected;
      }

      const clearedErrors = { ...(prev.formErrors || {}) };
      for (const key of Object.keys(updates)) {
        if (clearedErrors[key]) {
          delete clearedErrors[key];
        }
      }
      return {
        ...prev,
        values: { ...prev.values, ...updates },
        formErrors: clearedErrors,
        copyFeedback: '',
        platformDetected: nextPlatform
      };
    });
  }

  function handlePrefillFieldChange(field, value) {
    if (field === 'email') {
      setTrialEmailError('');
    }

    const sanitizedGmvValue = field === 'gmv' ? sanitizeNumericString(value) : null;
    setPrefillValues(values => {
      const next = { ...values };
      if (field === 'gmv') {
        next.gmv = sanitizedGmvValue || '';
      } else if (field === 'orders') {
        next.orders = sanitizeNumericString(value);
      } else if (field === 'id1') {
        const parsed = parseLivestreamInput(value);
        next.id1 = parsed.id || sanitizeNumericString(value);
        if (parsed.platform && parsed.platform !== 'unknown') {
          return { ...next, platformDetected: parsed.platform };
        }
        return next;
      } else if (field === 'id2') {
        const extracted = extractLivestreamIdFromText(value);
        next.id2 = extracted || sanitizeNumericString(value);
      } else if (field === 'email') {
        next.email = value;
      } else if (field === 'keyLivestream') {
        next.keyLivestream = value;
      } else if (field === 'startTimeText') {
        next.startTimeText = value;
        next.startTimeEncoded = '';
      }
      return next;
    });

    if (field === 'gmv') {
      const sanitized = sanitizedGmvValue || '';
      setPrefillModal(prev => {
        if (!prev || !prev.gmvNeedsReview) return prev;
        const candidates = Array.isArray(prev.gmvCandidates) ? prev.gmvCandidates : [];
        if (!sanitized || candidates.includes(sanitized)) {
          return { ...prev, gmvNeedsReview: false };
        }
        return prev;
      });
    }
  }

  function handleSelectGmvCandidate(candidate) {
    const sanitized = sanitizeNumericString(candidate);
    if (!sanitized) return;
    setPrefillModal(prev => {
      if (!prev) return prev;
      const currentValues = prev.values || {};
      const nextValues = { ...currentValues, gmv: sanitized };
      const nextErrors = { ...(prev.formErrors || {}) };
      if (nextErrors.gmv) {
        delete nextErrors.gmv;
      }
      return {
        ...prev,
        values: nextValues,
        formErrors: nextErrors,
        gmvNeedsReview: false
      };
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
    setTrialEmailError('');
    setPrefillModal(prev => (prev ? { ...prev, emailLocked: false, emailUnlockedManually: true } : prev));
  }

  const handlePrefillOcr = useCallback(async (input) => {
    if (!prefillModal) return;

    const sources = Array.isArray(input) ? input : [input];
    const validSources = sources.filter(Boolean);
    if (!validSources.length) return;

    const currentPrefill = prefillModal;
    const platformFromSheet = normalizePlatformFromSheet(
      currentPrefill?.event?.platform || currentPrefill?.event?.platformLabel || ''
    );
    const preferredPlatform = currentPrefill?.platformDetected && currentPrefill.platformDetected !== 'unknown'
      ? currentPrefill.platformDetected
      : platformFromSheet !== 'unknown'
        ? platformFromSheet
        : inferPlatformFromEvent(currentPrefill?.event) || 'unknown';

    if (preferredPlatform === 'unknown') {
      setPrefillModal(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          ocrStatus: 'error',
          ocrProgress: 0,
          ocrError: 'Không xác định được sàn để OCR. Vui lòng kiểm tra dữ liệu sheet.'
        };
      });
      return;
    }

    const preparedImages = [];
    for (let idx = 0; idx < validSources.length; idx += 1) {
      let source = validSources[idx];
      if (!source) continue;
      if (
        typeof window !== 'undefined' &&
        typeof File !== 'undefined' &&
        source instanceof Blob &&
        !(source instanceof File)
      ) {
        const extension = (source.type && source.type.split('/')[1]) || 'png';
        try {
          source = new File(
            [source],
            `clipboard-${Date.now()}-${idx + 1}.${extension}`,
            { type: source.type || 'image/png' }
          );
        } catch (error) {
          // ignore and use the original blob
        }
      }

      const name = typeof source === 'object' && source && 'name' in source && source.name
        ? source.name
        : `Ảnh ${idx + 1}`;
      const dataUrl = await readImageAsDataURL(source);
      preparedImages.push({
        dataUrl,
        name: name || `Ảnh ${idx + 1}`
      });
    }

    const existingImages = Array.isArray(currentPrefill?.ocrImages) ? currentPrefill.ocrImages : [];
    let combinedImages = [...existingImages, ...preparedImages];
    let truncatedMessage = '';
    if (combinedImages.length > 2) {
      combinedImages = combinedImages.slice(combinedImages.length - 2);
      truncatedMessage = 'Chỉ hỗ trợ tối đa 2 ảnh, đã giữ lại 2 ảnh mới nhất.';
    }

    if (!combinedImages.length) {
      setPrefillModal(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          ocrStatus: 'error',
          ocrProgress: 0,
          ocrError: 'Không có ảnh để xử lý.'
        };
      });
      return;
    }

    const fileNameDisplay = combinedImages
      .map((img, index) => img.name || `Ảnh ${index + 1}`)
      .join(', ');

    setPrefillModal(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        ocrStatus: 'running',
        ocrProgress: 0,
        ocrError: '',
        ocrMessage: truncatedMessage,
        ocrFileName: fileNameDisplay,
        ocrImages: combinedImages,
        copyFeedback: ''
      };
    });

    try {
      const existingGmv = sanitizeNumericString(currentPrefill?.values?.gmv);
      const requestBody = {
        platform: preferredPlatform,
        imagesBase64: combinedImages.map(img => img.dataUrl)
      };
      if (preferredPlatform === 'shopee') {
        requestBody.options = {
          ambiguityMode: 'returnBoth',
          gmvOverride: existingGmv || null
        };
      }

      const resp = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const payload = await resp.json().catch(() => null);
      if (!resp.ok || payload?.ok !== true) {
        const message = payload?.error || 'Không trích xuất được dữ liệu.';
        throw new Error(message);
      }

      const data = payload.data || {};
      const detectedPlatform = data.platformDetected;
      const gmvValue = sanitizeNumericString(data.gmv);
      const ordersValue = sanitizeNumericString(data.orders);
      const startTimeValue = typeof data.startTime === 'string' ? data.startTime.trim() : '';
      const startTimeEncoded = typeof data.startTimeEncoded === 'string' ? data.startTimeEncoded : '';
      const rawSessionId = sanitizeNumericString(data.sessionId);
      const rawCandidateList = Array.isArray(data.gmvCandidates) ? data.gmvCandidates : [];
      const normalizedCandidates = Array.from(new Set(
        rawCandidateList
          .map(item => sanitizeNumericString(item))
          .filter(Boolean)
      ));
      const reviewNeeded = Boolean(
        data.needsReview &&
        detectedPlatform === 'shopee' &&
        normalizedCandidates.length >= 2
      );

      const hasId = Boolean(rawSessionId);
      const hasGmv = Boolean(gmvValue);
      const hasOrders = Boolean(ordersValue);
      const hasStart = Boolean(startTimeValue);

      const platformLabel = detectedPlatform === 'tiktok'
        ? 'TikTok Shop Live'
        : detectedPlatform === 'shopee'
          ? 'Shopee Live'
          : preferredPlatform === 'tiktok'
            ? 'TikTok Shop Live'
            : preferredPlatform === 'shopee'
              ? 'Shopee Live'
              : '';

      const extractedFields = [];
      if (hasId) extractedFields.push('ID phiên');
      if (hasGmv) extractedFields.push('GMV');
      if (hasOrders) extractedFields.push('đơn hàng');
      if (hasStart) extractedFields.push('giờ bắt đầu');

      let successMessage = '';
      if (extractedFields.length === 1) {
        successMessage = `Đã trích xuất ${extractedFields[0]}.`;
      } else if (extractedFields.length > 1) {
        const last = extractedFields[extractedFields.length - 1];
        const head = extractedFields.slice(0, -1).join(', ');
        successMessage = `Đã trích xuất ${head} và ${last}.`;
      }

      if (reviewNeeded) {
        const reviewMessage = 'Có 2 số GMV, vui lòng chọn số đúng.';
        successMessage = successMessage ? `${successMessage} ${reviewMessage}` : reviewMessage;
      }

      if (successMessage && platformLabel) {
        successMessage = `${successMessage} (${platformLabel}).`;
      } else if (!successMessage && platformLabel) {
        successMessage = `(${platformLabel})`;
      }

      if (truncatedMessage) {
        successMessage = successMessage ? `${successMessage} ${truncatedMessage}` : truncatedMessage;
      }

      const hasAny = hasId || hasGmv || hasOrders || hasStart;

      setPrefillModal(prev => {
        if (!prev) return prev;
        const nextValues = { ...prev.values };
        if (hasId) {
          nextValues.id1 = rawSessionId;
        }
        if (hasGmv) {
          nextValues.gmv = gmvValue;
        }
        if (hasOrders) {
          nextValues.orders = ordersValue;
        }
        if (hasStart) {
          nextValues.startTimeText = startTimeValue;
        }
        nextValues.startTimeEncoded = startTimeEncoded;

        const clearedErrors = { ...(prev.formErrors || {}) };
        if (hasId && clearedErrors.id1) delete clearedErrors.id1;
        if (hasGmv && clearedErrors.gmv) delete clearedErrors.gmv;
        if (hasStart && clearedErrors.startTimeText) delete clearedErrors.startTimeText;

        return {
          ...prev,
          values: nextValues,
          platformDetected: detectedPlatform || prev.platformDetected || preferredPlatform,
          formErrors: clearedErrors,
          gmvCandidates: normalizedCandidates,
          gmvNeedsReview: reviewNeeded,
          ocrStatus: hasAny ? 'success' : 'error',
          ocrProgress: 1,
          ocrMessage: hasAny ? successMessage : (truncatedMessage || 'Không trích xuất được dữ liệu, vui lòng nhập tay.'),
          ocrError: hasAny ? '' : 'Không trích xuất được dữ liệu, vui lòng nhập tay.'
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
  }, [prefillModal]);

  const handleRemoveOcrImage = useCallback((index) => {
    setPrefillModal(prev => {
      if (!prev) return prev;
      const images = Array.isArray(prev.ocrImages) ? prev.ocrImages : [];
      if (index < 0 || index >= images.length) return prev;
      const nextImages = images.filter((_, idx) => idx !== index);
      const fileNameDisplay = nextImages
        .map((img, idx) => (img && img.name ? img.name : `Ảnh ${idx + 1}`))
        .join(', ');
      return {
        ...prev,
        ocrImages: nextImages,
        ocrFileName: fileNameDisplay,
        ocrStatus: nextImages.length ? prev.ocrStatus : 'idle',
        ocrMessage: nextImages.length ? prev.ocrMessage : '',
        ocrError: nextImages.length ? prev.ocrError : '',
        copyFeedback: ''
      };
    });
  }, []);


  
  useEffect(() => {
    if (!prefillModal) return;

    function handlePasteEvent(event) {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;
      const items = clipboardData.items ? Array.from(clipboardData.items) : [];
      const imageFiles = items
        .filter(item => item && item.type && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter(Boolean);
      if (!imageFiles.length) return;
      event.preventDefault();
      handlePrefillOcr(imageFiles);
    }

    window.addEventListener('paste', handlePasteEvent);
    return () => {
      window.removeEventListener('paste', handlePasteEvent);
    };
  }, [prefillModal, handlePrefillOcr]);

  async function persistTrialUserEmail(email) {
    if (!isActiveUser) {
      return { ok: true, email };
    }

    const trimmed = (email || '').trim();
    if (!trimmed) {
      return { ok: false, error: 'Email không hợp lệ.' };
    }

    setTrialEmailStatus('saving');
    setTrialEmailError('');

    try {
      const res = await fetch('/api/trial-users/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed })
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch (err) {
        payload = null;
      }
      if (!res.ok || payload?.ok !== true) {
        const message = typeof payload?.error === 'string'
          ? payload.error
          : 'Không lưu được email.';
        throw new Error(message);
      }
      const savedEmail = typeof payload?.email === 'string' ? payload.email.trim() : trimmed;
      setTrialEmail(savedEmail);
      setTrialEmailStatus('ready');
      setTrialEmailError('');
      return { ok: true, email: savedEmail };
    } catch (err) {
      const message = err?.message || 'Không lưu được email.';
      console.error('Lưu email thất bại', err);
      setTrialEmailStatus('error');
      setTrialEmailError(message);
      return { ok: false, error: message };
    }
  }

  useEffect(() => {
    if (!prefillModal) return;
    setPrefillModal(prev => {
      if (!prev) return prev;
      const storedEmail = typeof trialEmail === 'string' ? trialEmail.trim() : '';
      let changed = false;
      const next = { ...prev };

      if (trialEmailStatus === 'ready') {
        if (storedEmail) {
          if (!prev.emailUnlockedManually) {
            const currentEmail = typeof prev.values?.email === 'string' ? prev.values.email : '';
            if (currentEmail !== storedEmail) {
              next.values = { ...prev.values, email: storedEmail };
              changed = true;
            }
            if (!prev.emailLocked) {
              next.emailLocked = true;
              changed = true;
            }
          }
        } else if (prev.emailLocked && !prev.emailUnlockedManually) {
          next.emailLocked = false;
          changed = true;
        }
      } else if ((trialEmailStatus === 'error' || trialEmailStatus === 'idle') && prev.emailLocked && !prev.emailUnlockedManually && !storedEmail) {
        next.emailLocked = false;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [trialEmailStatus, trialEmail, prefillModal]);

  useEffect(() => {
    loadTrialEmail();
  }, [loadTrialEmail]);

  async function handleGeneratePrefilledLink(event) {
    event.preventDefault();
    if (!prefillModal) return;
    const rawValues = prefillModal.values || {};

    const email = (rawValues.email || '').trim();
    const keyLivestream = (rawValues.keyLivestream || '').trim();
    const id1 = extractLivestreamIdFromText(rawValues.id1) || sanitizeNumericString(rawValues.id1);
    const id2Raw = extractLivestreamIdFromText(rawValues.id2) || sanitizeNumericString(rawValues.id2);
    const gmv = sanitizeNumericString(rawValues.gmv);
    const startTimeText = (rawValues.startTimeText || '').trim();
    const startTimeEncoded = typeof rawValues.startTimeEncoded === 'string'
      ? rawValues.startTimeEncoded
      : '';

    const errors = {};
    if (!isValidEmail(email)) {
      errors.email = 'Email không hợp lệ.';
    }
    if (!keyLivestream) {
      errors.keyLivestream = 'Vui lòng nhập Key live.';
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
      startTimeText,
      startTimeEncoded
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

    const trimmedStoredEmail = (trialEmail || '').trim();
    const shouldPersistEmail = isActiveUser
      && normalizedValues.email
      && (trialEmailStatus !== 'ready' || normalizedValues.email !== trimmedStoredEmail);

    if (shouldPersistEmail) {
      const result = await persistTrialUserEmail(normalizedValues.email);
      if (!result.ok) {
        const message = result.error || 'Không lưu được email.';
        setPrefillModal(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            values: { ...prev.values, ...normalizedValues },
            formErrors: { ...prev.formErrors, email: message },
            link: '',
            copyFeedback: '',
            emailLocked: false,
            emailUnlockedManually: true,
          };
        });
        return;
      }
      normalizedValues.email = result.email;
      setPrefillModal(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          values: { ...prev.values, ...normalizedValues, email: result.email },
          emailLocked: true,
          emailUnlockedManually: false,
        };
      });
    } else if (normalizedValues.email) {
      setPrefillModal(prev => (prev ? { ...prev, emailLocked: true, emailUnlockedManually: false } : prev));
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
      updateSearch(trialUser.name, { immediate: true });
      setHasAppliedLoginSearch(true);
    }
  }, [trialUser, hasAppliedLoginSearch, updateSearch]);

  useEffect(() => {
    if (!isActiveUser || !trialUser?.user_id) {
      setTrialEmail('');
      setTrialEmailStatus('idle');
      setTrialEmailError('');
      return;
    }

    let cancelled = false;
    setTrialEmailStatus('loading');
    setTrialEmailError('');

    (async () => {
      try {
        const res = await fetch('/api/trial-users/email', { method: 'GET' });
        let payload = null;
        try {
          payload = await res.json();
        } catch (err) {
          payload = null;
        }
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setTrialEmail('');
          setTrialEmailStatus('ready');
          setTrialEmailError('');
          return;
        }
        if (!res.ok) {
          const message = typeof payload?.error === 'string'
            ? payload.error
            : 'Không lấy được email.';
          setTrialEmail('');
          setTrialEmailStatus('error');
          setTrialEmailError(message);
          return;
        }
        const exists = Boolean(payload?.exists);
        const fetchedEmail = typeof payload?.email === 'string' ? payload.email.trim() : '';
        if (exists && fetchedEmail) {
          setTrialEmail(fetchedEmail);
        } else {
          setTrialEmail('');
        }
        setTrialEmailStatus('ready');
        setTrialEmailError('');
      } catch (err) {
        if (cancelled) return;
        console.error('Fetch trial email failed', err);
        setTrialEmail('');
        setTrialEmailStatus('error');
        setTrialEmailError('Không lấy được email. Vui lòng nhập thủ công.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isActiveUser, trialUser?.user_id]);

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
    updateSearch('', { immediate: true });
    setTrialEmail('');
    setTrialEmailStatus('idle');
    setTrialEmailError('');
    setTrialUser(null);
    setNameInput('');
    setShowLoginModal(true);
    setLoggingIn(false);
    setLoginError('');
    setHasAppliedLoginSearch(false);
    resetFilters();
    setShowFiltersModal(false);
    try {
      fetch('/api/trial-users/email', { method: 'DELETE' }).catch(() => {});
    } catch (err) {
      console.warn('Không thể xóa cookie người dùng thử', err);
    }
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
      const roomParts = Array.isArray(it.roomParts)
        ? it.roomParts.map(part => (part || '').toString().trim()).filter(Boolean)
        : typeof it.room === 'string'
          ? it.room.split('/').map(part => part.trim()).filter(Boolean)
          : [];
      const primaryRoom = typeof it.primaryRoom === 'string' ? it.primaryRoom.trim() : '';
      const fallbackRoomRaw = typeof it.room === 'string' ? it.room.trim() : '';
      const fallbackRoom = fallbackRoomRaw.replace(/\//g, '').trim() ? fallbackRoomRaw : '';
      const roomLabel = roomParts.length
        ? roomParts.join(' / ')
        : fallbackRoom;
      out.push({
        title: it.brandChannel,           // Summary = brandChannel
        start: slot.start,
        end: slot.end,
        sessionType: it.sessionType,
        talent1: it.talent1,
        talent2: it.talent2,
        room: roomLabel,
        roomParts,
        primaryRoom,
        coor: it.coor,
        keyLivestream: it.keyLivestream,
        platformLabel: it.platform,
        platform: normalizePlatformFromSheet(it.platform),
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
    if (!isActiveUser) {
      return {
        brands: [],
        times: [],
        rooms: [],
        sessionTypes: [],
        hosts: [],
        coordinators: []
      };
    }

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
  }, [selectedDayEvents, isActiveUser]);

  const hasActiveFilters = useMemo(
    () => Boolean(filterBrand || filterTime || filterRoom || filterSessionType || filterHost || filterCoordinator),
    [filterBrand, filterTime, filterRoom, filterSessionType, filterHost, filterCoordinator]
  );
  const filterButtonLabel = hasActiveFilters ? 'Bộ lọc (đang áp dụng)' : 'Bộ lọc';

  // Áp dụng filter/search (theo text)
  const filteredEvents = useMemo(() => {
    if (!isActiveUser) return [];
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
  }, [selectedDayEvents, query, filterBrand, filterTime, filterRoom, filterSessionType, filterHost, filterCoordinator, isActiveUser]);

  // Group theo bucket 2 giờ (dựa trên start time)
  const deferredFilteredEvents = useDeferredValue(filteredEvents);

  const visibleEvents = useMemo(
    () => (isActiveUser ? deferredFilteredEvents : []),
    [isActiveUser, deferredFilteredEvents]
  );

  const eventComputedMap = useMemo(() => {
    const map = new Map();
    for (const e of visibleEvents) {
      const seen = new Set();
      const hostEntries = [];
      for (const raw of [e.talent1, e.talent2]) {
        const name = (raw || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        hostEntries.push({ name, link: findHostLink(name) });
      }
      map.set(e, {
        brandLink: findBrandLink(e.title),
        hostEntries,
        hostZaloMessage: buildHostZaloMessage(e, hostScriptTemplate)
      });
    }
    return map;
  }, [visibleEvents, findBrandLink, findHostLink, hostScriptTemplate]);

  const groupedSingleDay = useMemo(() => {
    if (daysToShow > 1) return [];
    return groupEventsByBucket(visibleEvents);
  }, [visibleEvents, daysToShow]);

  const groupedMultipleDays = useMemo(() => {
    if (daysToShow <= 1) return [];
    const dayMap = new Map();
    for (const e of visibleEvents) {
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
  }, [visibleEvents, daysToShow]);

  const prefillValues = prefillModal?.values || {};
  const prefillFormErrors = prefillModal?.formErrors || {};
  const showPrefillOptionalId = prefillModal ? (prefillModal.showOptionalId || Boolean(prefillValues.id2)) : false;
  const gmvCandidateOptions = Array.isArray(prefillModal?.gmvCandidates) ? prefillModal.gmvCandidates : [];
  const showGmvCandidatePrompt = Boolean(
    prefillModal?.gmvNeedsReview &&
    prefillModal?.platformDetected === 'shopee' &&
    gmvCandidateOptions.length >= 2
  );
  const sanitizedPrefillGmv = sanitizeNumericString(prefillValues.gmv);
  const ocrStatus = prefillModal?.ocrStatus || 'idle';
  const successMessage = ocrStatus === 'success' ? (prefillModal?.ocrMessage || '') : '';
  const ocrErrorMessage = ocrStatus === 'error' ? (prefillModal?.ocrError || '') : '';

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

  const isEmailBusy = trialEmailStatus === 'loading' || trialEmailStatus === 'saving';

  return (
    <div className="container">
      <div className="page-header">
        <h1>Lịch làm việc</h1>
        {trialUser && (
          <div className="page-header-actions">
            <button
              type="button"
              className="icon-button icon-button--with-label"
              onClick={openHostScriptModal}
              disabled={loggingIn}
              aria-label="Sửa nhắc live"
              title="Sửa nhắc live"
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
                  d="M15.75 9A3.75 3.75 0 118.25 9a3.75 3.75 0 017.5 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 19.5a8.25 8.25 0 0115 0"
                />
              </svg>
              <span className="icon-button-label" aria-hidden="true">Sửa nhắc live</span>
            </button>
            <HelpButton onClick={openHelpModal} disabled={loggingIn} />
            <button
              type="button"
              className="icon-button icon-button--with-label"
              onClick={handleLogout}
              disabled={loggingIn}
              aria-label="Đăng xuất"
              title="Đăng xuất"
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
              <span className="icon-button-label" aria-hidden="true">Đăng xuất</span>
            </button>
          </div>
        )}
      </div>

      <div className="calendar-card" data-expanded={calendarExpanded}>
        <div className="calendar-card-header">
          <div className="calendar-card-title">
            <label className="calendar-card-label" htmlFor="calendar-search">Tìm kiếm</label>
            <div className="calendar-card-search">
              <div className="calendar-card-search-input">
                <input
                  id="calendar-search"
                  type="text"
                  className="text-input"
                  placeholder="Brand / Session / Talent / Room / Coordinator…"
                  value={searchInput}
                  onChange={e => updateSearch(e.target.value)}
                  disabled={!isActiveUser}
                />
                {searchInput && (
                  <button
                    type="button"
                    className="btn ghost calendar-card-clear"
                    onClick={() => updateSearch('', { immediate: true })}
                    disabled={!isActiveUser}
                  >
                    Xóa
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="calendar-card-actions">
            <button
              type="button"
              className="icon-button icon-button--with-label calendar-card-action"
              onClick={downloadICSForDay}
              disabled={!isActiveUser}
              aria-label="Tải lịch đang xem (.ics)"
              title="Tải lịch đang xem (.ics)"
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
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7.5 11.25l4.5 4.5 4.5-4.5"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v11.25"
                />
              </svg>
              <span className="icon-button-label" aria-hidden="true">Tải lịch</span>
            </button>
            <button
              type="button"
              className="calendar-card-toggle calendar-card-action"
              onClick={toggleCalendarExpanded}
              aria-expanded={calendarExpanded}
              aria-controls={calendarCardBodyId}
              aria-label={calendarExpanded ? 'Thu gọn cài đặt lịch' : 'Mở cài đặt lịch'}
            >
              <svg
                className="calendar-card-chevron"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={calendarExpanded ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
                />
              </svg>
              <span className="sr-only">{calendarExpanded ? 'Thu gọn' : 'Mở rộng'}</span>
            </button>
          </div>
        </div>
        <div
          id={calendarCardBodyId}
          className="calendar-card-body"
          aria-hidden={!calendarExpanded}
          style={{ display: calendarExpanded ? undefined : 'none' }}
        >
          <div className="calendar-card-controls">
            <div className="calendar-card-field">
              <label htmlFor="pick-date">Ngày</label>
              <input
                id="pick-date"
                type="date"
                className="date-input"
                value={selectedDateStr}
                onChange={e => setSelectedDateStr(e.target.value)}
              />
            </div>
            <div className="calendar-card-field">
              <label htmlFor="days-to-show">Số ngày</label>
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
          </div>
          <div className="calendar-card-footer">
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
          </div>
        </div>
      </div>

      {/* Danh sách nhóm theo 2h */}
      {!isActiveUser ? (
        <p>Vui lòng nhập tên để xem lịch làm việc.</p>
      ) : loading ? (
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
                    const computed = eventComputedMap.get(e) || {
                      brandLink: null,
                      hostEntries: [],
                      hostZaloMessage: buildHostZaloMessage(e, hostScriptTemplate)
                    };
                    const { brandLink, hostEntries, hostZaloMessage } = computed;
                    const handleHostZaloClick = () => {
                      void copyTextToClipboard(hostZaloMessage);
                    };
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
                          <span className="prefill-trigger-label" aria-hidden="true">Điền form</span>
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
                                        onClick={handleHostZaloClick}
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
              const computed = eventComputedMap.get(e) || {
                brandLink: null,
                hostEntries: [],
                hostZaloMessage: buildHostZaloMessage(e, hostScriptTemplate)
              };
              const { brandLink, hostEntries, hostZaloMessage } = computed;
              const handleHostZaloClick = () => {
                void copyTextToClipboard(hostZaloMessage);
              };
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
                  <span className="prefill-trigger-label" aria-hidden="true">Điền form</span>
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
                                  onClick={handleHostZaloClick}
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

      <HelpModal
        isOpen={showHelpModal}
        onClose={closeHelpModal}
        tabs={HELP_TABS}
        activeTabId={activeHelpTabId}
        onSelectTab={handleSelectHelpTab}
      />

      {prefillModal && (
  <div
    className="modal-backdrop prefill-modal-backdrop"
  >
    <div
      className="modal-card prefill-modal-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prefill-modal-title"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="prefill-modal-header">
        <div className="prefill-modal-title-block">
          <h2 id="prefill-modal-title">Điền Google Form</h2>

          <p className="prefill-modal-subtitle">
            {prefillModal.event?.title || 'Phiên livestream'}
          </p>

          <div className="prefill-modal-summary">
            <span className="prefill-modal-summary-item">
              <span aria-hidden="true">📅</span>
              <span>{prefillModal.event?.dateLabel || '—'}</span>
            </span>

            <span className="prefill-modal-summary-item">
              <span aria-hidden="true">⏰</span>
              <span>
                {prefillModal.event?.start && prefillModal.event?.end
                  ? `${fmtHM(prefillModal.event.start)}–${fmtHM(
                      prefillModal.event.end
                    )}`
                  : '—'}
              </span>
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
                  <div className="prefill-result-item prefill-result-item--email">
                    <span className="prefill-result-label">Email</span>
                    <span className="prefill-result-value">
                      {prefillValues.email || '—'}
                    </span>
                  </div>


                    <div className="prefill-result-item">
                      <span className="prefill-result-label">Key live</span>
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
                    <div className="prefill-field-header">
                      <label htmlFor="prefill-email">Email</label>
                      {prefillModal.emailLocked && (
                        <button
                          type="button"
                          className="prefill-edit-button"
                          onClick={unlockPrefillEmail}
                          disabled={isEmailBusy}
                        >
                          Sửa
                        </button>
                      )}
                    </div>
                    <div className="prefill-email-wrapper" aria-busy={isEmailBusy}>
                      <input
                        id="prefill-email"
                        type="email"
                        className="text-input prefill-email-input"
                        placeholder="example@gmail.com"
                        value={prefillValues.email || ''}
                        onChange={e => handlePrefillFieldChange('email', e.target.value)}
                        disabled={prefillModal.emailLocked || isEmailBusy}
                        autoComplete="email"
                      />
                      {isEmailBusy && <span className="input-spinner" aria-hidden="true" />}
                    </div>
                    {prefillFormErrors.email ? (
                      <div className="prefill-error">{prefillFormErrors.email}</div>
                    ) : (
                      trialEmailError && <div className="prefill-error">{trialEmailError}</div>
                    )}
                  </div>

                  <div className="prefill-field">
                    <div className="prefill-row">
                      <label htmlFor="prefill-key">Key live</label>
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
                  </div>

                  <div className="prefill-field">
                    <div className="prefill-row">
                      <label htmlFor="prefill-ocr">Ảnh báo cáo</label>
                      <input
                        id="prefill-ocr"
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={event => {
                          const files = event.target.files
                            ? Array.from(event.target.files).filter(Boolean)
                            : [];
                          if (files.length) {
                            handlePrefillOcr(files);
                          }
                          event.target.value = '';
                        }}
                      />
                    </div>
                    <div className="prefill-hint">Dán ảnh trực tiếp hoặc tải lên tối đa 2 ảnh để tự động tách ID phiên/GMV/Giờ bắt đầu.</div>
                    {successMessage && (
                      <div className="prefill-status-message prefill-status-message--success">
                        {successMessage}
                      </div>
                    )}
                    {ocrErrorMessage && (
                      <div className="prefill-status-message prefill-status-message--error">
                        {ocrErrorMessage}
                      </div>
                    )}
                  </div>

                  <div className="prefill-field">
                    <div className="prefill-row">
                      <label htmlFor="prefill-id1">ID phiên 1</label>
                      <input
                        id="prefill-id1"
                        type="text"
                        className="text-input"
                        placeholder="Nhập ID hoặc dán ảnh để lấy ID tự động"
                        value={prefillValues.id1 || ''}
                        onChange={e => handlePrefillFieldChange('id1', e.target.value)}
                      />
                    </div>
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
                      + Thêm ID phiên 2
                    </button>
                  )}

                  <div className="prefill-field">
                    <div className="prefill-row">
                      <label htmlFor="prefill-gmv">GMV</label>
                      <input
                        id="prefill-gmv"
                        type="text"
                        inputMode="numeric"
                        className="text-input"
                        placeholder="Nhập GMV hoặc nhập ảnh để tách tự động"
                        value={prefillValues.gmv || ''}
                        onChange={e => handlePrefillFieldChange('gmv', e.target.value)}
                      />
                    </div>
                    {prefillFormErrors.gmv && <div className="prefill-error">{prefillFormErrors.gmv}</div>}
                    {showGmvCandidatePrompt && (
                      <div className="prefill-gmv-choice">
                        <div className="prefill-hint">Có 2 số GMV. Hãy chọn số đúng:</div>
                        <div className="prefill-gmv-options">
                          {gmvCandidateOptions.map(candidate => {
                            const isActive = sanitizedPrefillGmv === candidate;
                            const optionClass = `prefill-gmv-option-button${isActive ? ' prefill-gmv-option-button--active' : ''}`;
                            return (
                              <button
                                key={candidate}
                                type="button"
                                className={optionClass}
                                onClick={() => handleSelectGmvCandidate(candidate)}
                              >
                                {candidate}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="prefill-field">
                    <div className="prefill-row">
                      <label htmlFor="prefill-start-time">Giờ bắt đầu</label>
                      <input
                        id="prefill-start-time"
                        type="text"
                        className="text-input"
                        placeholder="Nhập giờ bắt đầu hoặc nhập ảnh để tách tự động"
                        value={prefillValues.startTimeText || ''}
                        onChange={e => handlePrefillFieldChange('startTimeText', e.target.value)}
                      />
                    </div>
                    {prefillFormErrors.startTimeText && (
                      <div className="prefill-error">{prefillFormErrors.startTimeText}</div>
                    )}
                  </div>

                  <div className="prefill-form-actions">
                    <button type="submit" className="btn" disabled={isEmailBusy}>Tạo link</button>
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

      {showHostScriptModal && (
        <div
          className="modal-backdrop host-script-modal-backdrop"
          onClick={closeHostScriptModal}
        >
          <div
            className="modal-card host-script-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="host-script-modal-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="host-script-modal-header">
              <h2 id="host-script-modal-title">Cá nhân hoá script nhắc live</h2>
              <button
                type="button"
                className="modal-close-button"
                onClick={closeHostScriptModal}
                aria-label="Đóng cá nhân hoá script"
              >
                ×
              </button>
            </div>
            <p className="modal-desc">
              Nhập câu nhắc và dùng từ khoá <strong>Time</strong> và <strong>Room</strong> để tự động thay
              thế bằng giờ/phòng thực tế.
            </p>
            <form className="host-script-form" onSubmit={handleSaveHostScriptTemplate}>
              <label className="host-script-label" htmlFor="host-script-input">
                Script nhắc live
              </label>
              <textarea
                id="host-script-input"
                className="text-input host-script-textarea"
                value={hostScriptDraft}
                onChange={event => setHostScriptDraft(event.target.value)}
                placeholder="Ví dụ: Mình có live lúc Time ở Room nha"
              />
              <div className="host-script-preview">
                <div className="host-script-preview-label">Ví dụ hiển thị:</div>
                <div className="host-script-preview-value">
                  {applyHostMessageTemplate(hostScriptDraft, '20:00', 'Studio A')}
                </div>
                <div className="host-script-preview-meta">(Time = 20:00, Room = Studio A)</div>
              </div>
              {hostScriptSaveError && (
                <div className="modal-error">{hostScriptSaveError}</div>
              )}
              <div className="host-script-modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={handleResetHostScriptDraft}
                  disabled={hostScriptSaving}
                >
                  Khôi phục mặc định
                </button>
                <button type="submit" className="btn" disabled={hostScriptSaving}>
                  {hostScriptSaving ? 'Đang lưu…' : 'Lưu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showLoginModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Tìm ca làm bằng tên</h2>
            <p className="modal-desc">Nhập tên của bạn để tìm kiếm lịch làm việc.</p>
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
