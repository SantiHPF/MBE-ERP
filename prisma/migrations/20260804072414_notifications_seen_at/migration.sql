-- AlterTable
ALTER TABLE "RecurringRule" ALTER COLUMN "anchors" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationsSeenAt" TIMESTAMP(3);
