// Reads the Excel download of the Google Sheet "QURA Form Submissions" (File → Download → .xlsx)
// into SheetRow records: every tab, every column, the ad tracking (UTM) values and the row colour.
import ExcelJS from 'exceljs';
import { parseTs, type SheetRow } from './sheetImport';

const IST = 330 * 60000;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

export type ParsedSheet = {
  rows: SheetRow[];
  tabs: { name: string; rows: number; skipped: number; copies: number }[];
  warnings: string[];
};

type Field = 'ts' | 'form' | 'name' | 'email' | 'phone' | 'msg' | 'source';
function fieldFor(header: string): Field | null {
  const h = header.toLowerCase();
  if (/^(timestamp|date|submitted at|time)$/.test(h)) return 'ts';
  if (/^form( type)?$/.test(h)) return 'form';
  if (/^(name|full name)$/.test(h)) return 'name';
  if (/^e-?mail( address)?$/.test(h)) return 'email';
  if (/^(phone|phone number|mobile|whatsapp|contact number)$/.test(h)) return 'phone';
  if (/^(message|comments?)$/.test(h)) return 'msg';
  if (/^source$/.test(h)) return 'source';
  return null;
}

// Plain text of a cell, whatever Excel type it is.
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // a time typed on its own ("18:00") comes through as a date in 1899
    if (v.getUTCFullYear() < 1901) return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return cellText((v as { text: ExcelJS.CellValue }).text); // hyperlink (plain or rich text)
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue); // formula
    if ('error' in v) return String((v as { error: unknown }).error ?? '');
  }
  return String(v);
}

// Timestamp cell → ISO time. Date cells hold the IST wall-clock time.
function tsText(v: ExcelJS.CellValue): string {
  if (v instanceof Date) return new Date(v.getTime() - IST).toISOString();
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000) - IST).toISOString();
  return clean(cellText(v));
}

// Row colour as a plain name. The Sheet's legend (blue = hot, purple = push out, orange = 1-week follow-up)
// isn't followed consistently, so colours are kept as a label only.
function colourName(argb: string | undefined): string | null {
  if (!argb || argb.length < 6) return null;
  const hex = argb.slice(-6);
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d < 0.06 || l > 0.97) return null; // white / grey = no colour
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const light = l > 0.8 ? 'Light ' : '';
  const name = h < 15 || h >= 335 ? 'red' : h < 45 ? 'orange' : h < 70 ? 'yellow' : h < 160 ? 'green' : h < 200 ? 'cyan' : h < 255 ? 'blue' : 'purple';
  return light ? `${light}${name}` : name[0].toUpperCase() + name.slice(1);
}

function rowColour(row: ExcelJS.Row, cols: number[]): string | null {
  const seen = new Map<string, number>();
  for (const c of cols) {
    const fill = row.getCell(c).fill as ExcelJS.FillPattern | undefined;
    const argb = fill && fill.type === 'pattern' && fill.pattern === 'solid' ? fill.fgColor?.argb : undefined;
    const name = colourName(argb);
    if (name) seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// --- ad tracking ---------------------------------------------------------------------------
// The website writes utm_source into "Source" and utm_medium, utm_campaign, utm_content, utm_term into the
// columns after it. Until 26 Aug 2026 those started one column later (the first one, "follow up", held
// sales notes); since then they start right after Source.
const KNOWN_SOURCES: Record<string, string> = {
  ig: 'ig', instagram: 'ig', fb: 'fb', facebook: 'fb', whatsapp: 'whatsapp', wa: 'whatsapp', meta: 'meta',
  google: 'google', youtube: 'youtube', yt: 'youtube', 'chatgpt.com': 'chatgpt.com', standee: 'standee',
  linkedin: 'linkedin', email: 'email', website: 'website', '{{site_source_name}}': 'meta',
};
const MEDIUMS = new Set(['paid', 'social', 'messaging', 'cpc', 'organic', 'email', 'referral', 'paid_social', 'story', 'reel']);
function looksLikeTracking(v: string): boolean {
  if (!v) return false;
  if (MEDIUMS.has(v.toLowerCase())) return true;
  if (/^\d{12,20}$/.test(v)) return true; // Meta campaign / ad set / ad id
  if (/\{\{|\||wa_drip|link_in_bio|leads gen/i.test(v)) return true;
  return /^[a-z0-9]+(_[a-z0-9]+)+$/.test(v); // snake_case tag like levelup_alumni
}
const blankTemplate = (v: string) => (/^\{\{.*\}\}$/.test(v) ? '' : v);

export async function parseSheetXlsx(buf: ArrayBuffer | Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: ParsedSheet = { rows: [], tabs: [], warnings: [] };
  const perTab: SheetRow[][] = [];

  for (const ws of wb.worksheets) {
    let headerRow = 0;
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const hs = (ws.getRow(r).values as ExcelJS.CellValue[]).map((v) => clean(cellText(v)).toLowerCase());
      if (hs.some((h) => fieldFor(h) === 'ts') && hs.some((h) => fieldFor(h) === 'name')) { headerRow = r; break; }
    }
    if (!headerRow) { out.warnings.push(`Tab "${ws.name}" skipped — no Timestamp/Name header row found.`); continue; }

    const header = ws.getRow(headerRow);
    const lastCol = Math.max(ws.columnCount, header.cellCount);
    const headerOf = (c: number) => clean(cellText(header.getCell(c).value));
    const fieldCol: Partial<Record<Field, number>> = {};
    for (let c = 1; c <= lastCol; c++) {
      const f = fieldFor(headerOf(c));
      if (f && !fieldCol[f]) fieldCol[f] = c;
    }
    // tracking zone: up to 5 columns right after Source whose header is blank or "follow up"
    const zone: number[] = [];
    if (fieldCol.source) {
      for (let c = fieldCol.source + 1; c <= lastCol && zone.length < 5; c++) {
        if (headerOf(c) === '' || /^follow up$/i.test(headerOf(c)) && zone.length === 0) zone.push(c); else break;
      }
    }
    const zoneNoteLabel = zone.length ? headerOf(zone[0]) || `Column ${ws.getColumn(zone[0]).letter}` : '';
    const noteCols: { col: number; label: string }[] = [];
    for (let c = 1; c <= lastCol; c++) {
      if (Object.values(fieldCol).includes(c) || zone.includes(c)) continue;
      let isLegend = false;
      for (let r = headerRow + 1; r <= Math.min(headerRow + 6, ws.rowCount); r++) {
        if (/^legend$/i.test(clean(cellText(ws.getRow(r).getCell(c).value)))) isLegend = true;
      }
      if (!isLegend) noteCols.push({ col: c, label: headerOf(c) || `Column ${ws.getColumn(c).letter}` });
    }
    const allCols = Array.from({ length: lastCol }, (_, i) => i + 1);

    const rows: SheetRow[] = [];
    let skipped = 0;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (f: Field) => (fieldCol[f] ? clean(cellText(row.getCell(fieldCol[f]!).value)) : '');
      const name = get('name'), email = get('email');
      let phone = get('phone');
      if (!name && !phone && !email) continue; // blank row
      const ts = fieldCol.ts ? tsText(row.getCell(fieldCol.ts).value) : '';
      if (!parseTs(ts)) {
        skipped++;
        out.warnings.push(`Tab "${ws.name}" row ${r} (${name || phone || email}) skipped — can't read the timestamp "${ts}".`);
        continue;
      }
      const notes = noteCols
        .map(({ col, label }) => ({ label, text: clean(cellText(row.getCell(col).value)) }))
        .filter((n) => n.text);
      if (/^#/.test(phone)) { notes.push({ label: 'Phone in Sheet', text: `${phone} (the Sheet couldn't store the number)` }); phone = ''; }

      // source + UTM tags
      const srcRaw = get('source');
      const srcKey = KNOWN_SOURCES[srcRaw.toLowerCase()];
      if (srcRaw && !srcKey) notes.push({ label: 'Source column', text: srcRaw }); // a note typed into Source
      const zv = zone.map((c) => clean(cellText(row.getCell(c).value)));
      const shifted = zv.length === 5 && !zv[4] && looksLikeTracking(zv[0]);
      const start = shifted ? 0 : 1;
      if (!shifted && zv[0]) notes.push({ label: zoneNoteLabel, text: zv[0] });
      const [medium, campaign, content, term] = zv.slice(start, start + 4).map(blankTemplate);
      const utm = Object.fromEntries(Object.entries({ source: srcKey ?? '', medium, campaign, content, term }).filter(([, v]) => v));

      rows.push({
        tab: ws.name, ts, form: get('form'), name, email, phone, msg: get('msg'), status: '',
        source: srcKey || undefined,
        notes,
        colour: rowColour(row, allCols) ?? undefined,
        utm: Object.keys(utm).length ? utm : undefined,
      });
    }
    perTab.push(rows);
    out.tabs.push({ name: ws.name, rows: rows.length, skipped, copies: 0 });
  }

  // The same form entry copied into another tab (e.g. a calling list) is one entry: keep the first tab's row and
  // add any note from the copy that the first tab doesn't have.
  const key = (r: SheetRow) => `${String(r.phone).replace(/\D/g, '').slice(-10) || clean(r.email).toLowerCase() || clean(r.name).toLowerCase()}|${parseTs(r.ts)!.toISOString().slice(0, 16)}|${clean(r.form).toLowerCase()}`;
  const firstSeen = new Map<string, SheetRow>();
  perTab.forEach((rows, t) => {
    for (const r of rows) {
      const k = key(r);
      const orig = firstSeen.get(k);
      if (orig && orig.tab !== r.tab) {
        const have = new Set((orig.notes ?? []).map((n) => n.text.toLowerCase()));
        for (const n of r.notes ?? []) if (!have.has(n.text.toLowerCase())) (orig.notes ??= []).push({ label: `${n.label} (${r.tab})`, text: n.text });
        out.tabs[t].copies++;
        continue;
      }
      if (!orig) firstSeen.set(k, r);
      out.rows.push(r);
    }
  });
  return out;
}

export { testReason } from './sheetTests';
