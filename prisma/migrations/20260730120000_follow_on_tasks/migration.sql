-- Work that goes hand in hand.
--
-- Some jobs only make sense as a pair: you review the portals and then you
-- write the report. The link is stored on the *follower* rather than the
-- leader, so several entries can hang off one -- reviewing the portals may
-- produce both a report and a Gantt update.

-- --------------------------------------------------------------- catalogue
-- SET NULL rather than CASCADE: deleting "Revision Portales" from the
-- catalogue should not silently delete the report entry too. The report
-- becomes ordinary standalone work and somebody can re-point it.
ALTER TABLE "TaskTemplate" ADD COLUMN "followsId" TEXT;

ALTER TABLE "TaskTemplate"
  ADD CONSTRAINT "TaskTemplate_followsId_fkey"
  FOREIGN KEY ("followsId") REFERENCES "TaskTemplate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "TaskTemplate_followsId_idx" ON "TaskTemplate"("followsId");

-- ------------------------------------------------------------------- tasks
-- CASCADE here, unlike the catalogue: a follower instance is the second half
-- of one day's work and has no meaning once the first half is gone. The
-- stale sweep in run.ts deletes unclaimed recurring tasks, and their
-- followers should go with them rather than linger pointing at nothing.
ALTER TABLE "Task" ADD COLUMN "followsTaskId" TEXT;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_followsTaskId_fkey"
  FOREIGN KEY ("followsTaskId") REFERENCES "Task"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Task_followsTaskId_idx" ON "Task"("followsTaskId");
