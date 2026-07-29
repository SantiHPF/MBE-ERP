"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canManagePeople, requireUserOrThrow } from "@/lib/auth/guards";
import { errorText, fail } from "@/lib/i18n/errors";
import { getT } from "@/lib/i18n/server";
import { logCandidateCall, logSourceCall } from "./interactions";
import { syncCrmCalls } from "./sync";

/**
 * The CRM's writes.
 *
 * Everything is scoped to the actor's department: a CRM belongs to the team
 * that runs it, and HR has no business editing Sales' pipeline. ADMIN is the
 * exception, as everywhere else.
 */

export type CrmState = { error?: string; ok?: boolean; message?: string };

async function actor() {
  const user = await requireUserOrThrow();
  // HR runs the two CRMs that exist. When a second department gets one this
  // becomes a per-department capability rather than a role check.
  if (!canManagePeople(user)) fail("errors.crmNotAllowed");
  return user;
}

/** Refuse to touch anything belonging to another department. */
async function ownedSource(sourceId: string, departmentId: string, isAdmin: boolean) {
  const source = await prisma.crmSource.findUnique({ where: { id: sourceId } });
  if (!source) fail("errors.sourceGone");
  if (!isAdmin && source.departmentId !== departmentId) fail("errors.otherDepartment");
  return source;
}

async function ownedCandidate(id: string, departmentId: string, isAdmin: boolean) {
  const candidate = await prisma.candidate.findUnique({ where: { id } });
  if (!candidate) fail("errors.candidateGone");
  if (!isAdmin && candidate.departmentId !== departmentId) {
    fail("errors.otherDepartment");
  }
  return candidate;
}

function revalidate() {
  revalidatePath("/crm/sources");
  revalidatePath("/crm/candidates");
  revalidatePath("/my-day");
}

// ------------------------------------------------------------- sources

const SourceInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "errors.giveThemAName"),
  type: z.enum(["UNIVERSITY", "JOB_PORTAL"]),
  offersUpdatedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(2000).optional(),
});

export async function saveSource(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  try {
    const user = await actor();
    const { t } = await getT();
    const parsed = SourceInput.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      type: formData.get("type") || "UNIVERSITY",
      offersUpdatedAt: formData.get("offersUpdatedAt") || undefined,
      notes: formData.get("notes") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    const data = {
      name: parsed.data.name,
      type: parsed.data.type,
      offersUpdatedAt: parsed.data.offersUpdatedAt
        ? new Date(`${parsed.data.offersUpdatedAt}T00:00:00Z`)
        : null,
      notes: parsed.data.notes || null,
    };

    if (parsed.data.id) {
      await ownedSource(parsed.data.id, user.departmentId, user.role === "ADMIN");
      await prisma.crmSource.update({ where: { id: parsed.data.id }, data });
    } else {
      const clash = await prisma.crmSource.findFirst({
        where: { departmentId: user.departmentId, name: parsed.data.name },
      });
      if (clash) return { error: t("errors.sourceExists") };
      await prisma.crmSource.create({
        data: { ...data, departmentId: user.departmentId },
      });
    }

    revalidate();
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

export async function setSourceActive(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  try {
    const user = await actor();
    const id = String(formData.get("id") ?? "");
    const active = formData.get("active") === "true";
    await ownedSource(id, user.departmentId, user.role === "ADMIN");

    await prisma.crmSource.update({ where: { id }, data: { active } });
    // Retiring one takes it off today's call list straight away.
    await syncCrmCalls(user.departmentId);
    revalidate();
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

// ------------------------------------------------------------ contacts

const ContactInput = z.object({
  id: z.string().optional(),
  sourceId: z.string().min(1),
  name: z.string().trim().min(1, "errors.giveThemAName"),
  jobTitle: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function saveContact(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  try {
    const user = await actor();
    const { t } = await getT();
    const parsed = ContactInput.safeParse({
      id: formData.get("id") || undefined,
      sourceId: formData.get("sourceId"),
      name: formData.get("name"),
      jobTitle: formData.get("jobTitle") || undefined,
      phone: formData.get("phone") || undefined,
      email: formData.get("email") || undefined,
      notes: formData.get("notes") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    await ownedSource(parsed.data.sourceId, user.departmentId, user.role === "ADMIN");

    const data = {
      name: parsed.data.name,
      jobTitle: parsed.data.jobTitle || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      notes: parsed.data.notes || null,
    };

    if (parsed.data.id) {
      await prisma.crmContact.update({ where: { id: parsed.data.id }, data });
    } else {
      await prisma.crmContact.create({
        data: { ...data, sourceId: parsed.data.sourceId },
      });
    }

    revalidate();
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

export async function setContactActive(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  try {
    const user = await actor();
    const id = String(formData.get("id") ?? "");
    const active = formData.get("active") === "true";

    const contact = await prisma.crmContact.findUnique({ where: { id } });
    if (!contact) fail("errors.contactGone");
    await ownedSource(contact.sourceId, user.departmentId, user.role === "ADMIN");

    await prisma.crmContact.update({ where: { id }, data: { active } });
    revalidate();
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

// ---------------------------------------------------------- candidates

const STAGES = ["APPLIED", "CALL", "PROCESS", "TEST", "OFFER", "HIRED"] as const;

const CandidateInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "errors.giveThemAName"),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(4000).optional(),
  stage: z.enum(STAGES),
  sourceId: z.string().optional(),
});

export async function saveCandidate(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  try {
    const user = await actor();
    const { t } = await getT();
    const parsed = CandidateInput.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      phone: formData.get("phone") || undefined,
      email: formData.get("email") || undefined,
      notes: formData.get("notes") || undefined,
      stage: formData.get("stage") || "APPLIED",
      sourceId: formData.get("sourceId") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    if (parsed.data.sourceId) {
      await ownedSource(parsed.data.sourceId, user.departmentId, user.role === "ADMIN");
    }

    const data = {
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      notes: parsed.data.notes || null,
      stage: parsed.data.stage,
      sourceId: parsed.data.sourceId || null,
    };

    if (parsed.data.id) {
      const before = await ownedCandidate(
        parsed.data.id,
        user.departmentId,
        user.role === "ADMIN",
      );
      await prisma.candidate.update({
        where: { id: parsed.data.id },
        data: {
          ...data,
          // Moving somebody into Call is what puts them on the list, so the
          // previous attempt must not keep them off it.
          ...(before.stage !== "CALL" && parsed.data.stage === "CALL"
            ? { lastAttemptedAt: null }
            : {}),
        },
      });
    } else {
      await prisma.candidate.create({
        data: { ...data, departmentId: user.departmentId },
      });
    }

    await syncCrmCalls(user.departmentId);
    revalidate();
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

const Reactivate = z.object({ id: z.string().min(1) });

const Deactivate = z.object({
  id: z.string().min(1),
  reason: z.enum([
    "NOT_INTERESTED",
    "NO_REPLY",
    "REJECTED",
    "TOOK_ANOTHER_OFFER",
    "NOT_AVAILABLE",
    "OTHER",
  ]),
  note: z.string().trim().max(2000).optional(),
});

export async function deactivateCandidate(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  try {
    const user = await actor();
    const { t } = await getT();
    const parsed = Deactivate.safeParse({
      id: formData.get("id"),
      reason: formData.get("reason"),
      note: formData.get("note") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    await ownedCandidate(parsed.data.id, user.departmentId, user.role === "ADMIN");
    await prisma.candidate.update({
      where: { id: parsed.data.id },
      data: {
        active: false,
        dropReason: parsed.data.reason,
        dropNote: parsed.data.note || null,
      },
    });

    await syncCrmCalls(user.departmentId);
    revalidate();
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

export async function reactivateCandidate(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  try {
    const user = await actor();
    const parsed = Reactivate.parse({ id: formData.get("id") });
    await ownedCandidate(parsed.id, user.departmentId, user.role === "ADMIN");

    await prisma.candidate.update({
      where: { id: parsed.id },
      data: {
        active: true,
        dropReason: null,
        dropNote: null,
        // Back in play means owed a call again.
        lastAttemptedAt: null,
      },
    });

    await syncCrmCalls(user.departmentId);
    revalidate();
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

// --------------------------------------------------------- logging calls

const OUTCOMES = ["TALKED", "NO_ANSWER", "LEFT_MESSAGE"] as const;

const CallLog = z.object({
  outcome: z.enum(OUTCOMES),
  notes: z.string().trim().max(4000),
  taskId: z.string().optional(),
});

/**
 * A call to somebody at a university or portal, logged from the call panel or
 * from the source's own page.
 */
export async function logSourceConversation(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  try {
    const user = await actor();
    const { t } = await getT();
    const parsed = CallLog.safeParse({
      outcome: formData.get("outcome"),
      notes: formData.get("notes") ?? "",
      taskId: formData.get("taskId") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    // A conversation with nothing written down is the thing this exists to
    // prevent; an unanswered call needs no notes.
    if (parsed.data.outcome === "TALKED" && parsed.data.notes.length < 3) {
      return { error: t("errors.sayWhatWasSaid") };
    }

    const sourceId = String(formData.get("sourceId") ?? "");
    const contactId = String(formData.get("contactId") ?? "") || null;
    const source = await ownedSource(
      sourceId,
      user.departmentId,
      user.role === "ADMIN",
    );

    await logSourceCall({
      departmentId: source.departmentId,
      userId: user.id,
      sourceId,
      contactId,
      outcome: parsed.data.outcome,
      notes: parsed.data.notes,
      taskId: parsed.data.taskId ?? null,
    });

    await countOffCall(parsed.data.taskId, user.id);
    await syncCrmCalls(user.departmentId);
    revalidate();
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

export async function logCandidateConversation(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  try {
    const user = await actor();
    const { t } = await getT();
    const parsed = CallLog.safeParse({
      outcome: formData.get("outcome"),
      notes: formData.get("notes") ?? "",
      taskId: formData.get("taskId") || undefined,
    });
    if (!parsed.success) return { error: t(parsed.error.issues[0].message) };

    if (parsed.data.outcome === "TALKED" && parsed.data.notes.length < 3) {
      return { error: t("errors.sayWhatWasSaid") };
    }

    const candidateId = String(formData.get("candidateId") ?? "");
    const candidate = await ownedCandidate(
      candidateId,
      user.departmentId,
      user.role === "ADMIN",
    );

    await logCandidateCall({
      departmentId: candidate.departmentId,
      userId: user.id,
      candidateId,
      outcome: parsed.data.outcome,
      notes: parsed.data.notes,
      taskId: parsed.data.taskId ?? null,
    });

    await countOffCall(parsed.data.taskId, user.id);
    await syncCrmCalls(user.departmentId);
    revalidate();
    return { ok: true };
  } catch (error) {
    return { error: await errorText(error, "errors.couldNotSave") };
  }
}

/**
 * Tick one off the batched task's counter, so the block shows progress the
 * same way any other repeatable task does.
 */
async function countOffCall(taskId: string | undefined, userId: string) {
  if (!taskId) return;
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.assigneeId !== userId) return;
  if (task.doneCount >= task.quantity) return;

  await prisma.task.update({
    where: { id: taskId },
    data: { doneCount: task.doneCount + 1 },
  });
}
