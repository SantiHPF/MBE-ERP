-- "I cannot do this one."
--
-- Until now a person's only honest exits from a task were: finish it, pause it
-- with a reason, or defer it with a reason and a date. Two problems with that.
--
-- First, the reasons went nowhere. TaskDeferral.reason has been written on
-- every deferral since 20260727190000 and read by nothing -- the manager never
-- saw why the plan slipped. PauseEvent.reasonText did surface in triage, but
-- only for work that was already started and is paused right now, which is not
-- the same thing as "I turned up for the meeting and they weren't in".
--
-- Second, a task you cannot do stops the day. blockingTask() runs the day in
-- scheduled order and refuses to start anything below an unfinished task above
-- it, so one blocked job holds up every job after it.
--
-- So: a record of the account somebody gave, and what they chose to do about
-- it, plus a status for work set aside so it stops blocking the rest.

-- ------------------------------------------------------------- set aside
-- Still owed and still theirs -- it belongs in OUTSTANDING and OWED -- but
-- skipped by the ordering rule. Not in STARTED: there is no tracked time.
ALTER TYPE "TaskStatus" ADD VALUE 'SET_ASIDE';

-- ---------------------------------------------------------------- blocks
CREATE TYPE "BlockOutcome" AS ENUM (
  'MOVED', 'HANDED_BACK', 'SET_ASIDE', 'CANCEL_REQUESTED'
);

CREATE TABLE "TaskBlock" (
  "id"         TEXT NOT NULL,
  "taskId"     TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "reason"     TEXT NOT NULL,
  "outcome"    "BlockOutcome" NOT NULL,
  -- Where it went, for MOVED. Null for everything else.
  "movedTo"    DATE,
  -- Null while it is still waiting for a manager. This is the queue.
  "resolvedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TaskBlock_pkey" PRIMARY KEY ("id")
);

-- CASCADE on the task: the account of why a task could not be done has no
-- meaning once the task is gone. RESTRICT on the user, matching TaskDeferral:
-- people are deactivated rather than deleted, and losing who said it would
-- make the record useless.
ALTER TABLE "TaskBlock"
  ADD CONSTRAINT "TaskBlock_taskId_fkey" FOREIGN KEY ("taskId")
  REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskBlock"
  ADD CONSTRAINT "TaskBlock_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "TaskBlock_taskId_idx" ON "TaskBlock"("taskId");
-- The triage query: unresolved first, newest first.
CREATE INDEX "TaskBlock_resolvedAt_createdAt_idx"
  ON "TaskBlock"("resolvedAt", "createdAt");

-- -------------------------------------------------------- why it is unplaced
-- assignDay works out a reason for every task it could not place -- no-capacity,
-- no-slot-fits, needs-splitting -- and runSchedule threw it away. That is why
-- the third section of /triage is a bare count with a paragraph of prose
-- instead of a list somebody can act on.
ALTER TABLE "Task" ADD COLUMN "unplacedReason" TEXT;
