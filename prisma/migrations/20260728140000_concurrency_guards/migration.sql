-- Two invariants the application already assumed but nothing enforced.

-- 1. One running clock per person.
--
-- startTask() read "is anything running?" outside its transaction, so two
-- concurrent starts could both see nothing and both open an entry, and the
-- elapsed time was then counted twice. Re-reading inside the transaction
-- narrows the window but cannot close it under READ COMMITTED; this index is
-- what actually makes it impossible.
CREATE UNIQUE INDEX "TimeEntry_one_open_per_user"
  ON "TimeEntry" ("userId")
  WHERE "endedAt" IS NULL;

-- 2. One plan-board claim per catalogue task per day.
--
-- Taking an empty cell on the plan board did findFirst-then-create, so two
-- people clicking the same cell at once both created the task.
--
-- Deliberately scoped to origin = 'CATALOGUE': a recurring rule with
-- instancesPerOccurrence > 1 is *supposed* to produce several tasks for one
-- template on one day, and cancelled tasks must not block re-taking the work,
-- which matches the status filter the action itself uses.
CREATE UNIQUE INDEX "Task_one_catalogue_claim_per_day"
  ON "Task" ("templateId", "dueDate")
  WHERE "origin" = 'CATALOGUE' AND "status" <> 'CANCELLED';
