"use client";
import { DashboardPreview } from "./dashboard-preview";
import { AssistantPreview } from "@/components/assistant/assistant-preview";
import { SendingPreview } from "./sending-preview";
import { workspaceClassName } from "@/lib/workspace-styles";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { PreviewTransport, type Transport } from "@/lib/marketing/api";
import { FormsPage } from "@/components/marketing/forms";
import { NewslettersPage } from "@/components/marketing/newsletters";
import { TemplatesPage } from "@/components/marketing/templates";
import { CRMPage } from "@/components/marketing/crm";
import { AutomationsPage } from "@/components/marketing/automations";
import { InboxPage, OutboxPage } from "@/components/marketing/inbox";
import { MailConnections } from "@/components/settings/mail-connections";
const stamp = "2026-09-09T08:45:00Z";
const emailHTML =
  '<html><body style="font:15px/1.8 Arial;color:#5d5664;padding:25px"><p>Hi team,</p><p>I’ve gathered our latest product updates and a few ideas for the next edition. The focus is on making the experience feel simpler, more thoughtful, and easier to use.</p><p>Take a look and let me know what you think. I’d love to hear your feedback before we share it with the community.</p><p>Thanks,<br>Ava</p></body></html>';
const formFields = [
  {
    Label: "Email address",
    FieldType: "EMAIL",
    Required: true,
    mapToContactField: "email",
  },
  {
    Label: "First name",
    FieldType: "TEXT",
    Required: false,
    mapToContactField: "first_name",
  },
];
const forms = [
  ["User Feedback", "User experience feedback form", 879, 3420, "PUBLISHED"],
  [
    "Product Survey",
    "Monthly product satisfaction survey",
    245,
    1992,
    "ARCHIVED",
  ],
  [
    "Event Registration",
    "Upcoming webinars registration",
    532,
    1767,
    "ARCHIVED",
  ],
  [
    "Lead Generation",
    "Contact form for potential clients",
    1015,
    4452,
    "PUBLISHED",
  ],
].map((x, i) => ({
  id: `form-${i}`,
  Name: x[0],
  description: x[1],
  SubmissionCount: x[2],
  ViewCount: x[3],
  Status: x[4],
  Slug: `preview-${i}`,
  fields: formFields,
  AddToListID: "audience",
  successMessage: "Thanks for joining us!",
  SubmitButtonText: "Subscribe",
  updatedAt: stamp,
}));
const options = {
  lists: [
    { id: "audience", name: "The Xem community", subscribersCount: 2486 },
  ],
  templates: [
    {
      id: "template",
      name: "The weekly edit",
      subject: "A little inspiration for your week",
      htmlBody: emailHTML,
    },
  ],
  senders: [
    {
      id: "sender",
      name: "Xem",
      fromEmail: "hello@example.com",
      supportsTLS: true,
    },
  ],
  starters: [
    {
      key: "editorial",
      name: "The weekly edit",
      description: "A considered collection of stories, ideas and links.",
      subject: "Your weekly dose of inspiration",
      color: "#7a61c7",
      htmlBody: emailHTML,
    },
    {
      key: "product",
      name: "Product notes",
      description: "Keep your community close to what you are building.",
      subject: "A little update. A big difference.",
      color: "#408d87",
      htmlBody: emailHTML,
    },
    {
      key: "digest",
      name: "Community digest",
      description: "Member stories, upcoming events and everything in between.",
      subject: "Good things are happening here",
      color: "#b9825b",
      htmlBody: emailHTML,
    },
    {
      key: "launch",
      name: "Something new",
      description: "Make your next announcement one worth opening.",
      subject: "Meet your new favorite thing",
      color: "#4f5363",
      htmlBody: emailHTML,
    },
  ],
};
const contacts = [
  ["Ava", "Thompson", "Studio North", "QUALIFIED"],
  ["Ethan", "Carter", "BrightCo", "CUSTOMER"],
  ["Sophia", "Lee", "Luma Design", "LEAD"],
  ["Oliver", "James", "Nissan", "QUALIFIED"],
  ["Helena", "Ross", "Acme", "LEAD"],
  ["Liam", "Wilson", "Linear", "CUSTOMER"],
].map((a, i) => ({
  id: `contact-${i}`,
  firstName: a[0],
  lastName: a[1],
  company: a[2],
  lifecycleStage: a[3],
  email: `${a[0].toLowerCase()}@example.com`,
  status: "ACTIVE",
  listId: "audience",
  phone: "",
  createdAt: stamp,
}));
const newsletters = [
  {
    id: "newsletter",
    name: "The Sunday Edit",
    description: "Ideas for a slower Sunday.",
    subject: "Good things, delivered weekly",
    templateId: "template",
    listId: "audience",
    smtpConfigId: "sender",
    status: "SCHEDULED",
    cadence: "WEEKLY",
    timezone: "Asia/Kolkata",
    nextSendAt: "2026-09-13T04:30:00Z",
    editions: 12,
    postalAddress: "Xem, 42 Market Street, Bengaluru, India",
  },
  {
    id: "draft",
    name: "Behind the build",
    subject: "A little update. A big difference.",
    templateId: "template",
    listId: "audience",
    smtpConfigId: "sender",
    status: "DRAFT",
    cadence: "MONTHLY",
    timezone: "Asia/Kolkata",
    nextSendAt: null,
    editions: 0,
  },
];
const previewMailBody = `<p>Hi Alex,</p><p>Hope you had a smooth start to the week.</p><p>I’ve attached the revised campaign plan for review. The team moved more budget into community partnerships, reduced the broad awareness spend, and kept a small reserve for launch week.</p><p>Could you review the channel split and share your recommendation before Thursday’s planning session?</p><p>Thanks,<br>Ava</p>`;
const featuredMail = contacts.map((c, i) => ({
  id: `preview-mailbox:INBOX:1:${i + 1}`,
  uid: 48 - i,
  uidValidity: 1,
  messageId: `<message-${i}@example.com>`,
  subject: [
    "Campaign plan review: community partnerships, launch reserve, and the Thursday decision",
    "A few ideas for Sunday’s edition",
    "Your next chapter starts here",
    "Let’s talk about the launch",
    "Community notes · September",
    "Something worth sharing",
  ][i],
  from:
    i === 0
      ? "Ava Thompson, Community Partnerships and Editorial <ava.thompson.partnerships@example.com>"
      : `${c.firstName} ${c.lastName} <${c.email}>`,
  to: "Alex <alex@example.com>",
  cc:
    i === 0
      ? "Priya Shah <priya@example.com>, Rowan Lee <rowan@example.com>"
      : "",
  body: i === 0 ? previewMailBody : emailHTML,
  date: stamp,
  flags: i === 0 ? ["\\Flagged"] : i > 2 ? ["\\Seen"] : [],
  attachments:
    i === 0
      ? [
          { Filename: "campaign-plan.pdf", Data: "UHJldmlldyBmaXh0dXJl" },
          { Filename: "channel-budget.xlsx", Data: "UHJldmlldyBmaXh0dXJl" },
        ]
      : [],
}));
const mail = [
  ...featuredMail,
  ...Array.from({ length: 42 }, (_, index) => ({
    ...featuredMail[(index + 1) % featuredMail.length],
    id: `preview-mailbox:INBOX:1:${42 - index}`,
    uid: 42 - index,
    messageId: `<archive-${42 - index}@example.com>`,
    subject:
      [
        "Notes from customer research",
        "Re: October editorial calendar",
        "Invitation: community roundtable",
        "A quick question about the launch",
      ][index % 4] + ` · ${42 - index}`,
    date: new Date(Date.parse(stamp) - (index + 1) * 36e5).toISOString(),
    flags: ["\\Seen"],
    attachments: [],
  })),
];
let previewIncoming: (typeof mail)[number][] = [];
type InboxScenario =
  | "loaded"
  | "empty"
  | "loading"
  | "error"
  | "summary-disabled"
  | "summary-retry";
const createTransport = (scenario: InboxScenario): Transport => {
  let summaryAttempts = 0;
  return async <T,>(path: string, method = "GET", body?: unknown) => {
    if (path === "assistant/mail-summary" && method === "POST") {
      summaryAttempts += 1;
      if (scenario === "summary-retry" && summaryAttempts === 1)
        throw new Error("The AI provider is temporarily unavailable.");
      return {
        summary:
          "Ava shared a revised campaign plan and wants approval of the channel split before Thursday’s planning session.",
        keyPoints: [
          "More budget moved to community partnerships.",
          "Broad awareness spend was reduced.",
          "A launch-week reserve remains available.",
        ],
        actionItems: [
          "Review the channel split.",
          "Send a recommendation before Thursday.",
        ],
        truncated: false,
      } as T;
    }
    if (method !== "GET")
      throw new Error(
        "Visual preview only. Changes and email sending are available in your authenticated workspace.",
      );
    if (path === "mail-connections/mailboxes")
      return [
        {
          id: `preview-mailbox-${scenario}`,
          username: "alex@example.com",
          host: "imap.gmail.com",
          provider: "GOOGLE_OAUTH",
          smtpConfigId: "preview-sender",
        },
        {
          id: `preview-icloud-${scenario}`,
          username: "alex@icloud.com",
          host: "imap.mail.me.com",
          provider: "CUSTOM",
        },
        {
          id: `preview-imap-${scenario}`,
          username: "team@example.org",
          host: "mail.example.org",
          provider: "CUSTOM",
        },
      ] as T;
    if (path === "assistant/mail-summary")
      return { enabled: scenario !== "summary-disabled" } as T;
    if (path.startsWith("imap/head")) {
      const available = [...previewIncoming, ...mail];
      return {
        total_emails: available.length,
        uidValidity: 1,
        latest_uid: Math.max(0, ...available.map((item) => item.uid)),
      } as T;
    }
    if (path === "mail-connections/senders")
      return [
        {
          id: "preview-sender",
          fromEmail: "alex@example.com",
          provider: "GOOGLE_OAUTH",
          isDefault: true,
        },
        {
          id: "preview-cloudflare",
          fromEmail: "notifications@example.com",
          provider: "CLOUDFLARE",
          isDefault: false,
        },
      ] as T;
    if (path === "mail-connections")
      return {
        googleConfigured: true,
        googleAvailable: true,
        connections: [
          {
            id: "preview-google",
            provider: "GOOGLE_OAUTH",
            address: "alex@example.com",
            smtpConfigId: "preview-sender",
            imapConfigId: "preview-mailbox",
          },
        ],
      } as T;
    if (path.startsWith("imap/folders"))
      return [
        { Name: "INBOX", Total: 6 },
        { Name: "Sent", Total: 24 },
        { Name: "Drafts", Total: 2 },
        { Name: "Archive", Total: 18 },
      ] as T;
    if (path.startsWith("marketing/contacts?")) {
      const params = new URLSearchParams(path.split("?")[1]);
      const search = (params.get("search") || "").toLowerCase();
      const stage = params.get("stage");
      const limit = Number(params.get("limit")) || 10;
      const filtered = contacts.filter(
        (c) =>
          (!stage || (c.lifecycleStage || "LEAD") === stage) &&
          [c.firstName, c.lastName, c.email, c.company]
            .join(" ")
            .toLowerCase()
            .includes(search),
      );
      const page = Math.min(
        Number(params.get("page")) || 1,
        Math.max(1, Math.ceil(filtered.length / limit)),
      );
      return {
        data: filtered.slice((page - 1) * limit, page * limit).map((c) => ({
          ...c,
          listName: options.lists.find((l) => l.id === c.listId)?.name || "",
        })),
        total: filtered.length,
        page,
        limit,
        summary: {
          total: contacts.length,
          qualified: contacts.filter((c) => c.lifecycleStage === "QUALIFIED")
            .length,
          customers: contacts.filter((c) => c.lifecycleStage === "CUSTOMER")
            .length,
          subscribed: contacts.filter((c) => c.status === "ACTIVE").length,
        },
      } as T;
    }
    const result =
      path === "marketing/options"
        ? options
        : path === "marketing/forms"
          ? forms
          : path === "marketing/newsletters"
            ? newsletters
            : path.startsWith("contacts?")
              ? { data: contacts }
              : path === "automations"
                ? []
                : path.startsWith("emails?")
                  ? {
                      data: mail.map((m, i) => ({
                        ...m,
                        id: `preview-${i}`,
                        createdAt: m.date,
                        status: "SENT",
                        body: btoa(unescape(encodeURIComponent(m.body))),
                      })),
                      total: mail.length,
                      page: 1,
                    }
                  : path.startsWith("imap/emails")
                    ? scenario === "loading"
                      ? await new Promise<T>(() => {})
                      : scenario === "error"
                        ? (() => {
                            throw new Error(
                              "The preview mailbox could not be reached.",
                            );
                          })()
                        : scenario === "empty"
                          ? {
                              emails: [],
                              total_emails: 0,
                              offset: 0,
                              limit: 20,
                              uidValidity: 1,
                            }
                          : (() => {
                              const params = new URLSearchParams(
                                path.split("?")[1],
                              );
                              const before =
                                Number(params.get("before_uid")) ||
                                Number.MAX_SAFE_INTEGER;
                              const available = [...previewIncoming, ...mail]
                                .filter((item) => item.uid < before)
                                .sort((a, b) => b.uid - a.uid);
                              const emails = available.slice(0, 20);
                              return {
                                emails,
                                total_emails:
                                  previewIncoming.length + mail.length,
                                offset: 0,
                                limit: 20,
                                uidValidity: 1,
                                next_before_uid:
                                  available.length > 20
                                    ? emails.at(-1)?.uid
                                    : undefined,
                              };
                            })()
                    : [];
    return result as T;
  };
};
export function WorkspacePreview() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState("/dashboard");
  const [inboxScenario, setInboxScenario] = useState<InboxScenario>("loaded");
  const transport = useMemo(
    () => createTransport(inboxScenario),
    [inboxScenario],
  );
  return (
    <PreviewTransport.Provider key={inboxScenario} value={transport}>
      <div
        className={workspaceClassName(
          "preview-banner !h-[26px] whitespace-nowrap overflow-x-auto !text-[9px] flex items-center justify-start gap-2 !px-2 sm:justify-center sm:gap-3",
        )}
      >
        <span className="hidden sm:inline">
          LOCAL PREVIEW · Sample data · Sending disabled
        </span>
        <span className="sm:hidden">Preview</span>
        {page === "/inbox" && (
          <>
            <label className="flex items-center gap-1.5">
              <span className="hidden sm:inline">Inbox state</span>
              <select
                className="h-5 rounded border border-border bg-card px-1"
                value={inboxScenario}
                onChange={(event) => {
                  queryClient.removeQueries({ queryKey: ["marketing"] });
                  setInboxScenario(event.target.value as InboxScenario);
                }}
              >
                <option value="loaded">Loaded</option>
                <option value="empty">Empty</option>
                <option value="loading">Loading</option>
                <option value="error">Error</option>
                <option value="summary-disabled">Summary disabled</option>
                <option value="summary-retry">Summary retry</option>
              </select>
            </label>
            <button
              aria-label="Receive sample email"
              className="underline"
              onClick={() => {
                if (!previewIncoming.length)
                  previewIncoming = [
                    {
                      ...featuredMail[0],
                      id: "preview-mailbox:INBOX:1:49",
                      uid: 49,
                      messageId: "<incoming-49@example.com>",
                      subject: "New: launch approval needed today",
                      date: new Date().toISOString(),
                      flags: [],
                    },
                  ];
              }}
            >
              <span className="hidden sm:inline">Receive sample email</span>
              <span className="sm:hidden">Sample mail</span>
            </button>
          </>
        )}
      </div>
      <div
        className="[&_.product-frame]:!h-[calc(100dvh-26px)]"
        onClickCapture={(event) => {
          const anchor = (event.target as HTMLElement).closest("a");
          const href = anchor?.getAttribute("href");
          if (href === "/onboarding" || href === "/settings/sending") {
            event.preventDefault();
            event.stopPropagation();
            setPage(href);
          }
        }}
      >
        <AppShell previewPage={page} onPreviewNavigate={setPage}>
          {page === "/dashboard" || page.startsWith("/analytics") ? (
            <DashboardPreview onNavigate={setPage} />
          ) : page === "/" ? (
            <AssistantPreview />
          ) : page === "/onboarding" ? (
            <SendingPreview />
          ) : page === "/settings/sending" ? (
            <SendingPreview dashboard />
          ) : page === "/developer/logs/emails" ? (
            <OutboxPage />
          ) : page === "/newsletters" ? (
            <NewslettersPage />
          ) : page === "/templates" ? (
            <TemplatesPage />
          ) : page === "/crm" ? (
            <CRMPage />
          ) : page === "/automations" ? (
            <AutomationsPage />
          ) : page === "/inbox" ? (
            <InboxPage />
          ) : page === "/settings/imap" || page === "/settings/smtp" ? (
            <div className="p-6">
              <MailConnections
                provider={page === "/settings/imap" ? "google" : "cloudflare"}
              />
            </div>
          ) : page === "/forms" ? (
            <FormsPage />
          ) : (
            <div className="m-6 rounded-xl border bg-card p-8">
              <h2 className="text-xl font-semibold">Open your workspace</h2>
              <p className="mt-2 text-muted-foreground">
                This page uses your account data and is available in the
                authenticated workspace.
              </p>
              <a
                className="mt-5 inline-flex text-primary underline"
                href={page}
              >
                Open {page}
              </a>
            </div>
          )}
        </AppShell>
      </div>
    </PreviewTransport.Provider>
  );
}
