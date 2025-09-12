const tz = 'Asia/Ho_Chi_Minh';

export function parseVNDate(s) {
    const [d,m,y] = s.split('/').map(Number);
    return new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T00:00:00+07:00`);
}

export function parseSlot(slot, dayDate) {
    const cleaned = slot.replace(/\s/g,'').replace(/–|—/g,'-');
    const [s,e] = cleaned.split('-');
    if (!s||!e) return null;
    const [sh,sm] = s.split(':').map(Number);
    const [eh,em] = e.split(':').map(Number);
    const start = new Date(dayDate); start.setHours(sh,sm||0,0,0);
    const end = new Date(dayDate); end.setHours(eh,em||0,0,0);
    if (end<=start) end.setDate(end.getDate()+1);
    return {start,end};
}

export function isSameDay(d1,d2){
    return d1.getFullYear()===d2.getFullYear() &&
        d1.getMonth()===d2.getMonth() &&
        d1.getDate()===d2.getDate();
}
