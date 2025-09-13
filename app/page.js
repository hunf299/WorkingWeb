'use client';

import { useEffect, useState } from 'react';
import { parseVNDate, parseSlot, isSameDay } from '../lib/parse';
import { buildICS } from '../lib/ics';

export default function Page() {
  const [todayEvents, setTodayEvents] = useState([]);
  const today = new Date();

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/sheet', { cache: 'no-store' });
      const j = await r.json();
      const list = j.items || [];
      const result = [];

      for (const it of list) {
        const d = parseVNDate(it.rawDate);
        if (!d || !isSameDay(d, today)) continue;
        const slot = parseSlot(it.timeSlot, d);
        if (!slot) continue;

        result.push({
          title: it.brandChannel,       // Summary = brandChannel
          start: slot.start,
          end:   slot.end,
          sessionType: it.sessionType,
          talent1: it.talent1,
          talent2: it.talent2,
          room: it.room,
          phone: it.phone,
          rawDate: it.rawDate,
          timeSlot: it.timeSlot
        });
      }
      setTodayEvents(result);
    })();
  }, []);

  function downloadICS() {
    if (!todayEvents.length) {
      alert('Không có ca hôm nay');
      return;
    }
    const entries = todayEvents.map(e => ({
      title: e.title,
      start: e.start,
      end:   e.end,
      location: e.room,
      desc:
`Session type: ${e.sessionType}
Talent: ${e.talent1}${e.talent2 ? ', ' + e.talent2 : ''}
Room: ${e.room}
Phone: ${e.phone}
Time slot: ${e.timeSlot}
Nguồn: Google Sheet ${e.rawDate}`
    }));
    const ics = buildICS(entries);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2,'0');
    const d = String(today.getDate()).padStart(2,'0');
    a.href = url;
    a.download = `work-${y}${m}${d}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const fmtHM = (dt) => dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="container">
      <h1>Lịch hôm nay ({today.toLocaleDateString('vi-VN')})</h1>

      {todayEvents.length ? (
        <>
          {todayEvents.map((e, i) => (
            <div key={i} className="event-card">
              {/* Tiêu đề to */}
              <h2 className="event-title">{e.title}</h2>

              {/* Thời gian: xuống dòng, chữ to + icon */}
              <div className="event-time">⏰ {fmtHM(e.start)}–{fmtHM(e.end)}</div>

              {/* Khối meta có gạch mảnh */}
              <div className="event-meta">
                <div className="meta-line">
                  📍 <span>{e.room || '—'}</span>
                  <span className="sep">|</span>
                  <span>Session type: {e.sessionType || '—'}</span>
                </div>
                <div className="meta-line">
                  🎤 <span>{e.talent1}{e.talent2 ? ', ' + e.talent2 : ''}</span>
                </div>
                <div className="meta-line">
                  ☎️ <span>{e.phone || '—'}</span>
                </div>
              </div>
            </div>
          ))}

          <button onClick={downloadICS}>Tải lịch hôm nay (.ics)</button>
        </>
      ) : (
        <p>Không có sự kiện hôm nay.</p>
      )}
    </div>
  );
}
