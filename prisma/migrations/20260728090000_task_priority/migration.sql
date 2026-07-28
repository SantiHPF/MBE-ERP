
-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('MUST', 'NORMAL', 'SPARE_TIME');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "TaskTemplate" ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'NORMAL';

