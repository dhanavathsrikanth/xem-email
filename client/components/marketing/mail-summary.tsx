"use client";
import { useContext, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ListChecks, Sparkles, X } from "lucide-react";
import { workspaceClassName } from "@/lib/workspace-styles";
import { PreviewTransport, useMarketing } from "@/lib/marketing/api";

export type MailSummaryResult = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  truncated: boolean;
};
type Props = {
  configId: string;
  folder: string;
} & (
  | { providerMessageId: string; uid?: never; uidValidity?: never }
  | { providerMessageId?: never; uid: number; uidValidity: number }
);

export function MailSummary({
  configId,
  folder,
  providerMessageId,
  uid,
  uidValidity,
}: Props) {
  const { scope } = useMarketing();
  const preview = useContext(PreviewTransport);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
  const [result, setResult] = useState<MailSummaryResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  async function send<T>(
    method: "GET" | "POST",
    body?: unknown,
    signal?: AbortSignal,
  ) {
    if (preview) return preview<T>("assistant/mail-summary", method, body);
    const response = await fetch("/api/assistant/mail-summary", {
      method,
      credentials: "same-origin",
      signal,
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : "The summary request could not be completed.",
      );
    return data as T;
  }

  useEffect(() => {
    const next = new AbortController();
    setEnabled(null);
    setAvailabilityError("");
    void send<{ enabled: boolean }>("GET", undefined, next.signal)
      .then((value) => {
        if (!next.signal.aborted) setEnabled(value.enabled);
      })
      .catch((cause) => {
        if (!next.signal.aborted)
          setAvailabilityError(
            cause instanceof Error
              ? cause.message
              : "AI summary availability could not be checked.",
          );
      });
    return () => next.abort();
  }, [
    preview,
    scope,
    configId,
    folder,
    providerMessageId,
    uid,
    uidValidity,
    availabilityAttempt,
  ]);

  useEffect(() => {
    controller.current?.abort();
    requestId.current += 1;
    setResult(null);
    setError("");
    setLoading(false);
    return () => controller.current?.abort();
  }, [scope, configId, folder, providerMessageId, uid, uidValidity]);

  const cancel = () => {
    controller.current?.abort();
    requestId.current += 1;
    setLoading(false);
  };
  const summarize = async () => {
    const id = ++requestId.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setLoading(true);
    setError("");
    try {
      const summary = await send<MailSummaryResult>(
        "POST",
        providerMessageId
          ? { configId, folder, providerMessageId }
          : { configId, folder, uid, uidValidity },
        next.signal,
      );
      if (
        !summary ||
        typeof summary.summary !== "string" ||
        !Array.isArray(summary.keyPoints) ||
        !Array.isArray(summary.actionItems) ||
        typeof summary.truncated !== "boolean"
      )
        throw new Error("The AI provider returned an invalid summary.");
      if (requestId.current === id) setResult(summary);
    } catch (cause) {
      if (requestId.current === id && !next.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "The summary could not be created.",
        );
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  };

  if (enabled === null && !availabilityError)
    return (
      <div className={workspaceClassName("mail-summary-note")}>
        Checking AI summary availability…
      </div>
    );
  if (availabilityError)
    return (
      <div className={workspaceClassName("mail-summary-note")} role="alert">
        AI summary availability could not be checked.{" "}
        <button onClick={() => setAvailabilityAttempt((value) => value + 1)}>
          Retry
        </button>
      </div>
    );
  if (!enabled)
    return (
      <div className={workspaceClassName("mail-summary-note")}>
        <Sparkles /> Email summaries are not enabled for this workspace.
      </div>
    );
  if (!result && !loading && !error)
    return (
      <div className={workspaceClassName("mail-summary-prompt")}>
        <div>
          <Sparkles />
          <span>
            <strong>AI email summary</strong>
            <small>
              On request, this message is sent to your configured AI provider.
            </small>
          </span>
        </div>
        <button onClick={() => void summarize()}>Summarize</button>
      </div>
    );
  if (loading)
    return (
      <div
        className={workspaceClassName("mail-summary-prompt")}
        aria-live="polite"
      >
        <div>
          <Sparkles className="animate-pulse" />
          <span>
            <strong>Creating summary…</strong>
            <small>
              The selected message is being processed by your configured AI
              provider.
            </small>
          </span>
        </div>
        <button onClick={cancel}>
          <X /> Cancel
        </button>
      </div>
    );
  if (error)
    return (
      <div
        className={workspaceClassName("mail-summary-prompt mail-summary-error")}
        role="alert"
      >
        <AlertCircle />
        <span>
          <strong>Couldn’t create the summary</strong>
          <small>{error}</small>
        </span>
        <button onClick={() => void summarize()}>Try again</button>
      </div>
    );
  if (!result) return null;
  return (
    <section
      className={workspaceClassName("mail-summary-card")}
      aria-label="AI email summary"
    >
      <header>
        <span>
          <Sparkles /> AI email summary
        </span>
        <button aria-label="Dismiss AI summary" onClick={() => setResult(null)}>
          <X />
        </button>
      </header>
      <p>{result.summary}</p>
      {result.keyPoints.length > 0 && (
        <div>
          <strong>
            <Check /> Key points
          </strong>
          <ul>
            {result.keyPoints.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {result.actionItems.length > 0 && (
        <div>
          <strong>
            <ListChecks /> Action items
          </strong>
          <ul>
            {result.actionItems.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {result.truncated && (
        <small>
          The message was shortened before it was sent to the AI provider.
        </small>
      )}
    </section>
  );
}
