/**
 * Whether an absence actually affects the schedule yet.
 *
 * HR decides every absence, but sickness cannot wait for the decision. Someone
 * phoning in at 07:00 is not at work whether or not HR has looked at it, and a
 * system that kept assigning them tasks until 10:00 would simply be wrong.
 *
 * So: a pending sick day counts immediately and HR's approval is the record
 * step afterwards. Holiday and personal leave are always in the future, so
 * they count only once approved. Rejection stops any of them counting.
 *
 * This is the single place that rule lives. Availability, orphaning and the
 * HR queue all ask it.
 */

export type EffectiveInput = {
  category?: "SICK" | "HOLIDAY" | "PERSONAL" | "OTHER";
  status?: "PENDING" | "APPROVED" | "REJECTED";
};

export function isEffective(absence: EffectiveInput): boolean {
  // Absences without a status are pre-approval records (and test fixtures);
  // treat them as counting, which is what they meant before HR existed.
  if (!absence.status) return true;

  if (absence.status === "REJECTED") return false;
  if (absence.status === "APPROVED") return true;

  // Pending: only sickness takes effect before somebody signs it off.
  return absence.category === "SICK";
}

/** Why an absence is or is not counting, for the UI to explain itself. */
export function effectiveLabel(absence: EffectiveInput): string {
  if (absence.status === "REJECTED") return "Rejected";
  if (absence.status === "APPROVED") return "Approved";
  if (absence.category === "SICK") return "Applied, awaiting HR";
  return "Waiting for HR";
}
