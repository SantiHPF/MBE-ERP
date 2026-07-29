-- Attendance: when somebody was actually here.
--
-- Every signal is stored separately -- login, first task, last task, logout --
-- and the in/out pair that counts is derived from them. Collapsing them on the
-- way in would lose "arrived at 08:00, started work at 10:30", which is the
-- question this table exists to answer.
--
-- Also adds a personal note to a CRM contact, which is unrelated but ships in
-- the same migration so the dev server only has to be restarted once (the
-- Prisma client is cached on globalThis and will not pick up new models on a
-- hot reload).

CREATE TYPE "AttendanceSource" AS ENUM (
  'LOGIN', 'TASK_START', 'TASK_END', 'LOGOUT', 'DAY_CLOSED', 'AUTO_CLOSE', 'MANUAL'
);
CREATE TYPE "AttendanceStatus" AS ENUM ('OPEN', 'CLOSED', 'NEEDS_REVIEW');

CREATE TABLE "AttendanceDay" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "date"             DATE NOT NULL,

  "startedAt"        TIMESTAMP(3),
  "startSource"      "AttendanceSource",
  "endedAt"          TIMESTAMP(3),
  "endSource"        "AttendanceSource",

  "firstLoginAt"     TIMESTAMP(3),
  "firstTaskStartAt" TIMESTAMP(3),
  "lastTaskEndAt"    TIMESTAMP(3),
  "logoutAt"         TIMESTAMP(3),
  "lastActivityAt"   TIMESTAMP(3),

  "status"           "AttendanceStatus" NOT NULL DEFAULT 'OPEN',
  "note"             TEXT,

  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- One row per person per day, so every write can be an upsert and a duplicate
-- day is impossible rather than merely unlikely.
CREATE UNIQUE INDEX "AttendanceDay_userId_date_key"
  ON "AttendanceDay" ("userId", "date");

-- The sweep looks for open days in the past; this is the index it uses.
CREATE INDEX "AttendanceDay_status_date_idx"
  ON "AttendanceDay" ("status", "date");

ALTER TABLE "AttendanceDay"
  ADD CONSTRAINT "AttendanceDay_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A closed day must have both ends, and an open one must not claim an end.
-- Inexpressible in the Prisma schema, so it lives here.
ALTER TABLE "AttendanceDay"
  ADD CONSTRAINT "AttendanceDay_closed_has_end" CHECK (
    ("status" = 'OPEN'  AND "endedAt" IS NULL)
    OR ("status" <> 'OPEN' AND "endedAt" IS NOT NULL)
  );

-- An end before the start is never a real reading.
ALTER TABLE "AttendanceDay"
  ADD CONSTRAINT "AttendanceDay_end_after_start" CHECK (
    "endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt"
  );

-- ---------------------------------------------------------------- CRM note

ALTER TABLE "CrmContact" ADD COLUMN "notes" TEXT;
