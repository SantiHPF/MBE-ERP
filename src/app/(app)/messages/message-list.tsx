"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import {
  markRead,
  sendMessage,
  type MessageState,
} from "@/lib/messages/actions";
import type { Correspondent, ThreadMessage } from "@/lib/messages/db";

const initial: MessageState = {};

/**
 * People on the left, the conversation on the right.
 *
 * Deliberately plain. This exists so a handover can carry a sentence of
 * explanation, not so anybody can hold a meeting in it.
 */
export function MessageList({
  people,
  correspondents,
  openWith,
  messages,
}: {
  people: { id: string; displayName: string }[];
  correspondents: Correspondent[];
  openWith: string | null;
  messages: ThreadMessage[];
}) {
  const { t } = useT();
  const router = useRouter();
  const search = useSearchParams();
  const [body, setBody] = useState("");
  const [starting, setStarting] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const [sendState, send, sending] = useActionState(
    async (prev: MessageState, form: FormData) => {
      const result = await sendMessage(prev, form);
      if (result.ok) {
        setBody("");
        router.refresh();
      }
      return result;
    },
    initial,
  );
  const [, read] = useActionState(markRead, initial);

  /**
   * Opening a conversation marks it read. Fired from an effect rather than
   * from the click, so arriving by URL -- which is what the badge does --
   * counts as having read it too.
   */
  const unreadHere = correspondents.find((c) => c.userId === openWith)?.unread ?? 0;
  useEffect(() => {
    if (!openWith || unreadHere === 0) return;
    const form = new FormData();
    form.set("otherId", openWith);
    read(form);
  }, [openWith, unreadHere, read]);

  // The newest message is the one you want to see first.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [openWith, messages.length]);

  const open = (id: string) => {
    const next = new URLSearchParams(search);
    next.set("with", id);
    router.push(`/messages?${next}`);
    setStarting(false);
  };

  // Somebody you have not written to yet does not appear in the list on the
  // left, so starting a conversation is its own small step.
  const known = new Set(correspondents.map((c) => c.userId));
  const strangers = people.filter((p) => !known.has(p.id));
  const openName = people.find((p) => p.id === openWith)?.displayName ?? "";

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      {/* ------------------------------------------------------- people */}
      <aside className="card">
        <header className="card-head">
          <span className="eyebrow">{t("messages.people")}</span>
          {strangers.length > 0 && (
            <button
              type="button"
              onClick={() => setStarting((v) => !v)}
              className="btn btn-sm"
            >
              {starting ? t("common.close") : t("messages.newMessage")}
            </button>
          )}
        </header>

        {starting && (
          <div className="border-b border-line p-2">
            <select
              defaultValue=""
              onChange={(e) => e.target.value && open(e.target.value)}
              className="field"
              aria-label={t("messages.whoTo")}
            >
              <option value="" disabled>
                {t("messages.whoTo")}
              </option>
              {strangers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
        )}

        {correspondents.length === 0 && !starting ? (
          <p className="card-body text-[13px] text-muted">
            {t("messages.noneYet")}
          </p>
        ) : (
          <ul className="flex flex-col">
            {correspondents.map((c) => (
              <li key={c.userId}>
                <button
                  type="button"
                  onClick={() => open(c.userId)}
                  className={`flex w-full flex-col gap-0.5 border-b border-line px-3.5 py-2.5 text-left last:border-0 transition-colors hover:bg-surface-2 ${
                    c.userId === openWith ? "bg-surface-2" : ""
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium">
                      {c.displayName}
                    </span>
                    <span className="flex-1" />
                    {c.unread > 0 && (
                      <span className="num rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-ink">
                        {c.unread}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[12px] text-muted">
                    {c.fromThem ? "" : `${t("messages.you")} `}
                    {c.lastBody}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* --------------------------------------------------- the thread */}
      <section className="card flex min-h-[380px] flex-col">
        {!openWith ? (
          <p className="card-body text-[13px] text-muted">
            {t("messages.pickSomebody")}
          </p>
        ) : (
          <>
            <header className="card-head">
              <span className="text-[14px] font-semibold">{openName}</span>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {messages.length === 0 ? (
                <p className="text-[13px] text-muted">
                  {t("messages.nothingHereYet")}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {messages.map((m) => (
                    <li
                      key={m.id}
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                        m.mine
                          ? "self-end bg-accent text-accent-ink"
                          : "self-start border border-line bg-surface-2"
                      }`}
                    >
                      {/* A message sent with a task says which one, so
                          "this one" is never ambiguous a week later. */}
                      {m.task && (
                        <span
                          className={`mb-0.5 block text-[11px] ${
                            m.mine ? "opacity-75" : "text-muted"
                          }`}
                        >
                          {t("messages.about", m.task.title)}
                        </span>
                      )}
                      {m.body}
                    </li>
                  ))}
                </ul>
              )}
              <div ref={bottom} />
            </div>

            <form action={send} className="border-t border-line p-3">
              <input type="hidden" name="recipientId" value={openWith} />
              <div className="flex items-end gap-2">
                <textarea
                  name="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("messages.placeholder")}
                  className="field min-h-[42px] flex-1 resize-y"
                />
                <button
                  type="submit"
                  disabled={sending || body.trim().length === 0}
                  className="btn btn-primary"
                >
                  {sending ? t("common.saving") : t("messages.send")}
                </button>
              </div>
              {sendState.error && (
                <p role="alert" className="mt-1.5 text-[12px] text-stall">
                  {sendState.error}
                </p>
              )}
            </form>
          </>
        )}
      </section>
    </div>
  );
}
