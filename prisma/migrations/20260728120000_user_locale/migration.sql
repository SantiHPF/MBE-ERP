-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('EN', 'ES');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "locale" "Locale" NOT NULL DEFAULT 'ES';
