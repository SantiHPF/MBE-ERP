import { requireUser, canManagePeople } from "@/lib/auth/guards";
import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { CrmTabs } from "./crm-tabs";

/**
 * The CRM is department-scoped: HR runs the two that exist, and a second
 * department getting its own would sit behind the same shell.
 */
export default async function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  if (!canManagePeople(user)) redirect("/my-day");
  const { t } = await getT();

  return (
    <div>
      <div className="mb-4">
        <h1 className="page-title">{t("crm.title")}</h1>
      </div>
      <CrmTabs
        sources={t("crm.sources")}
        candidates={t("crm.candidates")}
      />
      {children}
    </div>
  );
}
