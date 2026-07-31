-- Long work, split into sittings.
--
-- A task estimated at ten hours cannot be placed. findSlot() wants one
-- contiguous free window and nobody has one that long, so the job lands
-- UNASSIGNED with "no-slot-fits" and the reason is thrown away. At ATIC,
-- where the work is project-shaped rather than routine-shaped, that is the
-- normal case rather than the exception.
--
-- Teaching the placer to fragment a task would mean every reader of
-- scheduledStart/scheduledEnd learning that a task can have several slots --
-- My Day, the now-bar, pace, /team, reorderDay, the gap-filler. So a long
-- task instead becomes a *parent* holding a run of ordinary child tasks, one
-- per sitting. Each child is a normal placeable Task row, which is what lets
-- pause, defer, orphan, reorder, blockingTask and the gap-filler keep working
-- with no change at all.
--
-- The parent is not work. It has no scheduled slot, ever. That one fact is
-- what keeps it out of every day-scoped query in the app without any of them
-- being touched, and it is why nothing double-counts.

-- ------------------------------------------------------------------ status
--
-- A status rather than an isContainer boolean, because almost every status
-- filter in this codebase is an allow-list -- OUTSTANDING, OWED, STARTED,
-- IMMOVABLE -- and a new enum value is excluded from all of them by
-- construction. A boolean would have to be added to each one by hand, and the
-- one that got missed would be the one that mattered.
ALTER TYPE "TaskStatus" ADD VALUE 'SPLIT';

-- -------------------------------------------------------------- the link
--
-- CASCADE, matching Task.followsTaskId: a sitting is one slice of a job and
-- has no meaning once the job is gone.
--
-- Deliberately a second, separate link rather than reusing followsTaskId.
-- That one would give ordering for free, but runSchedule walks it to a chain
-- root and hands the whole chain one groupKey, and assignGroup() places a
-- group *inside a single day* -- the exact thing sittings exist to avoid.
ALTER TABLE "Task" ADD COLUMN "parentTaskId" TEXT,
  ADD COLUMN "sessionIndex" INTEGER;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_parentTaskId_fkey"
  FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");

-- One row per sitting, so re-spreading a job after a deferral or a sick day
-- can never leave two number 3s behind.
CREATE UNIQUE INDEX "Task_one_row_per_sitting"
  ON "Task" ("parentTaskId", "sessionIndex")
  WHERE "parentTaskId" IS NOT NULL;

-- ---------------------------------------------------------- chunk size
--
-- How long one sitting of this job should be. Null means the default in
-- src/lib/plan/sessions.ts. See the note on the field in schema.prisma for
-- why it is set on the catalogue and not derived from whoever picks it up.
ALTER TABLE "TaskTemplate" ADD COLUMN "sessionMinutes" INTEGER;

-- ------------------------------------------------ the claim guard, widened
--
-- 20260728140000_concurrency_guards stops two people claiming the same
-- plan-board cell:
--
--   ("templateId", "dueDate") WHERE origin = 'CATALOGUE' AND status <> 'CANCELLED'
--
-- A split job now has a parent *and* its sittings, all carrying the same
-- templateId, and a sitting scheduled on the parent's own due date would
-- collide with it -- a unique violation on a perfectly ordinary claim, which
-- claimTemplate would then report as "somebody took it first" to the person
-- who had just taken it.
--
-- Sittings are excluded. The cell is claimed by the parent, which is the
-- thing somebody actually ticked.
DROP INDEX "Task_one_catalogue_claim_per_day";

CREATE UNIQUE INDEX "Task_one_catalogue_claim_per_day"
  ON "Task" ("templateId", "dueDate")
  WHERE "origin" = 'CATALOGUE'
    AND "status" <> 'CANCELLED'
    AND "parentTaskId" IS NULL;
