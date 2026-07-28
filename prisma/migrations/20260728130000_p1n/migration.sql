-- CreateEnum
CREATE TYPE "P1nCause" AS ENUM ('ATTENTION', 'PROCESS', 'OTHER');

-- CreateTable
CREATE TABLE "P1n" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "mistake" TEXT NOT NULL,
    "cause" "P1nCause" NOT NULL,
    "solution" TEXT NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "appliedNote" TEXT,

    CONSTRAINT "P1n_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "P1n_departmentId_createdAt_idx" ON "P1n"("departmentId", "createdAt");
CREATE INDEX "P1n_userId_idx" ON "P1n"("userId");

-- AddForeignKey
ALTER TABLE "P1n" ADD CONSTRAINT "P1n_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "P1n" ADD CONSTRAINT "P1n_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "P1n" ADD CONSTRAINT "P1n_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "P1n" ADD CONSTRAINT "P1n_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
