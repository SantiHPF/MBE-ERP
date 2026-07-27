
-- CreateTable
CREATE TABLE "TaskDeferral" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDeferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskDeferral_taskId_idx" ON "TaskDeferral"("taskId");

-- CreateIndex
CREATE INDEX "TaskDeferral_userId_createdAt_idx" ON "TaskDeferral"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskDeferral" ADD CONSTRAINT "TaskDeferral_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDeferral" ADD CONSTRAINT "TaskDeferral_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

