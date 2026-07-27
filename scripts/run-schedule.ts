import "dotenv/config";
import { runSchedule } from "../src/lib/scheduling/run";
import { formatDuration } from "../src/lib/time";

/**
 * Runs the scheduling engine over a date window.
 *
 *   npm run schedule                 -- today plus 13 days
 *   npm run schedule 2026-07-27      -- two weeks from that Monday
 *
 * Safe to run repeatedly: generated tasks are keyed, and work already
 * started is never touched.
 */
async function main() {
  const from = process.argv[2] ? new Date(process.argv[2]) : undefined;

  const started = Date.now();
  const summary = await runSchedule({ from });

  console.log(
    `\nScheduled ${summary.from.toISOString().slice(0, 10)} → ` +
      `${summary.to.toISOString().slice(0, 10)}\n`,
  );
  console.log(`  tasks created      ${summary.created}`);
  console.log(`  already existed    ${summary.alreadyPresent}`);
  console.log(`  assigned           ${summary.assigned}`);
  console.log(`  left unassigned    ${summary.unassigned}`);
  console.log(`  in flight, skipped ${summary.skippedInFlight}`);
  console.log(`\n  took ${Date.now() - started}ms\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
