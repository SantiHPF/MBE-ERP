-- Clocking lunch.
--
-- A WorkingPattern says when lunch *should* be -- breakStartMinutes and
-- breakMinutes -- and computeAvailability duly carves it out of capacity. But
-- nobody ever clocked it, so there was no way to see somebody leaving at 12:41
-- for a one o'clock lunch, or coming back at ten past two. The full day was
-- clocked; lunch was assumed.
--
-- Two columns rather than an event log, because there is exactly one rostered
-- lunch a day: a WorkingPattern has a single breakStartMinutes, and a second
-- coffee break is not a thing this is trying to measure. Same shape as the
-- day's own startedAt/endedAt pair, for the same reason.
--
-- A day where nobody clocked lunch is read as lunch taken exactly to the
-- timetable. Nothing is flagged, and presentMinutes deducts the rostered
-- figure either way, so everybody's hours stay honest and only the deviations
-- somebody actually recorded show up.

ALTER TABLE "AttendanceDay" ADD COLUMN "breakStartedAt" TIMESTAMP(3),
  ADD COLUMN "breakEndedAt" TIMESTAMP(3);

-- The same invariant the day itself carries (AttendanceDay_end_after_start in
-- 20260728170000_attendance): you cannot come back from lunch before you left.
-- An open break -- out but not yet back -- is allowed, and is the normal state
-- for the twenty minutes somebody is actually away.
ALTER TABLE "AttendanceDay"
  ADD CONSTRAINT "AttendanceDay_break_end_after_start"
  CHECK ("breakEndedAt" IS NULL OR "breakStartedAt" IS NULL
         OR "breakEndedAt" >= "breakStartedAt");
