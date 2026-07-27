-- CreateEnum
CREATE TYPE "AbsenceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'HR';

-- AlterTable
ALTER TABLE "Absence" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "status" "AbsenceStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Absence_status_idx" ON "Absence"("status");

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
