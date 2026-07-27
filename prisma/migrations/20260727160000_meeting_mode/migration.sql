
-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "sourceTaskId" TEXT;

-- AlterTable
ALTER TABLE "TaskTemplate" ADD COLUMN     "isMeeting" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_sourceTaskId_key" ON "Meeting"("sourceTaskId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

