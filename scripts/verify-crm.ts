/**
 * End-to-end check for the CRM's call generation, against a dev database.
 *
 * Seeds a university last spoken to three months ago with two contacts, and a
 * candidate sitting in Call; runs the real scheduler; asserts one batched task
 * per CRM with the right counts and the right person nominated. Then logs a
 * call through the real action and re-runs to prove the work goes away.
 *
 * Run with: npm run verify:crm   (cleans up after itself)
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { runSchedule } from "../src/lib/scheduling/run";
import { syncCrmCalls, callListFor, CALL_TASK_NAMES } from "../src/lib/crm/sync";
import { logSourceCall, logCandidateCall } from "../src/lib/crm/interactions";
import { today } from "../src/lib/time";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const TAG = "__crm check__";
/**
 * Its own department, so the counts assert what this script created rather
 * than whatever else happens to be in the database. Counting the real HR
 * department made the run depend on the state of the dev data.
 */
const DEPT = "__crm check department__";
let failures = 0;

function check(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "  ok  " : " FAIL "} ${name} — ${detail}`);
  if (!passed) failures += 1;
}

async function cleanup() {
  const dept = await prisma.department.findUnique({ where: { name: DEPT } });
  if (!dept) return;
  await prisma.task.deleteMany({ where: { departmentId: dept.id } });
  await prisma.crmInteraction.deleteMany({ where: { departmentId: dept.id } });
  await prisma.candidate.deleteMany({ where: { departmentId: dept.id } });
  await prisma.crmSource.deleteMany({ where: { departmentId: dept.id } });
  await prisma.department.delete({ where: { id: dept.id } });
}

const monthsAgo = (n: number) => {
  const d = today();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
};

async function main() {
  await cleanup();

  const department = await prisma.department.create({ data: { name: DEPT } });
  const user = await prisma.user.findFirstOrThrow({ where: { active: true } });

  // A university we last spoke to three months ago -- overdue.
  const source = await prisma.crmSource.create({
    data: {
      name: `${TAG} Universidad`,
      departmentId: department.id,
      type: "UNIVERSITY",
      lastContactedAt: monthsAgo(3),
      contacts: {
        create: [
          { name: "Ana Torres", jobTitle: "Career services", phone: "600111222", lastContactedAt: monthsAgo(3) },
          { name: "Luis Vega", jobTitle: "Head of placements", phone: "600333444", lastContactedAt: null },
        ],
      },
    },
    include: { contacts: true },
  });

  // One we spoke to last week -- not due.
  await prisma.crmSource.create({
    data: {
      name: `${TAG} Portal reciente`,
      departmentId: department.id,
      type: "JOB_PORTAL",
      lastContactedAt: new Date(),
    },
  });

  const candidate = await prisma.candidate.create({
    data: {
      name: `${TAG} Marta`,
      departmentId: department.id,
      stage: "CALL",
      phone: "600555666",
      sourceId: source.id,
    },
  });
  // Another in a stage that must raise nothing.
  await prisma.candidate.create({
    data: { name: `${TAG} Pablo`, departmentId: department.id, stage: "PROCESS" },
  });

  await runSchedule({ departmentId: department.id });

  const tasks = await prisma.task.findMany({
    where: { origin: "CRM", departmentId: department.id },
    orderBy: { title: "asc" },
  });

  check(
    "one batched task per CRM, not one per person",
    tasks.length === 2,
    `${tasks.length} CRM tasks (${tasks.map((t) => t.title).join(", ")})`,
  );

  const sourceTask = tasks.find((t) => t.title === CALL_TASK_NAMES.SOURCE);
  const candidateTask = tasks.find((t) => t.title === CALL_TASK_NAMES.CANDIDATE);

  check(
    "the overdue university is counted, the recent one is not",
    sourceTask?.quantity === 1,
    `quantity ${sourceTask?.quantity} (want 1 of 2 sources)`,
  );

  check(
    "only the Call-stage candidate is counted",
    candidateTask?.quantity === 1,
    `quantity ${candidateTask?.quantity} (want 1 of 2 candidates)`,
  );

  check(
    "the block is sized from the number of calls",
    !!sourceTask &&
      sourceTask.estimatedMinutes === (sourceTask.unitMinutes ?? 0) * sourceTask.quantity,
    `${sourceTask?.quantity} × ${sourceTask?.unitMinutes}m = ${sourceTask?.estimatedMinutes}m`,
  );

  // Who does the panel say to ring?
  const list = sourceTask ? await callListFor(sourceTask.id) : null;
  const nominated =
    list?.kind === "SOURCE" ? list.sources[0]?.contactName : undefined;
  check(
    "it nominates the contact we spoke to longest ago",
    nominated === "Luis Vega",
    `${nominated} (Luis has never been called; Ana was 3 months ago)`,
  );

  // Re-running must not duplicate.
  await runSchedule({ departmentId: department.id });
  const again = await prisma.task.count({
    where: { origin: "CRM", departmentId: department.id },
  });
  check("re-running creates nothing new", again === 2, `${again} CRM tasks`);

  // ------------------------------------------------- log the calls for real
  await logSourceCall({
    departmentId: department.id,
    userId: user.id,
    sourceId: source.id,
    contactId: source.contacts.find((c) => c.name === "Luis Vega")!.id,
    outcome: "TALKED",
    notes: "Sent the intern offers over for September.",
  });

  await logCandidateCall({
    departmentId: department.id,
    userId: user.id,
    candidateId: candidate.id,
    outcome: "NO_ANSWER",
    notes: "No contestó.",
  });

  const afterCandidate = await prisma.candidate.findUniqueOrThrow({
    where: { id: candidate.id },
  });
  check(
    "an unanswered candidate goes inactive with no reply",
    afterCandidate.active === false && afterCandidate.dropReason === "NO_REPLY",
    `active=${afterCandidate.active} reason=${afterCandidate.dropReason}`,
  );

  await syncCrmCalls(department.id);
  const left = await prisma.task.findMany({
    where: { origin: "CRM", departmentId: department.id },
  });
  check(
    "the work goes away once the calls are made",
    left.length === 0,
    `${left.length} CRM tasks remain`,
  );

  const rolled = await prisma.crmSource.findUniqueOrThrow({ where: { id: source.id } });
  check(
    "the two-month clock restarts from the call",
    !!rolled.lastContactedAt && rolled.lastContactedAt > monthsAgo(1),
    `last contacted ${rolled.lastContactedAt?.toISOString().slice(0, 10)}`,
  );

  // Next cycle should reach Ana, since Luis has just been called.
  await prisma.crmSource.update({
    where: { id: source.id },
    data: { lastContactedAt: monthsAgo(3) },
  });
  await syncCrmCalls(department.id);
  const cycle2 = await prisma.task.findFirst({
    where: { origin: "CRM", title: CALL_TASK_NAMES.SOURCE, departmentId: department.id },
  });
  const list2 = cycle2 ? await callListFor(cycle2.id) : null;
  const nominated2 =
    list2?.kind === "SOURCE" ? list2.sources[0]?.contactName : undefined;
  check(
    "the next cycle rings somebody different",
    nominated2 === "Ana Torres",
    `${nominated2} (Luis was called last cycle)`,
  );

  await cleanup();
  console.log(failures === 0 ? "\nthe CRM raises its own work" : `\n${failures} failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch(async (error) => {
    console.error(error);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
