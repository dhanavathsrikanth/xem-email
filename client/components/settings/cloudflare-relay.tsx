"use client";
import { useState } from "react";
import {
  Check,
  Cloud,
  Database,
  KeyRound,
  RotateCw,
  ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirmSheet } from "@/components/ui/confirm-sheet";
import { useMarketing, useMarketingQuery } from "@/lib/marketing/api";
import { toast } from "sonner";

type Relay = {
  id: string;
  mailboxId: string;
  address: string;
  workerUrl: string;
  enabled: boolean;
};

export function CloudflareRelays() {
  const { request, refresh } = useMarketing();
  const result = useMarketingQuery<{ relays: Relay[] }>(
    "mail-connections/cloudflare-relays",
  );
  const [workerUrl, setWorkerUrl] = useState("");
  const [address, setAddress] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="space-y-5">
      <div className="flex gap-3">
        <Cloud className="mt-0.5 size-5 shrink-0" />
        <div>
          <h3 className="font-semibold">Cloudflare mailbox Worker</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Keep incoming mail in your Cloudflare account. Xem reads it through
            your authenticated mailbox Worker.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Workspace members with mailbox access can read this inbox. Connect
            only an address you’re authorized to share with your team.
          </p>
        </div>
      </div>

      <details
        key={
          result.data
            ? result.data.relays.length
              ? "connected"
              : "empty"
            : "loading"
        }
        open={result.data?.relays.length === 0 || undefined}
        className="group rounded-lg border bg-card"
      >
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">
          Setup instructions
        </summary>
        <div className="space-y-3 border-t px-3 py-3">
          <ol className="grid gap-3 text-xs leading-5 text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <li>
              <strong className="mb-1 block text-foreground">
                1. Deploy the Worker
              </strong>
              Deploy the Xem mailbox Worker with its D1 database and R2 bucket
              in your Cloudflare account.
            </li>
            <li>
              <strong className="mb-1 block text-foreground">
                2. Route incoming mail
              </strong>
              Configure the address in Cloudflare Email Routing and route it to
              the mailbox Worker.
            </li>
            <li>
              <strong className="mb-1 block text-foreground">
                3. Create an API secret
              </strong>
              Create a mailbox API secret in the Worker. Keep it private and use
              a public HTTPS Worker URL.
            </li>
            <li>
              <strong className="mb-1 block text-foreground">
                4. Connect in Xem
              </strong>
              Xem verifies the mailbox address and API access before saving the
              connection.
            </li>
          </ol>
          <a
            className="inline-block text-sm font-medium underline underline-offset-4"
            href="https://github.com/mailxem/mail/blob/undefined/devops/cloudflare-mailbox/README.md"
            target="_blank"
            rel="noreferrer"
          >
            Open the deployment guide
          </a>
          <p className="text-xs text-muted-foreground">
            No IMAP server or Cloudflare Email Sending token is needed for
            receiving.
          </p>
        </div>
      </details>

      {result.error && (
        <p role="alert" className="text-sm text-muted-foreground">
          Couldn’t load Cloudflare mailboxes.{" "}
          <button className="underline" onClick={() => result.refetch()}>
            Retry
          </button>
        </p>
      )}
      {result.data?.relays.map((relay) => (
        <WorkerCard key={relay.id} relay={relay} />
      ))}

      <form
        className="grid gap-4 border-t pt-4 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            await request("mail-connections/cloudflare-relays", "POST", {
              workerUrl,
              address,
              secret,
            });
            setWorkerUrl("");
            setAddress("");
            setSecret("");
            await refresh();
            toast.success("Cloudflare mailbox verified and connected");
          } catch (error) {
            toast.error((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="worker-url">Deployed Worker URL</Label>
          <Input
            id="worker-url"
            required
            type="url"
            pattern="https://.*"
            value={workerUrl}
            onChange={(event) => setWorkerUrl(event.target.value)}
            placeholder="https://mailbox.your-account.workers.dev"
            autoComplete="url"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="worker-address">Mailbox address</Label>
          <Input
            id="worker-address"
            required
            type="email"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="support@yourdomain.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="worker-secret">Mailbox API secret</Label>
          <Input
            id="worker-secret"
            required
            type="password"
            minLength={32}
            maxLength={4096}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            Sent once for verification, stored encrypted, and never shown again.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy || result.isLoading}>
            {busy ? "Verifying Worker…" : "Connect Cloudflare mailbox"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function WorkerCard({ relay }: { relay: Relay }) {
  const { request, refresh } = useMarketing();
  const confirm = useConfirmSheet();
  const [secret, setSecret] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const replaceSecret = async () => {
    if (!secret || busy) return;
    setBusy(true);
    try {
      await request(
        `mail-connections/cloudflare-relays/${relay.id}/secret`,
        "POST",
        { secret },
      );
      setSecret("");
      setChanging(false);
      await refresh();
      toast.success(
        relay.enabled
          ? "Mailbox API secret updated"
          : "Cloudflare mailbox enabled",
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    if (
      !(await confirm({
        title: "Disconnect Cloudflare mailbox?",
        description:
          "Xem will stop reading this mailbox. Mail remains in your Cloudflare D1 and R2 storage.",
        confirmLabel: "Disconnect mailbox",
        variant: "destructive",
      }))
    )
      return;
    setBusy(true);
    try {
      await request(`mail-connections/cloudflare-relays/${relay.id}`, "DELETE");
      await refresh();
      toast.success("Cloudflare mailbox disconnected");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <Database className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="break-all text-sm font-medium">{relay.address}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {relay.workerUrl}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Mail is stored in your Cloudflare account · sending is configured
              separately.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px]">
          {relay.enabled ? (
            <>
              <Check className="size-3" /> Connected
            </>
          ) : (
            <>
              <ShieldOff className="size-3" /> Disconnected
            </>
          )}
        </span>
      </div>
      {changing && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <Label htmlFor={`worker-secret-${relay.id}`}>
            New mailbox API secret
          </Label>
          <Input
            id={`worker-secret-${relay.id}`}
            type="password"
            minLength={32}
            maxLength={4096}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            Rotate or create the secret in Cloudflare first, then enter the
            replacement here. Xem verifies it before saving.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || secret.length < 32}
              onClick={() => void replaceSecret()}
            >
              <KeyRound className="size-3.5" /> Verify and save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setChanging(false);
                setSecret("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!changing && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
            <RotateCw className="size-3.5" />{" "}
            {relay.enabled ? "Replace API secret" : "Reconnect"}
          </Button>
          {relay.enabled && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void disable()}
            >
              Disconnect
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
