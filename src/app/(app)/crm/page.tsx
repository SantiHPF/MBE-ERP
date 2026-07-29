import { redirect } from "next/navigation";

/** /crm on its own has no meaning; the sources list is the way in. */
export default function CrmIndex() {
  redirect("/crm/sources");
}
