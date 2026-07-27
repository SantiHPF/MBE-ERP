-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "RecurringRule" ADD COLUMN     "frequency" "Frequency" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "monthlyDay" INTEGER,
ADD COLUMN     "monthlyNth" INTEGER,
ADD COLUMN     "sourceNote" TEXT;
