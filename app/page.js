'use client';

import { useEffect, useMemo, useState } from 'react';
import { parseSlot } from '../lib/parse';
import { buildICS } from '../lib/ics';

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

export default function Page() {
  const [rawItems, setRawItems] = useState([]);      // dữ liệu raw từ sheet
  const [selectedDateStr, setSelectedDateStr] = useState(toYMD(new Date())); // yyyy-mm-dd
  const [daysToShow, setDaysToShow] = useState(1);   // số ngày hiển thị bắt đầu từ ngày chọn
  const [query, setQuery] = useState('');            // filter/search
  const [loading, setLoading] = useState(true);

  // fetch sheet
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/sheet', { cache: 'no-store' });
        const j = await r.json();
        setRawItems(j.items || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  // Áp dụng filter/search (theo text)
  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return selectedDayEvents;
    return selectedDayEvents.filter(e => {
      const hay = [
        e.title, e.sessionType, e.talent1, e.talent2 || '',
        e.room || '', e.coor || '', e.timeSlot || '', e.dateLabel
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [selectedDayEvents, query]);

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
      <h1>Lịch làm việc</h1>

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

        <div className="toolbar-row">
          <label className="lbl" htmlFor="q">Tìm</label>
          <input
            id="q"
            type="text"
            className="text-input"
            placeholder="Brand / Session / Talent / Room / Coordinator…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button className="btn ghost" onClick={() => setQuery('')}>Xóa</button>
          )}
        </div>

        <div className="toolbar-actions">
          <button className="btn" onClick={downloadICSForDay}>
            Tải lịch đang xem (.ics)
          </button>
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
                  {g.items.map((e, i) => (
                    <div key={i} className="event-card">
                      <h2 className="event-title">{e.title}</h2>
                      <div className="event-time">⏰ {fmtHM(e.start)}–{fmtHM(e.end)}</div>
                      <div className="event-date">📅 {e.dateLabel}</div>
                      <div className="event-meta">
                        <div className="meta-line">
                          📍 <span>{e.room || '—'}</span>
                        </div>
                        <div className="meta-line">
                          📝 <span>Session type: {e.sessionType || '—'}</span>
                        </div>
                        <div className="meta-line">
                          🎤 <span>{e.talent1}{e.talent2 ? ', ' + e.talent2 : ''}</span>
                        </div>
                        <div className="meta-line">
                          🖥️ <span>{e.coor || '—'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
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
            {g.items.map((e, i) => (
              <div key={i} className="event-card">
                <h2 className="event-title">{e.title}</h2>
                <div className="event-time">⏰ {fmtHM(e.start)}–{fmtHM(e.end)}</div>
                <div className="event-meta">
                  <div className="meta-line">
                    📍 <span>{e.room || '—'}</span>
                  </div>
                  <div className="meta-line">
                    📝 <span>Session type: {e.sessionType || '—'}</span>
                  </div>
                  <div className="meta-line">
                    🎤 <span>{e.talent1}{e.talent2 ? ', ' + e.talent2 : ''}</span>
                  </div>
                  <div className="meta-line">
                    🖥️ <span>{e.coor || '—'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))
      ) : (
        <p>Không có sự kiện cho ngày này.</p>
      )}
    </div>
  );
}
