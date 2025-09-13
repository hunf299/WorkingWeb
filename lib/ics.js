// lib/ics.js

function toICSDate(dt) {
  return dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeICS(s = '') {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * entries: [{ title, start:Date, end:Date, location?, desc?, alarm?: boolean }]
 */
export function buildICS(entries, alarmMinutes = 30) {
  const now = new Date();
  const out = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'PRODID:-//work-cal-web//EN',
    'X-WR-CALNAME:Work Schedule',
  ];

  for (const e of entries) {
    const uid = `${e.title}-${e.start.getTime()}-${e.location || 'na'}@work-cal`;

    out.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${toICSDate(now)}`,
      `DTSTART:${toICSDate(e.start)}`,
      `DTEND:${toICSDate(e.end)}`,
      `SUMMARY:${escapeICS(e.title)}`
    );

    if (e.location) out.push(`LOCATION:${escapeICS(e.location)}`);
    if (e.desc) out.push(`DESCRIPTION:${escapeICS(e.desc)}`);

    // chỉ event đầu chuỗi mới có alarm
    if (e.alarm !== false) {
      out.push(
        'BEGIN:VALARM',
        `TRIGGER:-PT${Math.max(1, alarmMinutes)}M`,
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder',
        'END:VALARM'
      );
    }

    out.push('END:VEVENT');
  }

  out.push('END:VCALENDAR');
  return out.filter(Boolean).join('\r\n');
}
