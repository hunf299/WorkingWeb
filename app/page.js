'use client';

import { useEffect, useMemo, useState } from 'react';
import { parseVNDate, parseSlot, isSameDay } from '../lib/parse';
import { buildICS } from '../lib/ics';

function downloadICSForDay() {
  if (!selectedDayEvents.length) { alert('Không có ca cho ngày đã chọn'); return; }

  // Nhóm theo brand/title
  const byTitle = new Map();
  for (const e of selectedDayEvents) {
    if (!byTitle.has(e.title)) byTitle.set(e.title, []);
    byTitle.get(e.title).push(e);
  }

  const TOLERANCE_MIN = 5 * 60 * 1000; // ≤5 phút coi là liên tiếp
  const entries = [];

  for (const [title, arr] of byTitle.entries()) {
    // sort theo thời gian
    arr.sort((a,b) => a.start - b.start);

    let inChain = false;
    let prevEnd = null;

    for (let i = 0; i < arr.length; i++) {
      const ev = arr[i];
      const contiguous = prevEnd && Math.abs(ev.start - prevEnd) <= TOLERANCE_MIN;

      // Nếu không liên tiếp → bắt đầu chuỗi mới => event này có alarm
      const hasAlarm = !contiguous; 
      entries.push({
        title: ev.title,
        start: ev.start,
        end: ev.end,
        location: ev.room,
        desc:
`Session type: ${ev.sessionType}
Talent: ${ev.talent1}${ev.talent2 ? ', ' + ev.talent2 : ''}
Room: ${ev.room}
Phone: ${ev.phone}
Time slot: ${ev.timeSlot}
Nguồn: Google Sheet ${ev.rawDate}`,
        alarm: hasAlarm  // ✅ chỉ event đầu chuỗi báo -30'
      });

      prevEnd = ev.end;
      inChain = true;
      // nếu khoảng cách > tolerance, chuỗi ngắt
      if (!contiguous) prevEnd = ev.end;
    }
  }

  const ics = buildICS(entries, 30);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = fromYMD(selectedDateStr);
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  a.href = url; a.download = `work-${y}${m}${dd}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
