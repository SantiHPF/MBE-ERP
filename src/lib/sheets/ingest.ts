import { prisma } from "@/lib/db";
import { parseRows, rowsFromValues, type ColumnMap, type SkippedRow } from "./parse";

/**
 * Pulling a sheet into tasks.
 *
 * The fetcher is an interface rather than a hard dependency on googleapis, so
 * ingest can be exercised from a CSV or a fixture without credentials -- which
 * is how it gets tested and how it is demonstrated before anyone has set up a
 * service account.
 */
export type SheetFetcher = (source: {
  spreadsheetId: string;
  tabName: string;
}) => Promise<string[][]>;

export type IngestSummary = {
  sourceName: string;
  rowsRead: number;
  created: number;
  updated: number;
  skipped: SkippedRow[];
};

export async function ingestSource(
  sourceId: string,
  fetcher: SheetFetcher,
): Promise<IngestSummary> {
  const source = await prisma.sheetSource.findUniqueOrThrow({
    where: { id: sourceId },
  });

  const values = await fetcher({
    spreadsheetId: source.spreadsheetId,
    tabName: source.tabName,
  });

  const rows = rowsFromValues(values, source.headerRows);
  const { parsed, skipped } = parseRows({
    sourceId: source.id,
    rows,
    columnMap: source.columnMap as ColumnMap,
    keyColumn: source.keyColumn,
  });

  // Rows naming a catalogue entry inherit its duration.
  const templates = await prisma.taskTemplate.findMany({
    where: { departmentId: source.departmentId },
  });
  const templateByName = new Map(
    templates.map((t) => [t.name.toLowerCase(), t]),
  );

  const DEFAULT_MINUTES = 60;

  const existing = await prisma.task.findMany({
    where: { externalKey: { in: parsed.map((p) => p.externalKey) } },
    select: { externalKey: true, id: true, status: true },
  });
  const existingBy = new Map(
    existing.map((e) => [e.externalKey as string, e]),
  );

  let created = 0;
  let updated = 0;

  for (const row of parsed) {
    const template = row.templateName
      ? templateByName.get(row.templateName.toLowerCase())
      : undefined;

    const estimatedMinutes =
      row.estimatedMinutes ?? template?.estimatedMinutes ?? DEFAULT_MINUTES;

    const current = existingBy.get(row.externalKey);

    if (!current) {
      await prisma.task.create({
        data: {
          externalKey: row.externalKey,
          title: row.title,
          description: row.description,
          estimatedMinutes,
          dueDate: row.dueDate,
          departmentId: source.departmentId,
          templateId: template?.id ?? null,
          origin: "SHEET",
          status: "UNASSIGNED",
        },
      });
      created += 1;
      continue;
    }

    // Never rewrite work somebody has already started or finished -- the
    // sheet is the source for *what* is needed, not for what happened.
    if (["IN_PROGRESS", "PAUSED", "DONE", "CANCELLED"].includes(current.status)) {
      continue;
    }

    await prisma.task.update({
      where: { id: current.id },
      data: {
        title: row.title,
        description: row.description,
        estimatedMinutes,
        dueDate: row.dueDate,
        templateId: template?.id ?? null,
      },
    });
    updated += 1;
  }

  await prisma.sheetSource.update({
    where: { id: source.id },
    data: { lastPolledAt: new Date() },
  });

  return {
    sourceName: source.name,
    rowsRead: rows.length,
    created,
    updated,
    skipped,
  };
}

export async function ingestAll(fetcher: SheetFetcher): Promise<IngestSummary[]> {
  const sources = await prisma.sheetSource.findMany({ where: { active: true } });
  const summaries: IngestSummary[] = [];
  for (const source of sources) {
    summaries.push(await ingestSource(source.id, fetcher));
  }
  return summaries;
}
