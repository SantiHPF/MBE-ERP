-- Morning or afternoon, for work that has no clock time and no anchor but
-- still should not drift across the day.
--
-- Split at one company-wide hour rather than each person's own break: a
-- manager ticking "morning" in the catalogue is saying something about the
-- business, and it should not mean a different thing for each person who picks
-- the task up. See src/lib/scheduling/half.ts.
CREATE TYPE "ShiftHalf" AS ENUM ('MORNING', 'AFTERNOON');

ALTER TABLE "TaskTemplate" ADD COLUMN "shiftHalf" "ShiftHalf";

-- Copied onto each generated task, for the same reason "anchor" is: re-placing
-- it after a deferral or a manual reorder must still honour it, long after the
-- run that created it.
ALTER TABLE "Task" ADD COLUMN "shiftHalf" "ShiftHalf";
