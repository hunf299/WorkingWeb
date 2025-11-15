export default async function handler(req, res) {
    const {
        SHEET_ID,
        SHEET_RANGE,
        SHEET_ID_2,
        SHEET_RANGE_HOST,
        SHEET_RANGE_BRAND,
        GOOGLE_API_KEY
    } = process.env;

    const fetchSheetValues = async (sheetId, range) => {
        if (!sheetId || !range || !GOOGLE_API_KEY) {
            return [];
        }
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${GOOGLE_API_KEY}`;
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) {
                console.error('Failed to fetch sheet', { sheetId, range, status: response.status });
                return [];
            }
            const data = await response.json();
            return data.values || [];
        } catch (err) {
            console.error('Error fetching sheet', { sheetId, range, err });
            return [];
        }
    };

    const [itemRows, hostRows, brandRows] = await Promise.all([
        fetchSheetValues(SHEET_ID, SHEET_RANGE),
        fetchSheetValues(SHEET_ID_2 || SHEET_ID, SHEET_RANGE_HOST),
        fetchSheetValues(SHEET_ID_2 || SHEET_ID, SHEET_RANGE_BRAND)
    ]);

    const items = itemRows.slice(1).map(r => {
        const coorParts = [r[6], r[7]]
            .map(value => (value ?? '').toString().trim())
            .filter(Boolean);
        const roomParts = [r[8], r[9], r[10]]
            .map(value => (value ?? '').toString().trim())
            .filter(Boolean);
        const primaryRoom = (r[9] ?? '').toString().trim();

        return {
            rawDate: r[0] || '',
            brandChannel: r[1] || '',
            sessionType: r[2] || '',
            timeSlot: r[3] || '',
            talent1: r[4] || '',
            talent2: r[5] || '',
            coor: coorParts.join(' - '),
            room: roomParts.join(' / '),
            roomParts,
            primaryRoom,
            keyLivestream: r[11] || '',
            platform: (r[12] || '').toString().trim()
        };
    });

    const hostLinks = hostRows.slice(1).map(r => ({
        name: (r[0] || '').toString().trim(),
        link: (r[1] || '').toString().trim()
    })).filter(entry => entry.name && entry.link);

    const brandLinks = brandRows.slice(1).map(r => ({
        name: (r[0] || '').toString().trim(),
        link: (r[1] || '').toString().trim()
    })).filter(entry => entry.name && entry.link);

    res.status(200).json({
        items,
        hostLinks,
        brandLinks
    });
}

