-- Talking to each other.
--
-- There was no way for one person in this app to say anything to another. A
-- task could be handed over, deferred, orphaned or blocked, and in every case
-- the only thing that travelled with it was a status. "I'm giving you the
-- Tuesday interviews because I'll be at the fair" had nowhere to go.
--
-- One row per message per recipient, and deliberately no thread table: a
-- conversation is every message between two people in either direction,
-- ordered by time. That is all this needs, and it keeps the unread badge --
-- which runs on every page load -- a single indexed count rather than an
-- aggregate over a join.

CREATE TABLE "Message" (
  "id"          TEXT NOT NULL,
  "senderId"    TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  -- Set when it was sent alongside a task.
  "taskId"      TEXT,
  -- Null until read. This column is the whole notification system.
  "readAt"      TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- RESTRICT on both people, matching TaskDeferral: people are deactivated
-- rather than deleted here, and a message from nobody is not worth keeping.
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId")
  REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_recipientId_fkey" FOREIGN KEY ("recipientId")
  REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL rather than CASCADE: a message about a task that has since been
-- cancelled is still something somebody said, and deleting it would quietly
-- rewrite a conversation.
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_taskId_fkey" FOREIGN KEY ("taskId")
  REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The badge: count where recipientId = me and readAt is null.
CREATE INDEX "Message_recipientId_readAt_idx" ON "Message"("recipientId", "readAt");
-- The inbox, and the two halves of a conversation.
CREATE INDEX "Message_recipientId_createdAt_idx"
  ON "Message"("recipientId", "createdAt");
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");
