import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { CandidateBoard } from "./candidate-board";

export const dynamic = "force-dynamic";

export default async function CandidatesPage() {
  const user = await requireUser();

  const [candidates, sources] = await Promise.all([
    prisma.candidate.findMany({
      where: { departmentId: user.departmentId },
      include: { source: { select: { id: true, name: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.crmSource.findMany({
      where: { departmentId: user.departmentId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <CandidateBoard
      candidates={candidates.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        notes: c.notes,
        stage: c.stage,
        active: c.active,
        dropReason: c.dropReason,
        dropNote: c.dropNote,
        sourceId: c.sourceId,
        sourceName: c.source?.name ?? null,
        // Someone in Call who has not been reached for yet is on today's list.
        awaitingCall: c.active && c.stage === "CALL" && c.lastAttemptedAt === null,
      }))}
      sources={sources}
    />
  );
}
