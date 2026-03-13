/**
 * Auto-detect CSV delimiter by testing which produces the most columns on the header row.
 * Tests tab, comma, and semicolon.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/\r\n/g, '\n').split('\n').find((l) => l.trim() !== '') ?? '';
  const candidates = ['\t', ',', ';'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const count = splitCsvLine(firstLine, d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Parse a CSV string into an array of objects.
 * Handles quoted fields, commas inside quotes, and various line endings.
 * If delimiter is omitted, auto-detects it.
 */
export function parseCsv(text: string, delimiter?: string): Record<string, string>[] {
  const sep = delimiter ?? detectDelimiter(text);
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Find first non-empty line as header
  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === '') headerIdx++;
  if (headerIdx >= lines.length) return [];

  // Strip BOM if present
  const rawHeader = lines[headerIdx].replace(/^\uFEFF/, '');
  const headers = splitCsvLine(rawHeader, sep).map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCsvLine(line, sep);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? '').trim().replace(/^"|"$/g, '');
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Return the headers from the first line of a CSV (auto-detects delimiter).
 */
export function getCsvHeaders(text: string): string[] {
  const sep = detectDelimiter(text);
  const firstLine = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\uFEFF/, '')
    .split('\n')
    .find((l) => l.trim() !== '') ?? '';
  return splitCsvLine(firstLine, sep).map((h) => h.trim().replace(/^"|"$/g, ''));
}

export function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/** Parse a date string in various common formats → 'YYYY-MM-DD' */
export function normalizeDate(raw: string): string {
  if (!raw) return '';
  const s = raw.trim();

  // ISO YYYY-MM-DD or YYYY-MM-DDTHH:mm
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // DD/MM/YYYY (European)
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    const day = parseInt(dmy[1]);
    const month = parseInt(dmy[2]);
    // Disambiguate: if first part > 12, it must be DD/MM
    // If both ≤ 12, assume DD/MM (European)
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  // Long English: "March 6, 2026" or "6 March 2026"
  const MONTHS: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };
  const long1 = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (long1) {
    const m = MONTHS[long1[1].toLowerCase()];
    if (m) return `${long1[3]}-${m}-${long1[2].padStart(2, '0')}`;
  }
  const long2 = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (long2) {
    const m = MONTHS[long2[2].toLowerCase()];
    if (m) return `${long2[3]}-${m}-${long2[1].padStart(2, '0')}`;
  }

  // DD-MM-YYYY
  const dmy2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy2) return `${dmy2[3]}-${dmy2[2].padStart(2, '0')}-${dmy2[1].padStart(2, '0')}`;

  // Try JS Date as last resort
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return '';
}

/** Strip currency symbols and parse float — handles both . and , as decimal separator */
export function parseAmount(raw: string): number {
  if (!raw) return 0;
  let s = raw.trim();

  // Remove currency symbols and spaces
  s = s.replace(/[€$£\s]/g, '');

  // Detect decimal separator: if last separator is comma → European format (1.234,56)
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    // European: 1.234,56 → remove dots, replace last comma with dot
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // US: 1,234.56 → remove commas
    s = s.replace(/,/g, '');
  }

  // Strip anything not numeric or decimal
  s = s.replace(/[^0-9.\-]/g, '');

  return parseFloat(s) || 0;
}
