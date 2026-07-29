-- CRM: the universities and portals interns come from, and the candidates
-- themselves. Concrete tables rather than a configurable entity builder; a
-- second CRM later reuses the interaction log and the call-due machinery.

CREATE TYPE "CrmSourceType" AS ENUM ('UNIVERSITY', 'JOB_PORTAL');
CREATE TYPE "CandidateStage" AS ENUM ('APPLIED', 'CALL', 'PROCESS', 'TEST', 'OFFER', 'HIRED');
CREATE TYPE "CandidateDropReason" AS ENUM (
  'NOT_INTERESTED', 'NO_REPLY', 'REJECTED', 'TOOK_ANOTHER_OFFER', 'NOT_AVAILABLE', 'OTHER'
);
CREATE TYPE "CrmOutcome" AS ENUM ('TALKED', 'NO_ANSWER', 'LEFT_MESSAGE');

-- One batched call task holds many people, so this is a task origin, not a
-- task per person.
ALTER TYPE "TaskOrigin" ADD VALUE 'CRM';

CREATE TABLE "CrmSource" (
  "id"              TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "type"            "CrmSourceType" NOT NULL DEFAULT 'UNIVERSITY',
  "departmentId"    TEXT NOT NULL,
  "offersUpdatedAt" TIMESTAMP(3),
  "lastContactedAt" TIMESTAMP(3),
  "notes"           TEXT,
  "active"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmContact" (
  "id"              TEXT NOT NULL,
  "sourceId"        TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "jobTitle"        TEXT,
  "phone"           TEXT,
  "email"           TEXT,
  "lastContactedAt" TIMESTAMP(3),
  "active"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Candidate" (
  "id"              TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "phone"           TEXT,
  "email"           TEXT,
  "notes"           TEXT,
  "departmentId"    TEXT NOT NULL,
  "stage"           "CandidateStage" NOT NULL DEFAULT 'APPLIED',
  "sourceId"        TEXT,
  "active"          BOOLEAN NOT NULL DEFAULT true,
  "dropReason"      "CandidateDropReason",
  "dropNote"        TEXT,
  "lastAttemptedAt" TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmInteraction" (
  "id"           TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "sourceId"     TEXT,
  "contactId"    TEXT,
  "candidateId"  TEXT,
  "userId"       TEXT NOT NULL,
  "happenedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outcome"      "CrmOutcome" NOT NULL,
  "notes"        TEXT NOT NULL,
  "taskId"       TEXT,
  CONSTRAINT "CrmInteraction_pkey" PRIMARY KEY ("id")
);

-- A conversation is with exactly one party. Prisma has no polymorphic
-- relations, so without this the three columns could all be null (a log entry
-- about nobody) or all be set (a conversation with three different people).
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_one_subject"
  CHECK (
    (("sourceId" IS NOT NULL)::int
     + ("contactId" IS NOT NULL)::int
     + ("candidateId" IS NOT NULL)::int) = 1
  );

CREATE UNIQUE INDEX "CrmSource_departmentId_name_key" ON "CrmSource"("departmentId", "name");
CREATE INDEX "CrmSource_departmentId_lastContactedAt_idx" ON "CrmSource"("departmentId", "lastContactedAt");
CREATE INDEX "CrmContact_sourceId_lastContactedAt_idx" ON "CrmContact"("sourceId", "lastContactedAt");
CREATE INDEX "Candidate_departmentId_stage_active_idx" ON "Candidate"("departmentId", "stage", "active");
CREATE INDEX "Candidate_sourceId_idx" ON "Candidate"("sourceId");
CREATE INDEX "CrmInteraction_sourceId_happenedAt_idx" ON "CrmInteraction"("sourceId", "happenedAt");
CREATE INDEX "CrmInteraction_contactId_happenedAt_idx" ON "CrmInteraction"("contactId", "happenedAt");
CREATE INDEX "CrmInteraction_candidateId_happenedAt_idx" ON "CrmInteraction"("candidateId", "happenedAt");
CREATE INDEX "CrmInteraction_departmentId_happenedAt_idx" ON "CrmInteraction"("departmentId", "happenedAt");

ALTER TABLE "CrmSource" ADD CONSTRAINT "CrmSource_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "CrmSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "CrmSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "CrmSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
