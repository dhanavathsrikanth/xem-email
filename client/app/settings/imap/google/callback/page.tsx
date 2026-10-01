"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMarketing } from "@/lib/marketing/api";
import { Button } from "@/components/ui/button";

type CallbackOutcome = {
  status: "success" | "error";
  message: string;
};

let activeAttempt: { id: string; promise: Promise<CallbackOutcome> } | null =
  null;

export default function GoogleMailboxCallback() {
  const { request, ready, refresh } = useMarketing();
  const [status, setStatus] = useState<"pending" | "success" | "error">(
    "pending",
  );
  const [message, setMessage] = useState(
    "Completing your Google mailbox connection…",
  );
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code"),
      state = params.get("state");
    const historyState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    const previousAttempt = historyState.xemGoogleMailboxAttempt;
    let attempt: Promise<CallbackOutcome> | undefined;
    if (code && state && !params.has("error")) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      attempt = request("mail-connections/google/complete", "POST", {
        code,
        state,
      })
        .then(() => {
          void Promise.resolve(refresh()).catch(() => {});
          return {
            status: "success" as const,
            message:
              "Google mailbox connected. You can now choose it in your inbox and composer.",
          };
        })
        .catch((error) => ({
          status: "error" as const,
          message:
            (error as Error).message ||
            "Xem couldn’t complete the Google mailbox connection.",
        }));
      activeAttempt = { id, promise: attempt };
      // Preserve Next's internal history state while removing one-time secrets.
      window.history.replaceState(
        { ...historyState, xemGoogleMailboxAttempt: id },
        "",
        window.location.pathname,
      );
    } else if (
      typeof previousAttempt === "string" &&
      activeAttempt?.id === previousAttempt
    ) {
      attempt = activeAttempt.promise;
    }
    if (!attempt) {
      window.history.replaceState(historyState, "", window.location.pathname);
      setStatus("error");
      setMessage(
        "Google authorization was canceled or incomplete. Return to settings to start again.",
      );
      return;
    }
    let mounted = true;
    void attempt.then((outcome) => {
      if (!mounted) return;
      setStatus(outcome.status);
      setMessage(outcome.message);
    });
    return () => {
      mounted = false;
    };
  }, [ready, request, refresh]);
  return (
    <div className="max-w-xl p-6 space-y-4">
      <h1 className="text-xl font-semibold">Google mailbox</h1>
      <p
        role={status === "error" ? "alert" : "status"}
        className="text-sm text-muted-foreground"
      >
        {message}
      </p>
      <div className="flex flex-wrap gap-2">
        {status === "success" && (
          <Button asChild>
            <Link href="/inbox">Open inbox</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/settings/imap">Back to mailbox settings</Link>
        </Button>
      </div>
    </div>
  );
}
