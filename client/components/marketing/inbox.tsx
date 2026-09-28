"use client";
import { workspaceClassName } from "@/lib/workspace-styles";
import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Mail,
  Inbox,
  Send,
  Search,
  PencilLine,
  Reply,
  ArrowLeft,
  ArrowRight,
  Paperclip,
  RefreshCw,
  X,
  ChevronDown,
  Pin,
  Archive,
  FileText,
  Star,
  MailCheck,
} from "lucide-react";
import { useMarketing, useMarketingQuery } from "@/lib/marketing/api";
import { IMAPEmail, IMAPEmailResponse } from "@/types/imap";
import { Button } from "@/components/ui/button";
import { QueryState, Empty } from "./shared";
import { MailCompose } from "./mail-compose";
import {
  ComposeValue,
  OutgoingAttachment,
  replySubject,
} from "@/lib/connected-mail";
import { toast } from "sonner";
function sender(value: string) {
  return (
    value
      ?.replace(/<[^>]*>/g, "")
      .replaceAll('"', "")
      .trim() ||
    value ||
    "Unknown sender"
  );
}
function text(body: string) {
  return (
    body
      ?.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 120) || ""
  );
}
type MailMessage = IMAPEmail & { status?: string; error?: string };
type Mailbox = {
  id: string;
  username: string;
  host: string;
  smtpConfigId?: string;
};
const messageKey = (m: MailMessage) => m.id || m.messageId;
export function InboxPage() {
  return <MailboxPage mode="inbox" />;
}
export function OutboxPage() {
  return <MailboxPage mode="outbox" />;
}
function MailboxPage({ mode }: { mode: "inbox" | "outbox" }) {
  const outbox = mode === "outbox";
  const title = outbox ? "Outbox" : "Inbox";
  const { request, scope, ready } = useMarketing();
  const mailboxes = useMarketingQuery<Mailbox[]>(
    "mail-connections/mailboxes",
    !outbox,
  );
  const [chosenMailbox, setChosenMailbox] = useState("");
  const mailbox =
    mailboxes.data?.find((m) => m.id === chosenMailbox) ?? mailboxes.data?.[0];
  const configId = mailbox?.id ?? "";
  const folders = useMarketingQuery<
    { Name: string; Total?: number; Attributes?: string[] }[]
  >(
    `imap/folders?${new URLSearchParams({ config_id: configId })}`,
    !outbox && !!configId,
  );
  const [folder, setFolder] = useState(outbox ? "SENT" : "INBOX");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [compose, setCompose] = useState<ComposeValue | null>(null);
  const [flagBusy, setFlagBusy] = useState(false);
  useEffect(() => {
    setCompose(null);
  }, [scope]);
  useEffect(() => {
    setSelected(null);
    setImages(false);
  }, [scope, configId, folder, query]);
  const [images, setImages] = useState(false);
  const emails = useInfiniteQuery({
    queryKey: ["marketing", scope, mode, configId, folder, query],
    enabled: ready && (outbox || !!configId),
    initialPageParam: outbox ? 1 : 0,
    queryFn: async ({ pageParam }): Promise<IMAPEmailResponse> => {
      if (!outbox)
        return request<IMAPEmailResponse>(
          `imap/emails?${new URLSearchParams({ folder, offset: String(pageParam), limit: "20", q: query, config_id: configId })}`,
        );
      const result = await request<{
        data: (Omit<MailMessage, "attachments"> & {
          id: string;
          createdAt: string;
          sentAt?: string;
          attachments?: Omit<OutgoingAttachment, "size">[];
        })[];
        total: number;
        page: number;
      }>(
        `emails?${new URLSearchParams({ page: String(pageParam), sort: "created_at", order: "desc", status: folder, limit: "20" })}`,
      );
      return {
        emails: (result.data || []).map((email) => {
          let body = "";
          try {
            body = new TextDecoder().decode(
              Uint8Array.from(atob(email.body || ""), (c) => c.charCodeAt(0)),
            );
          } catch {
            body = email.body || "";
          }
          return {
            ...email,
            body,
            messageId: email.id,
            date:
              email.sentAt && !email.sentAt.startsWith("0001")
                ? email.sentAt
                : email.createdAt,
            flags: [],
            attachments: (email.attachments ?? []).map((file) => ({
              Filename: file.filename,
              Data: file.content,
            })),
          };
        }),
        total_emails: result.total,
        offset: (result.page - 1) * 20,
        limit: 20,
      };
    },
    getNextPageParam: (last, pages) =>
      last.emails.length > 0 && last.offset + last.limit < last.total_emails
        ? outbox
          ? pages.length + 1
          : last.offset + last.limit
        : undefined,
    retry: 1,
  });
  const allRows: MailMessage[] =
    emails.data?.pages.flatMap((p) => p.emails) || [];
  const rows =
    outbox && query
      ? allRows.filter((m) =>
          `${m.to} ${m.subject} ${text(m.body)}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
      : allRows;
  const total = emails.data?.pages[0]?.total_emails || 0;
  const index = rows.findIndex(
    (e) => messageKey(e) === (selected ? messageKey(selected) : undefined),
  );
  const current = selected;
  const choose = (m: MailMessage) => {
    setSelected(m);
    setImages(false);
  };
  async function changeFlag(flag: string) {
    if (!current?.uid || !current.uidValidity || flagBusy) return;
    const message = current;
    const enabled = !message.flags?.includes(flag);
    setFlagBusy(true);
    try {
      await request(
        `imap/flags?${new URLSearchParams({ config_id: configId })}`,
        "PATCH",
        {
          folder,
          uid: message.uid,
          uidValidity: message.uidValidity,
          flag,
          enabled,
        },
      );
      const flags = enabled
        ? [...(message.flags ?? []), flag]
        : (message.flags ?? []).filter((f) => f !== flag);
      setSelected((previous) =>
        previous && messageKey(previous) === messageKey(message)
          ? { ...previous, flags }
          : previous,
      );
      await emails.refetch();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setFlagBusy(false);
    }
  }
  function reply(message: MailMessage): ComposeValue {
    const address = outbox ? message.to : message.reply_to || message.from;
    const rawId = message.messageId;
    return {
      to: address.match(/<([^>]+)>/)?.[1] || address,
      subject: replySubject(message.subject),
      smtpConfigId: mailbox?.smtpConfigId,
      ...(!outbox && rawId
        ? { inReplyTo: rawId.startsWith("<") ? rawId : `<${rawId}>` }
        : {}),
    };
  }
  return (
    <div
      className={workspaceClassName(
        `mail-workspace ${current ? "mail-open" : ""}`,
      )}
    >
      <aside className={workspaceClassName("mail-folders")}>
        <div className={workspaceClassName("mail-workspace-title")}>
          <span className={workspaceClassName("mail-account-mark")}>
            <Mail size={17} />
          </span>
          <strong>{outbox ? "Outgoing mail" : "Team mailbox"}</strong>
          <small>
            {outbox
              ? "Delivery and message history."
              : "Your conversations, together."}
          </small>
        </div>
        <Button
          className={workspaceClassName("compose-button")}
          onClick={() =>
            setCompose({
              to: "",
              subject: "",
              smtpConfigId: mailbox?.smtpConfigId,
            })
          }
        >
          <PencilLine />
          Compose
        </Button>
        {!outbox && (
          <div className="px-4 pb-3">
            <label
              htmlFor="mailbox-choice"
              className="text-xs text-muted-foreground"
            >
              Mailbox
            </label>
            <select
              id="mailbox-choice"
              className="mt-1 w-full rounded-md border bg-background p-2 text-xs"
              value={configId}
              onChange={(e) => {
                setChosenMailbox(e.target.value);
                setFolder("INBOX");
                setSelected(null);
              }}
            >
              <option value="" disabled>
                {mailboxes.isLoading
                  ? "Loading mailboxes…"
                  : "Choose a mailbox"}
              </option>
              {mailboxes.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.username} · {m.host}
                </option>
              ))}
            </select>
            {mailboxes.error && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {mailboxes.error.message}
              </p>
            )}
            {!mailboxes.isLoading && !configId && !mailboxes.error && (
              <p className="mt-2 text-xs text-muted-foreground">
                Connect a mailbox in settings to read your mail.
              </p>
            )}
            {folders.error && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {folders.error.message}
              </p>
            )}
          </div>
        )}
        <div className={workspaceClassName("mail-folder-list")}>
          {(outbox
            ? [
                "SENT",
                "ACCEPTED",
                "PARTIAL",
                "PENDING",
                "SENDING",
                "FAILED",
                "DELIVERY_UNKNOWN",
                "SUPPRESSED",
                "BOUNCED",
                "OPENED",
                "CLICKED",
              ].map((Name) => ({ Name, Total: 0 }))
            : folders.data?.filter(
                (f) => !f.Attributes?.includes("\\Noselect"),
              ) || [{ Name: "INBOX", Total: total }]
          ).map((f) => (
            <button
              key={f.Name}
              className={folder === f.Name ? "active" : ""}
              onClick={() => {
                setFolder(f.Name);
                setSelected(null);
              }}
            >
              {f.Name.toLowerCase().includes("sent") ? (
                <Send size={15} />
              ) : f.Name.toLowerCase().includes("draft") ? (
                <FileText size={15} />
              ) : f.Name.toLowerCase().includes("archive") ? (
                <Archive size={15} />
              ) : (
                <Inbox size={15} />
              )}
              <span>
                {f.Name === "INBOX"
                  ? "Inbox"
                  : f.Name === "DELIVERY_UNKNOWN"
                    ? "Needs review"
                    : f.Name.charAt(0) + f.Name.slice(1).toLowerCase()}
              </span>
              <small>{f.Total || ""}</small>
            </button>
          ))}
        </div>
        <div className={workspaceClassName("mail-folder-note")}>
          {outbox ? (
            <>
              Manage your senders in{" "}
              <a href="/settings/smtp">SMTP settings ↗</a>
            </>
          ) : (
            <>
              Connect your mailbox in{" "}
              <a href="/settings/imap">IMAP settings ↗</a>
            </>
          )}
        </div>
      </aside>
      <section className={workspaceClassName("mail-list-pane")}>
        <div className={workspaceClassName("mail-list-heading")}>
          <div>
            <h1>
              {outbox ? "Outbox" : folder === "INBOX" ? "Inbox" : folder}
              <ChevronDown size={16} />
            </h1>
            <p>{total.toLocaleString()} messages</p>
          </div>
          <button
            className={workspaceClassName("icon-button")}
            aria-label={`Refresh ${title.toLowerCase()}`}
            onClick={() => emails.refetch()}
          >
            <RefreshCw />
          </button>
        </div>
        <form
          className={workspaceClassName("mail-search")}
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search);
            setSelected(null);
          }}
        >
          <Search size={17} />
          <input
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder={
              outbox ? "Search loaded messages…" : "Search messages…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>↵</kbd>
        </form>
        <div className={workspaceClassName("mail-list-scroll")}>
          <QueryState
            loading={emails.isLoading}
            error={emails.error}
            retry={() => emails.refetch()}
          />
          {!emails.isLoading && !emails.error && !rows.length && (
            <Empty
              title="A little peace and quiet"
              description={
                outbox
                  ? "No messages in this delivery status. Choose another status or load more messages."
                  : "New messages will appear here. Try another folder or connect a mailbox."
              }
            />
          )}
          {rows.some((e) => e.flags?.includes("\\Flagged")) && (
            <div className={workspaceClassName("mail-group-label")}>
              <Pin size={12} />
              PINNED
            </div>
          )}
          {[...rows]
            .sort(
              (a, b) =>
                Number(b.flags?.includes("\\Flagged")) -
                Number(a.flags?.includes("\\Flagged")),
            )
            .map((m, i) => (
              <button
                key={messageKey(m) || `${m.date}-${i}`}
                className={workspaceClassName(
                  `mail-list-item ${current && messageKey(current) === messageKey(m) ? "selected" : ""}`,
                )}
                onClick={() => choose(m)}
              >
                <span
                  className={workspaceClassName("mail-avatar")}
                  style={{
                    background: [
                      "var(--muted)",
                      "var(--secondary)",
                      "var(--muted)",
                      "var(--secondary)",
                    ][i % 4],
                  }}
                >
                  {sender(outbox ? m.to : m.from)
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
                <div>
                  <div className={workspaceClassName("mail-item-line")}>
                    <strong>{sender(outbox ? m.to : m.from)}</strong>
                    <time>
                      {m.date
                        ? new Date(m.date).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })
                        : ""}
                    </time>
                  </div>
                  <span className={workspaceClassName("mail-subject")}>
                    {m.subject || "(No subject)"}
                  </span>
                  <p>
                    {outbox && m.status ? `${m.status} · ` : ""}
                    {text(m.body)}
                  </p>
                </div>
              </button>
            ))}
          {emails.hasNextPage && (
            <Button
              className="m-4"
              variant="outline"
              disabled={emails.isFetchingNextPage}
              onClick={() => emails.fetchNextPage()}
            >
              {emails.isFetchingNextPage ? "Loading…" : "Load more messages"}
            </Button>
          )}
        </div>
      </section>
      <section className={workspaceClassName("mail-detail-pane")}>
        {current ? (
          <>
            <div className={workspaceClassName("mail-detail-toolbar")}>
              <button
                className={workspaceClassName("icon-button mail-back")}
                aria-label={`Back to ${title.toLowerCase()}`}
                onClick={() => setSelected(null)}
              >
                <ArrowLeft />
              </button>
              <button
                className={workspaceClassName("icon-button")}
                aria-label={outbox ? "Write to recipient" : "Reply"}
                onClick={() => setCompose(reply(current))}
              >
                <Reply />
              </button>
              {!outbox && current.uid && (
                <>
                  <button
                    className={workspaceClassName("icon-button")}
                    disabled={flagBusy}
                    aria-label={
                      current.flags?.includes("\\Seen")
                        ? "Mark unread"
                        : "Mark read"
                    }
                    title={
                      current.flags?.includes("\\Seen")
                        ? "Mark unread"
                        : "Mark read"
                    }
                    onClick={() => void changeFlag("\\Seen")}
                  >
                    <MailCheck />
                  </button>
                  <button
                    className={workspaceClassName("icon-button")}
                    disabled={flagBusy}
                    aria-label={
                      current.flags?.includes("\\Flagged")
                        ? "Unstar message"
                        : "Star message"
                    }
                    aria-pressed={current.flags?.includes("\\Flagged") ?? false}
                    onClick={() => void changeFlag("\\Flagged")}
                  >
                    <Star
                      fill={
                        current.flags?.includes("\\Flagged")
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                </>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {index + 1} of {total}
              </span>
              <button
                className={workspaceClassName("icon-button")}
                aria-label="Previous message"
                disabled={index <= 0}
                onClick={() => choose(rows[index - 1])}
              >
                <ArrowLeft />
              </button>
              <button
                className={workspaceClassName("icon-button")}
                aria-label="Next message"
                disabled={index >= rows.length - 1}
                onClick={() => choose(rows[index + 1])}
              >
                <ArrowRight />
              </button>
              <button
                className={workspaceClassName("icon-button")}
                aria-label="Close message"
                onClick={() => setSelected(null)}
              >
                <X />
              </button>
            </div>
            <div className={workspaceClassName("mail-subject-heading")}>
              <p>
                {new Date(current.date).toLocaleString(undefined, {
                  dateStyle: "long",
                  timeStyle: "short",
                })}
              </p>
              <h2>{current.subject}</h2>
              {outbox && (
                <p>
                  Delivery: {current.status?.replaceAll("_", " ")} · Message ID:{" "}
                  {current.messageId}
                </p>
              )}
              {outbox && current.error && <p role="alert">{current.error}</p>}
            </div>
            <div className={workspaceClassName("mail-message")}>
              <div className={workspaceClassName("mail-sender")}>
                <span className={workspaceClassName("mail-avatar")}>
                  {sender(current.from).slice(0, 1)}
                </span>
                <div>
                  <strong>{sender(current.from)}</strong>
                  <p>
                    {(outbox ? current.to : current.from).match(
                      /<([^>]+)>/,
                    )?.[1] || (outbox ? current.to : current.from)}
                  </p>
                </div>
                <time>
                  {new Date(current.date).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p className={workspaceClassName("mail-recipients")}>
                To <span>{current.to}</span>
                {current.cc && (
                  <>
                    {" "}
                    · Cc <span>{current.cc}</span>
                  </>
                )}
              </p>
              <div className={workspaceClassName("remote-images-note")}>
                {images
                  ? "Remote images enabled for this message."
                  : "Remote images are hidden to protect your privacy."}{" "}
                {!images && (
                  <button onClick={() => setImages(true)}>Load images</button>
                )}
              </div>
              <iframe
                className={workspaceClassName("mail-body")}
                title="Email content"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${images ? "https:" : ""} data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.8 Arial;color:#66606c;overflow-wrap:anywhere;margin:0;padding:5px}img{max-width:100%}</style>${current.body}`}
              />
              {current.attachments?.length > 0 && (
                <div className={workspaceClassName("mail-attachments")}>
                  {current.attachments.map((a, i) => (
                    <a
                      key={i}
                      download={a.Filename}
                      href={`data:application/octet-stream;base64,${a.Data}`}
                    >
                      <Paperclip size={14} />
                      {a.Filename}
                    </a>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                className="mt-5"
                onClick={() => setCompose(reply(current))}
              >
                <Reply />
                {outbox ? "Write to recipient" : "Reply to conversation"}
              </Button>
            </div>
          </>
        ) : (
          <div className={workspaceClassName("mail-empty")}>
            <Mail size={35} strokeWidth={1} />
            <h2>
              {outbox ? "Your outgoing messages" : "A space for conversation"}
            </h2>
            <p>Select a message to read it here.</p>
          </div>
        )}
      </section>
      {compose && (
        <MailCompose
          key={scope}
          value={compose}
          close={() => setCompose(null)}
        />
      )}
    </div>
  );
}
