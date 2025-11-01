export default async function handler(req, res) {
    const { SHEET_ID, SHEET_RANGE, GOOGLE_API_KEY } = process.env;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}?key=${GOOGLE_API_KEY}`;
    const r = await fetch(url, { cache: 'no-store' });
    const data = await r.json();
    const rows = data.values || [];
    const items = rows.slice(1).map(r => ({
        rawDate: r[0] || '',
        brandChannel: r[1] || '',
        sessionType: r[2] || '',
        timeSlot: r[3] || '',
        talent1: r[4] || '',
        talent2: r[5] || '',
        coor: `${r[6] || ''} - ${r[7] || ''}`,
        room: `${r[8] || ''} - ${r[9] || ''} - ${r[10] || ''}`
    }));
    res.status(200).json({ items });
    console.log(url);
}

