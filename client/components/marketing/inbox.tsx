"use client";
import { workspaceClassName } from "@/lib/workspace-styles";
import { useEffect, useRef, useState } from "react";
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
import { MailSummary } from "./mail-summary";
import { MailboxSelect } from "./mailbox-select";
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
function hasRemoteImages(body: string) {
  return /<(?:img|source)\b[^>]+(?:src|srcset)\s*=\s*["']\s*https?:|background(?:-image)?\s*:\s*url\(\s*["']?\s*https?:/i.test(
    body,
  );
}
function attachmentSize(data: string) {
  const bytes = Math.max(
    0,
    Math.floor((data.length * 3) / 4) -
      (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0),
  );
  return bytes < 1024
    ? `${bytes} B`
    : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}
type MailMessage = IMAPEmail & { status?: string; error?: string };
type Mailbox = {
  id: string;
  username: string;
  host: string;
  smtpConfigId?: string;
  provider?: string;
};
export const messageKey = (m: MailMessage) =>
  m.id ||
  (m.uid != null && m.uidValidity != null
    ? `uid:${m.uidValidity}:${m.uid}`
    : m.messageId);
export const sortMailMessages = (messages: MailMessage[]) =>
  [...messages].sort(
    (a, b) =>
      Number(b.flags?.includes("\\Flagged")) -
      Number(a.flags?.includes("\\Flagged")),
  );
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
  const [detailState, setDetailState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [compose, setCompose] = useState<ComposeValue | null>(null);
  const [flagBusy, setFlagBusy] = useState(false);
  const [newMailAvailable, setNewMailAvailable] = useState(false);
  const [epochVersion, setEpochVersion] = useState(0);
  const epochRef = useRef<number | undefined>(undefined);
  const pollInFlight = useRef(false);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const loadSentinelRef = useRef<HTMLDivElement>(null);
  const generation = `${scope}:${configId}:${folder}:${query}`;
  const generationRef = useRef(generation);
  const detailRequestRef = useRef(0);
  generationRef.current = generation;
  useEffect(() => {
    setCompose(null);
  }, [scope]);
  useEffect(() => {
    setSelected(null);
    setDetailState("idle");
    detailRequestRef.current += 1;
    setImages(false);
    setFlagBusy(false);
    setNewMailAvailable(false);
    epochRef.current = undefined;
  }, [scope, configId, folder, query]);
  const [images, setImages] = useState(false);
  const emails = useInfiniteQuery({
    queryKey: ["marketing", scope, mode, configId, folder, query, epochVersion],
    enabled: ready && (outbox || !!configId),
    initialPageParam: outbox ? 1 : (undefined as number | undefined),
    queryFn: async ({ pageParam }): Promise<IMAPEmailResponse> => {
      if (!outbox) {
        const queryGeneration = generation;
        const params = new URLSearchParams({
          folder,
          limit: "20",
          q: query,
          config_id: configId,
        });
        if (pageParam) params.set("before_uid", String(pageParam));
        const response = await request<IMAPEmailResponse>(
          `imap/emails?${params}`,
        );
        if (
          generationRef.current === queryGeneration &&
          epochRef.current === undefined
        )
          epochRef.current = response.uidValidity;
        else if (
          generationRef.current === queryGeneration &&
          pageParam &&
          response.uidValidity !== undefined &&
          response.uidValidity !== epochRef.current
        ) {
          epochRef.current = response.uidValidity;
          queueMicrotask(() => {
            if (generationRef.current === queryGeneration) {
              setSelected(null);
              setEpochVersion((value) => value + 1);
            }
          });
          throw new Error(
            "The mailbox changed while loading. Refreshing the message list.",
          );
        }
        return response;
      }
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
      outbox
        ? last.emails.length > 0 && last.offset + last.limit < last.total_emails
          ? pages.length + 1
          : undefined
        : last.next_before_uid,
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

  useEffect(() => {
    if (outbox || !ready || !configId || query || !emails.isSuccess) return;
    let stopped = false;
    const poll = async () => {
      if (
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        stopped ||
        pollInFlight.current
      )
        return;
      pollInFlight.current = true;
      try {
        const head = await request<{
          latest_uid: number;
          uidValidity?: number;
        }>(
          `imap/head?${new URLSearchParams({ folder, q: query, config_id: configId })}`,
        );
        if (stopped) return;
        if (
          epochRef.current !== undefined &&
          head.uidValidity !== undefined &&
          head.uidValidity !== epochRef.current
        ) {
          epochRef.current = head.uidValidity;
          setSelected(null);
          setNewMailAvailable(false);
          setEpochVersion((value) => value + 1);
          return;
        }
        const highest = Math.max(
          0,
          ...allRows.map((message) => message.uid ?? 0),
        );
        setNewMailAvailable(head.latest_uid > highest);
      } catch {
        /* Poll failures stay quiet; the normal inbox query owns visible errors. */
      } finally {
        pollInFlight.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 30_000);
    const resume = () => void poll();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [
    outbox,
    ready,
    configId,
    folder,
    query,
    request,
    allRows,
    emails.isSuccess,
  ]);

  useEffect(() => {
    const sentinel = loadSentinelRef.current;
    const root = listScrollRef.current;
    if (
      typeof IntersectionObserver === "undefined" ||
      !sentinel ||
      !root ||
      !emails.hasNextPage ||
      emails.isFetching ||
      emails.isFetchNextPageError
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void emails.fetchNextPage();
      },
      { root, rootMargin: "160px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    emails.hasNextPage,
    emails.isFetching,
    emails.isFetchNextPageError,
    emails.fetchNextPage,
  ]);
  const total = emails.data?.pages[0]?.total_emails || 0;
  const displayedFolders = outbox
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
        (item) => !item.Attributes?.includes("\\Noselect"),
      ) || [{ Name: "INBOX", Total: total }];
  const displayedRows = sortMailMessages(rows);
  const index = displayedRows.findIndex(
    (e) => messageKey(e) === (selected ? messageKey(selected) : undefined),
  );
  const current = selected;
  useEffect(() => {
    if (
      selected &&
      !emails.isFetching &&
      emails.data &&
      !rows.some((row) => messageKey(row) === messageKey(selected))
    ) {
      setSelected(null);
    }
  }, [emails.data, emails.isFetching, rows, selected]);
  const loadMessageDetail = async (m: MailMessage) => {
    if (
      outbox ||
      mailbox?.provider !== "CLOUDFLARE" ||
      m.uid == null ||
      m.uidValidity == null
    ) {
      setDetailState("ready");
      return;
    }
    const requestID = ++detailRequestRef.current;
    const requestGeneration = generation;
    const key = messageKey(m);
    setDetailState("loading");
    try {
      const detail = await request<MailMessage>(
        `imap/message?${new URLSearchParams({
          config_id: configId,
          folder,
          uid: String(m.uid),
          uid_validity: String(m.uidValidity),
        })}`,
      );
      if (
        detailRequestRef.current !== requestID ||
        generationRef.current !== requestGeneration
      )
        return;
      if (detail.uid !== m.uid || detail.uidValidity !== m.uidValidity) {
        setDetailState("error");
        return;
      }
      setSelected((previous) =>
        previous && messageKey(previous) === key ? detail : previous,
      );
      setDetailState("ready");
    } catch {
      if (
        detailRequestRef.current === requestID &&
        generationRef.current === requestGeneration
      )
        setDetailState("error");
    }
  };
  const choose = (m: MailMessage) => {
    detailRequestRef.current += 1;
    setSelected(m);
    setImages(false);
    void loadMessageDetail(m);
  };
  async function changeFlag(flag: string) {
    if (!current?.uid || !current.uidValidity || flagBusy) return;
    const message = current;
    const requestGeneration = generation;
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
      if (generationRef.current !== requestGeneration) return;
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
      if (generationRef.current === requestGeneration)
        toast.error((error as Error).message);
    } finally {
      if (generationRef.current === requestGeneration) setFlagBusy(false);
    }
  }
  function reply(message: MailMessage): ComposeValue {
    const address = outbox ? message.to : message.reply_to || message.from;
    const rawId = message.messageId;
    return {
      to: address.match(/<([^>]+)>/)?.[1] || address,
      subject: replySubject(message.subject),
      smtpConfigId: mailbox?.smtpConfigId,
      requireExplicitSender: !mailbox?.smtpConfigId,
      ...(!outbox && rawId
        ? { inReplyTo: rawId.startsWith("<") ? rawId : `<${rawId}>` }
        : {}),
    };
  }
  return (
    <div
      className={workspaceClassName(
        `mail-workspace ${current ? "mail-open" : "mail-idle"}`,
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
          <div className="pb-3 pt-3">
            <MailboxSelect
              value={configId}
              mailboxes={mailboxes.data ?? []}
              disabled={mailboxes.isLoading}
              onChange={(value) => {
                setChosenMailbox(value);
                setFolder("INBOX");
                setSelected(null);
              }}
            />
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
          {displayedFolders.map((f) => (
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
      <section
        className={workspaceClassName(
          `mail-list-pane ${current ? "mail-list-collapsed" : ""}`,
        )}
      >
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
        {!outbox && (
          <div className={workspaceClassName("mail-mobile-actions")}>
            <MailboxSelect
              value={configId}
              mailboxes={mailboxes.data ?? []}
              disabled={mailboxes.isLoading}
              onChange={(value) => {
                setChosenMailbox(value);
                setFolder("INBOX");
                setSelected(null);
              }}
            />
          </div>
        )}
        <select
          aria-label="Choose mail folder"
          className={workspaceClassName("mail-mobile-folder")}
          value={folder}
          onChange={(event) => {
            setFolder(event.target.value);
            setSelected(null);
          }}
        >
          {displayedFolders.map((item) => (
            <option key={item.Name} value={item.Name}>
              {item.Name}
            </option>
          ))}
        </select>
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
        <div
          ref={listScrollRef}
          className={workspaceClassName("mail-list-scroll")}
        >
          {newMailAvailable && (
            <button
              className={workspaceClassName("mail-new-banner")}
              onClick={() => {
                setNewMailAvailable(false);
                setSelected(null);
                epochRef.current = undefined;
                setEpochVersion((value) => value + 1);
                listScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              New messages available · Show
            </button>
          )}
          <QueryState
            loading={emails.isLoading}
            error={emails.data ? null : emails.error}
            retry={() => emails.refetch()}
          />
          {emails.isFetchNextPageError && (
            <p role="alert" className="px-3 py-2 text-xs text-muted-foreground">
              Older messages could not be loaded. Use the button below to retry.
            </p>
          )}
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
          {displayedRows.map((m, i) => (
            <button
              key={messageKey(m) || `${m.date}-${i}`}
              className={workspaceClassName(
                `mail-list-item ${!m.flags?.includes("\\Seen") ? "unread" : ""} ${current && messageKey(current) === messageKey(m) ? "selected" : ""}`,
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
            <>
              <div ref={loadSentinelRef} aria-hidden="true" className="h-px" />
              <Button
                className="m-4"
                variant="outline"
                disabled={emails.isFetchingNextPage}
                onClick={() => emails.fetchNextPage()}
              >
                {emails.isFetchingNextPage
                  ? "Loading…"
                  : emails.isFetchNextPageError
                    ? "Retry loading older messages"
                    : "Load more messages"}
              </Button>
            </>
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
                disabled={
                  mailbox?.provider === "CLOUDFLARE" && detailState !== "ready"
                }
                onClick={() => setCompose(reply(current))}
              >
                <Reply />
              </button>
              {!outbox && current.uid && (
                <>
                  <button
                    className={workspaceClassName("icon-button")}
                    disabled={
                      flagBusy ||
                      (mailbox?.provider === "CLOUDFLARE" &&
                        detailState !== "ready")
                    }
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
                    disabled={
                      flagBusy ||
                      (mailbox?.provider === "CLOUDFLARE" &&
                        detailState !== "ready")
                    }
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
                onClick={() => choose(displayedRows[index - 1])}
              >
                <ArrowLeft />
              </button>
              <button
                className={workspaceClassName("icon-button")}
                aria-label="Next message"
                disabled={index >= rows.length - 1}
                onClick={() => choose(displayedRows[index + 1])}
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
              {mailbox?.provider === "CLOUDFLARE" &&
                detailState === "loading" && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading the complete message…
                  </p>
                )}
              {mailbox?.provider === "CLOUDFLARE" &&
                detailState === "error" && (
                  <div role="alert" className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm">
                      Couldn’t load the complete message. Try again before
                      replying or using its AI summary.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void loadMessageDetail(current)}
                    >
                      Retry loading message
                    </Button>
                  </div>
                )}
              {(mailbox?.provider !== "CLOUDFLARE" ||
                detailState === "ready") && (
                <>
                  {!outbox &&
                    current.uid != null &&
                    current.uidValidity != null && (
                      <MailSummary
                        configId={configId}
                        folder={folder}
                        uid={current.uid}
                        uidValidity={current.uidValidity}
                      />
                    )}
                  {hasRemoteImages(current.body) && (
                    <div className={workspaceClassName("remote-images-note")}>
                      {images
                        ? "Remote images enabled for this message."
                        : "Remote images are hidden to protect your privacy."}{" "}
                      {!images && (
                        <button onClick={() => setImages(true)}>
                          Load images
                        </button>
                      )}
                    </div>
                  )}
                  <iframe
                    className={workspaceClassName("mail-body")}
                    title="Email content"
                    sandbox=""
                    referrerPolicy="no-referrer"
                    srcDoc={`<meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${images ? "https:" : ""} data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:light}html,body{background:#fff}body{font:14px/1.8 Arial;color:#3f3b43;overflow-wrap:anywhere;margin:0;padding:16px}img{max-width:100%}</style>${current.body}`}
                  />
                  {current.attachments?.some(
                    (attachment) => typeof attachment.Data === "string",
                  ) && (
                    <section
                      className={workspaceClassName("mail-attachment-section")}
                    >
                      <h3>Attachments ({current.attachments.length})</h3>
                      <div className={workspaceClassName("mail-attachments")}>
                        {current.attachments
                          .filter(
                            (attachment) => typeof attachment.Data === "string",
                          )
                          .map((a, i) => (
                            <a
                              key={i}
                              download={a.Filename}
                              href={`data:application/octet-stream;base64,${a.Data}`}
                            >
                              <Paperclip size={14} />
                              <span>
                                <strong>{a.Filename}</strong>
                                <small>{attachmentSize(a.Data)}</small>
                              </span>
                              <em>Download</em>
                            </a>
                          ))}
                      </div>
                    </section>
                  )}
                  <Button
                    variant="outline"
                    className="mt-5"
                    onClick={() => setCompose(reply(current))}
                  >
                    <Reply />
                    {outbox ? "Write to recipient" : "Reply to conversation"}
                  </Button>
                </>
              )}
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
      {!current && !compose && (
        <Button
          aria-label="Compose message"
          className={workspaceClassName("mail-compose-fab")}
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
      )}
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
