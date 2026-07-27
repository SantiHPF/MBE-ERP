import { toDateOnly } from "@/lib/time";

/**
 * Turning sheet rows into tasks.
 *
 * The column mapping lives in the database rather than in code, so the sheet
 * can be rearranged without a deploy. Everything here is pure: give it rows
 * and a mapping, get back tasks and a list of what it could not read.
 */

export type ColumnMap = {
  title: string;
  dueDate: string;
  /** Optional: names a catalogue entry, which supplies the duration. */
  template?: string;
  estimatedMinutes?: string;
  client?: string;
  notes?: string;
};

export type SheetRow = {
  /** 1-based row number in the sheet, used for identity when no key column. */
  rowNumber: number;
  cells: Record<string, string>;
};

export type ParsedRow = {
  externalKey: string;
  title: string;
  description: string | null;
  dueDate: Date;
  estimatedMinutes: number | null;
  templateName: string | null;
};

export type SkippedRow = {
  rowNumber: number;
  reason: string;
};

/** "B" -> 1, "AA" -> 26 */
export function columnToIndex(column: string): number {
  let index = 0;
  for (const char of column.trim().toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

export function rowsFromValues(
  values: string[][],
  headerRows: number,
): SheetRow[] {
  return values.slice(headerRows).map((row, i) => {
    const cells: Record<string, string> = {};
    row.forEach((value, columnIndex) => {
      cells[indexToColumn(columnIndex)] = value ?? "";
    });
    return { rowNumber: headerRows + i + 1, cells };
  });
}

/** 0 -> "A", 26 -> "AA" */
export function indexToColumn(index: number): string {
  let column = "";
  let n = index;
  while (n >= 0) {
    column = String.fromCharCode((n % 26) + 65) + column;
    n = Math.floor(n / 26) - 1;
  }
  return column;
}

/**
 * Accepts the date shapes people actually type in spreadsheets. Ambiguous
 * numeric formats are read day-first, matching Spanish and UK convention --
 * the sheet this reads is maintained locally.
 */
export function parseSheetDate(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;

  // 2026-07-27
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    return toDateOnly(
      new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])),
    );
  }

  // 27/07/2026 or 27-07-26
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(value);
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + +dmy[3] : +dmy[3];
    const month = +dmy[2];
    const day = +dmy[1];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    // Reject 31/02 rather than letting it roll into March.
    if (date.getUTCMonth() !== month - 1) return null;
    return toDateOnly(date);
  }

  return null;
}

/** "90", "1h 30m", "1.5h", "45 min" */
export function parseDuration(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  if (/^\d+$/.test(value)) return Number(value);

  const hm = /^(\d+(?:\.\d+)?)\s*h(?:ours?)?(?:\s*(\d+)\s*m(?:in(?:utes?)?)?)?$/.exec(value);
  if (hm) {
    return Math.round(Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0));
  }

  const m = /^(\d+)\s*m(?:in(?:utes?)?)?$/.exec(value);
  if (m) return Number(m[1]);

  return null;
}

export function parseRows(input: {
  sourceId: string;
  rows: SheetRow[];
  columnMap: ColumnMap;
  keyColumn?: string | null;
}): { parsed: ParsedRow[]; skipped: SkippedRow[] } {
  const parsed: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();

  for (const row of input.rows) {
    const cell = (column?: string) =>
      column ? (row.cells[column.trim().toUpperCase()] ?? "").trim() : "";

    const title = cell(input.columnMap.title);
    // A blank title is an empty row, not an error worth reporting.
    if (!title) continue;

    const dueRaw = cell(input.columnMap.dueDate);
    const dueDate = parseSheetDate(dueRaw);
    if (!dueDate) {
      skipped.push({
        rowNumber: row.rowNumber,
        reason: dueRaw
          ? `Could not read the date "${dueRaw}"`
          : "No due date",
      });
      continue;
    }

    // Row identity: a key column if configured, otherwise the row number.
    const keyValue = input.keyColumn ? cell(input.keyColumn) : "";
    const identity = keyValue || `row-${row.rowNumber}`;
    const externalKey = `sheet:${input.sourceId}:${identity}`;

    if (seen.has(externalKey)) {
      skipped.push({
        rowNumber: row.rowNumber,
        reason: `Duplicate key "${identity}" — the key column must be unique`,
      });
      continue;
    }
    seen.add(externalKey);

    const client = cell(input.columnMap.client);
    const notes = cell(input.columnMap.notes);
    const description = [client && `Client: ${client}`, notes]
      .filter(Boolean)
      .join("\n");

    parsed.push({
      externalKey,
      title,
      description: description || null,
      dueDate,
      estimatedMinutes: parseDuration(cell(input.columnMap.estimatedMinutes)),
      templateName: cell(input.columnMap.template) || null,
    });
  }

  return { parsed, skipped };
}
