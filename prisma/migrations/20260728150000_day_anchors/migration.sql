-- Points in a working day, for tasks done several times a shift.
--
-- "On arrival" is 09:00 for one person and 08:00 for another, so a check done
-- at the start of every shift cannot be a fixed clock time. These resolve per
-- person against their own working pattern.
CREATE TYPE "DayAnchor" AS ENUM (
  'ARRIVAL',
  'BEFORE_BREAK',
  'AFTER_BREAK',
  'BEFORE_LEAVING'
);

-- Ordered; when non-empty its length replaces instancesPerOccurrence.
ALTER TABLE "RecurringRule"
  ADD COLUMN "anchors" "DayAnchor"[] DEFAULT ARRAY[]::"DayAnchor"[];

-- Copied onto each generated task so re-placing it later still honours it.
ALTER TABLE "Task" ADD COLUMN "anchor" "DayAnchor";
