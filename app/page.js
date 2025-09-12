'use client';

import { useEffect, useMemo, useState } from 'react';
import { groupByDay, parseSlot, fmtDayVi, fmtHM } from '../lib/parse';
import { buildICSForDay } from '../lib/ics';

export default function Page() {
    const [days, setDays] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(null); // busy by day index

    async function load() {
        setLoading(true); setErr('');
        try {
            const r = await fetch('/api/sheet', { cache: 'no-store' });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || 'Fetch error');
            const grouped = groupByDay(j.items || []);
            setDays(grouped);
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    }
    useEffect(()=>{ load(); },[]);

    const content = useMemo(()=> {
        if (loading) return <div className="card">Đang tải Google Sheet…</div>;
        if (err) return <div className="card">Lỗi: {err}</div>;
        if (!days.length) return <div className="card">Không có dữ liệu</div>;
        return days.map((day, idx) => (
            <div key={idx} className="card">
                <div className="header">
                    <h2 className="h2">{fmtDayVi(day.date)}</h2>
                    <button className="btn" disabled={busy===idx} onClick={()=>addDayICS(idx)}>
                        {busy===idx ? 'Đang tạo .ics…' : 'Add to Calendar (day)'}
                    </button>
                </div>

                <div className="small">Tổng {day.events.length} ca</div>

                {day.events.map((e, i) => {
                    const slot = parseSlot(e.timeSlot, e.dayDate);
                    const timeLabel = slot ? `${fmtHM(slot.start)}–${fmtHM(slot.end)}` : e.timeSlot || '—';
                    return (
                        <div key={i} className="row">
                            <div><b>{e.brandChannel}</b> <span className="meta">• {e.sessionType}</span></div>
                            <div className="meta">⏰ {timeLabel} &nbsp;|&nbsp; 🎤 {e.talent1}{e.talent2 ? (', ' + e.talent2) : ''}</div>
                            <div className="small">📍 {e.room} &nbsp;|&nbsp; 📞 {e.phone}</div>
                        </div>
                    );
                })}
            </div>
        ));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days, loading, err, busy]);

    function addDayICS(idx){
        setBusy(idx);
        try {
            const day = days[idx];
            const entries = [];
            for (const e of day.events) {
                const slot = parseSlot(e.timeSlot, e.dayDate);
                if (!slot) continue;
                entries.push({
                    title: `${e.brandChannel} · ${e.sessionType}`,
                    location: e.room,
                    desc: `Talent: ${e.talent1}${e.talent2 ? ', ' + e.talent2 : ''}\nPhone: ${e.phone}\nTime slot: ${e.timeSlot}\nNguồn: Google Sheet ${e.rawDate}`,
                    start: slot.start,
                    end: slot.end
                });
            }
            if (!entries.length) { alert('Ngày này không có ca hợp lệ.'); return; }
            const ics = buildICSForDay(entries, 'Working Calendar');
            const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const y = day.date.getFullYear();
            const m = String(day.date.getMonth()+1).padStart(2,'0');
            const d = String(day.date.getDate()).padStart(2,'0');
            a.href = url;
            a.download = `work-${y}${m}${d}.ics`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="container">
            <h1 className="h1">Working Calendar</h1>
            <div className="card" style={{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between'}}>
                <div className="small">
                    Dữ liệu lấy từ Google Sheets → nhóm theo ngày.
                    Bấm <b>Add to Calendar (day)</b> để tải file <code>.ics</code> gồm tất cả ca trong ngày (có nhắc -30’).
                </div>
                <button className="btn" onClick={load}>Refresh</button>
            </div>
            {content}
            <div className="small">Made for iPhone: mở file <code>.ics</code> sẽ thêm vào Lịch (Calendar) và bật nhắc.</div>
        </div>
    );
}