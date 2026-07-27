import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Configures a sheet source pointing at fixtures/example-job-sheet.csv, so the
 * ingest can be demonstrated before anyone has set up a Google service
 * account:
 *
 *   npx tsx scripts/demo-sheet-source.ts
 *   npm run ingest -- --csv fixtures/example-job-sheet.csv
 *
 * For a real sheet, set spreadsheetId to the id from its URL and tabName to
 * the tab, then run `npm run ingest` with no arguments.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const ops = await prisma.department.findFirstOrThrow({
    where: { name: "Operations" },
  });

  await prisma.sheetSource.deleteMany({ where: { spreadsheetId: "local-csv" } });

  await prisma.sheetSource.create({
    data: {
      name: "Ops job sheet",
      spreadsheetId: "local-csv",
      tabName: "Jobs",
      departmentId: ops.id,
      headerRows: 1,
      // Ref column: gives each row a stable identity, so reordering the sheet
      // does not create duplicate tasks.
      keyColumn: "F",
      columnMap: {
        client: "A",
        title: "B",
        dueDate: "C",
        template: "D",
        estimatedMinutes: "E",
      },
    },
  });

  console.log("Configured 'Ops job sheet' against fixtures/example-job-sheet.csv");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
