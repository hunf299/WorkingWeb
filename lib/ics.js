function pad(n){return String(n).padStart(2,'0');}
function toICSDate(dt){
    return dt.toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
}
function escapeICS(s=''){return s.replace(/\\/g,'\\\\').replace(/\n/g,'\\n');}

export function buildICS(entries){
    const now = new Date();
    const lines = [
        'BEGIN:VCALENDAR','VERSION:2.0','CALSCALE:GREGORIAN',
        'PRODID:-//work-cal//EN'
    ];
    for(const e of entries){
        const uid = `${e.title}-${e.start.getTime()}@work-cal`;
        lines.push(
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${toICSDate(now)}`,
            `DTSTART:${toICSDate(e.start)}`,
            `DTEND:${toICSDate(e.end)}`,
            `SUMMARY:${escapeICS(e.title)}`,
            e.location?`LOCATION:${escapeICS(e.location)}`:'',
            e.desc?`DESCRIPTION:${escapeICS(e.desc)}`:'',
            'BEGIN:VALARM','TRIGGER:-PT30M','ACTION:DISPLAY','DESCRIPTION:Nhắc lịch','END:VALARM',
            'END:VEVENT'
        );
    }
    lines.push('END:VCALENDAR');
    return lines.filter(Boolean).join('\r\n');
}
