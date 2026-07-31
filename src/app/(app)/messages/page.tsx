import { requireUser } from "@/lib/auth/guards";
import { getT } from "@/lib/i18n/server";
import { canWriteTo, inbox, thread } from "@/lib/messages/db";
import { MessageList } from "./message-list";

export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ with?: string }>;
}) {
  const user = await requireUser();
  const { t } = await getT();
  const params = await searchParams;

  const [people, correspondents] = await Promise.all([
    canWriteTo(user),
    inbox(user.id),
  ]);

  /**
   * Whoever was asked for, else whoever spoke last. Opening the page on an
   * empty pane when there is a conversation waiting would be a strange thing
   * to do to somebody who came here because of the badge.
   */
  const openWith =
    params.with && people.some((p) => p.id === params.with)
      ? params.with
      : (correspondents[0]?.userId ?? null);

  const messages = openWith ? await thread(user.id, openWith) : [];

  return (
    <div>
      <h1 className="page-title">{t("messages.title")}</h1>
      <p className="page-sub mb-5">{t("messages.intro")}</p>

      <MessageList
        people={people.map((p) => ({ id: p.id, displayName: p.displayName }))}
        correspondents={correspondents}
        openWith={openWith}
        messages={messages}
      />
    </div>
  );
}
