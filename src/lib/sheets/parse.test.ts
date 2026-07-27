import { describe, expect, it } from "vitest";
import {
  indexToColumn,
  parseDuration,
  parseRows,
  parseSheetDate,
  rowsFromValues,
  type ColumnMap,
} from "./parse";

const MAP: ColumnMap = {
  title: "B",
  dueDate: "C",
  template: "D",
  estimatedMinutes: "E",
  client: "A",
};

const row = (rowNumber: number, cells: Record<string, string>) => ({
  rowNumber,
  cells,
});

describe("parseSheetDate", () => {
  it("reads ISO dates", () => {
    expect(parseSheetDate("2026-07-27")?.toISOString().slice(0, 10)).toBe(
      "2026-07-27",
    );
  });

  it("reads day-first dates, the local convention", () => {
    // 07/08 must be 7 August, not 8 July.
    expect(parseSheetDate("07/08/2026")?.toISOString().slice(0, 10)).toBe(
      "2026-08-07",
    );
  });

  it("accepts dashes, dots and two-digit years", () => {
    expect(parseSheetDate("27-07-2026")?.toISOString().slice(0, 10)).toBe(
      "2026-07-27",
    );
    expect(parseSheetDate("27.07.26")?.toISOString().slice(0, 10)).toBe(
      "2026-07-27",
    );
  });

  it("rejects a date that does not exist", () => {
    // Must not silently roll into March.
    expect(parseSheetDate("31/02/2026")).toBeNull();
    expect(parseSheetDate("32/01/2026")).toBeNull();
    expect(parseSheetDate("01/13/2026")).toBeNull();
  });

  it("rejects things that are not dates", () => {
    expect(parseSheetDate("")).toBeNull();
    expect(parseSheetDate("next tuesday")).toBeNull();
  });
});

describe("parseDuration", () => {
  it("reads the shapes people type", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("45 min")).toBe(45);
    expect(parseDuration("2 hours")).toBe(120);
  });

  it("returns null for anything it cannot read", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("a while")).toBeNull();
  });
});

describe("indexToColumn", () => {
  it("handles the wrap past Z", () => {
    expect(indexToColumn(0)).toBe("A");
    expect(indexToColumn(25)).toBe("Z");
    expect(indexToColumn(26)).toBe("AA");
    expect(indexToColumn(27)).toBe("AB");
  });
});

describe("rowsFromValues", () => {
  it("skips the header and numbers rows as the sheet does", () => {
    const rows = rowsFromValues(
      [
        ["Client", "Task", "Due"],
        ["Acme", "Fix the thing", "2026-07-27"],
      ],
      1,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[0].cells.B).toBe("Fix the thing");
  });
});

describe("parseRows", () => {
  it("turns a row into a task", () => {
    const { parsed, skipped } = parseRows({
      sourceId: "src1",
      columnMap: MAP,
      rows: [
        row(2, {
          A: "Acme Ltd",
          B: "Install replacement scanner",
          C: "2026-07-29",
          E: "1h 30m",
        }),
      ],
    });

    expect(skipped).toEqual([]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Install replacement scanner");
    expect(parsed[0].estimatedMinutes).toBe(90);
    expect(parsed[0].description).toBe("Client: Acme Ltd");
    expect(parsed[0].externalKey).toBe("sheet:src1:row-2");
  });

  it("ignores blank rows without complaining", () => {
    const { parsed, skipped } = parseRows({
      sourceId: "src1",
      columnMap: MAP,
      rows: [row(2, {}), row(3, { B: "", C: "2026-07-29" })],
    });

    expect(parsed).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("reports a row it cannot date rather than dropping it silently", () => {
    const { parsed, skipped } = parseRows({
      sourceId: "src1",
      columnMap: MAP,
      rows: [row(4, { B: "Something", C: "whenever" })],
    });

    expect(parsed).toEqual([]);
    expect(skipped).toEqual([
      { rowNumber: 4, reason: 'Could not read the date "whenever"' },
    ]);
  });

  it("uses a key column for identity so rows can move around", () => {
    const first = parseRows({
      sourceId: "src1",
      columnMap: MAP,
      keyColumn: "F",
      rows: [row(2, { B: "Job", C: "2026-07-29", F: "JOB-100" })],
    });

    // Same job, now further down the sheet.
    const second = parseRows({
      sourceId: "src1",
      columnMap: MAP,
      keyColumn: "F",
      rows: [row(9, { B: "Job", C: "2026-07-29", F: "JOB-100" })],
    });

    expect(first.parsed[0].externalKey).toBe(second.parsed[0].externalKey);
  });

  it("without a key column, a moved row becomes a different task", () => {
    // Documenting the trade-off: row numbers are a weak identity, which is
    // exactly why a key column is worth configuring.
    const first = parseRows({
      sourceId: "src1",
      columnMap: MAP,
      rows: [row(2, { B: "Job", C: "2026-07-29" })],
    });
    const second = parseRows({
      sourceId: "src1",
      columnMap: MAP,
      rows: [row(9, { B: "Job", C: "2026-07-29" })],
    });

    expect(first.parsed[0].externalKey).not.toBe(second.parsed[0].externalKey);
  });

  it("flags a duplicate key instead of clobbering the first row", () => {
    const { parsed, skipped } = parseRows({
      sourceId: "src1",
      columnMap: MAP,
      keyColumn: "F",
      rows: [
        row(2, { B: "One", C: "2026-07-29", F: "DUP" }),
        row(3, { B: "Two", C: "2026-07-30", F: "DUP" }),
      ],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("One");
    expect(skipped[0].rowNumber).toBe(3);
    expect(skipped[0].reason).toContain("Duplicate key");
  });

  it("keeps keys distinct across different sources", () => {
    const a = parseRows({
      sourceId: "src1",
      columnMap: MAP,
      rows: [row(2, { B: "Job", C: "2026-07-29" })],
    });
    const b = parseRows({
      sourceId: "src2",
      columnMap: MAP,
      rows: [row(2, { B: "Job", C: "2026-07-29" })],
    });

    expect(a.parsed[0].externalKey).not.toBe(b.parsed[0].externalKey);
  });

  it("carries a template name through so the duration can be inherited", () => {
    const { parsed } = parseRows({
      sourceId: "src1",
      columnMap: MAP,
      rows: [
        row(2, { B: "Sweep", C: "2026-07-29", D: "Support inbox sweep" }),
      ],
    });

    expect(parsed[0].templateName).toBe("Support inbox sweep");
    expect(parsed[0].estimatedMinutes).toBeNull();
  });

  it("is case-insensitive about column letters", () => {
    const { parsed } = parseRows({
      sourceId: "src1",
      columnMap: { title: "b", dueDate: "c" },
      rows: [row(2, { B: "Job", C: "2026-07-29" })],
    });

    expect(parsed).toHaveLength(1);
  });
});
