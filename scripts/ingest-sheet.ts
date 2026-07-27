import "dotenv/config";
import { readFileSync } from "node:fs";
import { ingestAll } from "../src/lib/sheets/ingest";
import { csvFetcher, googleSheetFetcher } from "../src/lib/sheets/google";

/**
 * Pulls every active sheet source into tasks.
 *
 *   npm run ingest                    -- read the real Google Sheets
 *   npm run ingest -- --csv path.csv  -- read a local CSV instead
 *
 * The CSV mode exists so the ingest can be tried, and a bad row reproduced,
 * without needing a service account.
 */
async function main() {
  const csvFlag = process.argv.indexOf("--csv");
  const fetcher =
    csvFlag !== -1
      ? csvFetcher(readFileSync(process.argv[csvFlag + 1], "utf8"))
      : googleSheetFetcher;

  const summaries = await ingestAll(fetcher);

  if (summaries.length === 0) {
    console.log("\nNo active sheet sources configured.\n");
    return;
  }

  for (const s of summaries) {
    console.log(`\n${s.sourceName}`);
    console.log(`  rows read   ${s.rowsRead}`);
    console.log(`  created     ${s.created}`);
    console.log(`  updated     ${s.updated}`);
    if (s.skipped.length > 0) {
      console.log(`  skipped     ${s.skipped.length}`);
      for (const row of s.skipped) {
        console.log(`    row ${row.rowNumber}: ${row.reason}`);
      }
    }
  }
  console.log();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
