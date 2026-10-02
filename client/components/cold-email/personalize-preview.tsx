"use client";

import { findUnresolved, personalize, plainToHtml, type PersonalizeContact } from "@/lib/personalize";

export interface PersonalizePreviewProps {
  subject: string;
  previewText: string;
  body: string;
  htmlMode: boolean;
  contact: PersonalizeContact | undefined;
  unresolved: ReturnType<typeof findUnresolved>;
}

/**
 * Renders the editor state against a sample contact in real time.
 *
 * Plain-text bodies are wrapped in a tasteful paragraph layout; HTML bodies
 * render verbatim so authors see exactly what the recipient will see. Unresolved
 * tokens get a yellow background so typos like `{{ frist_name }}` are obvious.
 */
export function PersonalizePreview({
  subject,
  previewText,
  body,
  htmlMode,
  contact,
  unresolved,
}: PersonalizePreviewProps) {
  const subjectResolved = personalize(subject || "", contact, { escape: false });
  const previewResolved = personalize(previewText || "", contact, { escape: false });
  const bodyResolved = personalize(body || "", contact);
  const unresolvedSet = new Set(unresolved.map((u) => u.match));

  const displayBody = htmlMode ? bodyResolved : plainToHtml(bodyResolved);

  return (
    <div className="rounded-xl border border-border bg-white">
      <div className="space-y-1 border-b border-border/70 px-5 py-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Inbox preview</p>
        <p className="truncate text-sm font-medium text-zinc-900" title={subjectResolved}>
          {subjectResolved || <span className="text-zinc-400">Your subject line</span>}
        </p>
        <p className="line-clamp-2 text-xs text-zinc-500" title={previewResolved}>
          {previewResolved || <span className="text-zinc-400">Preview text shows next to the subject in the inbox.</span>}
        </p>
      </div>

      <div className="px-5 py-5">
        {contact ? (
          <p className="mb-3 text-xs text-muted-foreground">
            Showing as{" "}
            <span className="font-medium text-zinc-900">
              {contact.firstName || contact.lastName ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() : contact.email}
            </span>
            {contact.company ? ` from ${contact.company}` : ""}.
          </p>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">
            Pick a list and lead on the right to see this template filled in. Tokens remain as-is until a sample
            contact is chosen.
          </p>
        )}

        <HighlightedPreview
          html={displayBody}
          htmlMode={htmlMode}
          unresolved={unresolvedSet}
        />

        {!htmlMode && unresolved.length > 0 && (
          <p className="mt-4 text-xs text-amber-700">
            Highlighted tokens have no value for this lead.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Renders an HTML string, but post-wraps any unresolved `{{ token }}` markers
 * with a span so authors spot them immediately. No-op when the contact is
 * missing or all tokens are resolved.
 */
function HighlightedPreview({
  html,
  htmlMode,
  unresolved,
}: {
  html: string;
  htmlMode: boolean;
  unresolved: Set<string>;
}) {
  if (htmlMode) {
    // Escape the unresolved markers inside the html body and re-insert with a
    // styled span so they survive HTML rendering.
    const marked = Array.from(unresolved).reduce<string>(
      (acc, token) =>
        acc.split(token).join(`<span class="rounded bg-amber-200 px-1 font-mono text-amber-900">${token}</span>`),
      html,
    );
    return (
      <div
        className="max-w-none whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-900 [&_a]:text-blue-600"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: marked }}
      />
    );
  }

  // Plain-text mode: split by unresolved tokens so we can wrap each match.
  const tokens = Array.from(unresolved);
  if (tokens.length === 0) {
    return (
      <div
        className="max-w-none whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-900"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  const regex = new RegExp(`(${tokens.map(escapeForRegex).join("|")})`, "g");
  const parts = html.split(regex);
  return (
    <div className="max-w-none whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-900">
      {parts.map((part, index) =>
        unresolved.has(part) ? (
          <span
            key={index}
            className="rounded bg-amber-200 px-1 font-mono text-amber-900"
          >
            {part}
          </span>
        ) : (
          <span
            key={index}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: part }}
          />
        ),
      )}
    </div>
  );
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
