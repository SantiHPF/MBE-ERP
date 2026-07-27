import type { SheetFetcher } from "./ingest";

/**
 * The real Google Sheets fetcher.
 *
 * Uses a service account with read-only scope: share the sheet with the
 * service account's email address, and no OAuth dance is needed. googleapis
 * is imported lazily so nothing here is loaded -- or required to be
 * configured -- until a sheet is actually polled.
 */
export const googleSheetFetcher: SheetFetcher = async ({
  spreadsheetId,
  tabName,
}) => {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (!keyFile) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY_FILE is not set. Add the service-account " +
        "JSON key path to .env, and share the sheet with that account.",
    );
  }

  const { google } = await import("googleapis");

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tabName,
  });

  return (response.data.values ?? []) as string[][];
};

/**
 * Reads a local CSV instead of Google. Useful for trying the ingest before
 * anyone has set up a service account, and for reproducing a bad row that
 * somebody reports.
 */
export function csvFetcher(csv: string): SheetFetcher {
  return async () =>
    csv
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => splitCsvLine(line));
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char !== '"') {
        current += char;
      } else if (line[i + 1] === '"') {
        // A doubled quote inside quotes is a literal quote.
        current += '"';
        i++;
      } else {
        inQuotes = false;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}
