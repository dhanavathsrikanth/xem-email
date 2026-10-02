"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/hooks/use-api";
import { useTeam } from "@/app/providers/team-provider";
import {
  EmailTemplate,
  MailingList,
  SMTPConfig,
} from "@/lib";
import {
  extractUsedTokens,
  findUnresolved,
  personalize,
  plainToHtml,
  resolveField,
  type PersonalizeContact,
} from "@/lib/personalize";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Eye, Loader2, Mail, Save, Send, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MergeTagPicker } from "./merge-tag-picker";
import { PersonalizePreview } from "./personalize-preview";

export interface ColdEmailEditorProps {
  templateId?: string;
}

interface ColdEmailForm {
  name: string;
  subject: string;
  previewText: string;
  body: string;
  htmlMode: boolean;
}

const EMPTY_FORM: ColdEmailForm = {
  name: "",
  subject: "",
  previewText: "",
  body: "",
  htmlMode: false,
};

/**
 * The Cold Email template editor. Single screen, two panes:
 *
 *   - Left  : subject, preview text, body, merge-tag chip tray, action bar
 *   - Right : live preview against a sample lead from one of your lists
 *
 * Saving reuses the existing /api/templates endpoint. Sending creates a draft
 * campaign via /api/campaigns so the existing sending engine materialises
 * per-lead emails with personalization applied at queue time.
 */
export function ColdEmailEditor({ templateId }: ColdEmailEditorProps) {
  const router = useRouter();
  const { apiFetch, session } = useApi();
  const { team } = useTeam();
  const queryClient = useQueryClient();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const isNew = !templateId || templateId === "new";

  const [form, setForm] = useState<ColdEmailForm>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendListId, setSendListId] = useState<string>("");
  const [sendSmtpId, setSendSmtpId] = useState<string>("");
  const [previewContactId, setPreviewContactId] = useState<string>("");

  const updateField = <K extends keyof ColdEmailForm>(key: K, value: ColdEmailForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const listsQuery = useQuery({
    queryKey: ["audience-lists", team?.id],
    enabled: !!team?.id && !!session?.accessToken,
    queryFn: async ({ signal }) => {
      const response = await apiFetch("mailing-lists?limit=100", { signal });
      if (!response.ok) throw new Error("Unable to load your audience lists");
      const payload = await response.json();
      const data = payload.data ?? payload;
      return (Array.isArray(data) ? data : []) as MailingList[];
    },
  });

  const smtpQuery = useQuery({
    queryKey: ["smtp-configs", team?.id],
    enabled: !!team?.id && !!session?.accessToken,
    queryFn: async ({ signal }) => {
      const response = await apiFetch("smtp-configs?limit=100", { signal });
      if (!response.ok) throw new Error("Unable to load your SMTP senders");
      const payload = await response.json();
      const data = payload.data ?? payload;
      return (Array.isArray(data) ? data : []) as SMTPConfig[];
    },
  });

  const contactsQuery = useQuery({
    queryKey: ["audience-contacts", team?.id, sendListId],
    enabled: !!team?.id && !!session?.accessToken && !!sendListId,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(
        `contacts?list_id=${sendListId}&limit=25&include=Tags`,
        { signal },
      );
      if (!response.ok) throw new Error("Unable to load sample contacts");
      const payload = await response.json();
      const data = payload.data?.data ?? payload.data ?? payload;
      return (Array.isArray(data) ? data : []) as PersonalizeContact[];
    },
  });

  const templateQuery = useQuery({
    queryKey: ["cold-email-template", team?.id, templateId],
    enabled: !isNew && !!team?.id && !!session?.accessToken,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(`templates/${templateId}`, { signal });
      if (!response.ok) throw new Error("Unable to load this template");
      const payload = await response.json();
      return payload.data as EmailTemplate;
    },
  });

  // Hydrate form once per template id.
  useEffect(() => {
    if (!templateQuery.data || hydrated) return;
    const t = templateQuery.data;
    setForm({
      name: t.name ?? "",
      subject: t.subject ?? "",
      previewText: "",
      body: t.html ?? t.design?.body ?? "",
      htmlMode: false,
    });
    setHydrated(true);
  }, [templateQuery.data, hydrated]);

  // Default the sample-lead picker to the first contact in the chosen list.
  useEffect(() => {
    if (!contactsQuery.data?.length) {
      setPreviewContactId("");
      return;
    }
    if (!contactsQuery.data.some((c) => c.email === previewContactId)) {
      setPreviewContactId(contactsQuery.data[0]?.email ?? "");
    }
  }, [contactsQuery.data, previewContactId]);

  const sampleContact: PersonalizeContact | undefined = useMemo(() => {
    if (!contactsQuery.data?.length) return undefined;
    return (
      contactsQuery.data.find((c) => c.email === previewContactId) ??
      contactsQuery.data[0]
    );
  }, [contactsQuery.data, previewContactId]);

  const usedTokens = useMemo(() => extractUsedTokens(form.subject + "\n" + form.body), [form.subject, form.body]);
  const unresolved = useMemo(() => findUnresolved(form.subject + "\n" + form.body, sampleContact), [
    form.subject,
    form.body,
    sampleContact,
  ]);

  const insertToken = useCallback(
    (field: string, token: string) => {
      const textarea = bodyRef.current;
      if (!textarea) {
        updateField("body", form.body + token);
        return;
      }
      const start = textarea.selectionStart ?? form.body.length;
      const end = textarea.selectionEnd ?? form.body.length;
      const next = form.body.slice(0, start) + token + form.body.slice(end);
      updateField("body", next);
      requestAnimationFrame(() => {
        textarea.focus();
        const caret = start + token.length;
        textarea.setSelectionRange(caret, caret);
      });
    },
    [form.body],
  );

  const handleSave = async () => {
    if (!team?.id) {
      toast.error("Pick a workspace before saving.");
      return;
    }
    if (form.name.trim().length < 2) {
      toast.error("Give your template a name (2+ characters).");
      return;
    }
    if (form.subject.trim().length === 0) {
      toast.error("Add a subject line before saving.");
      return;
    }
    if (form.body.trim().length === 0) {
      toast.error("Add a body before saving.");
      return;
    }
    setIsSaving(true);
    try {
      const html = form.htmlMode ? form.body : plainToHtml(form.body);
      const payload = {
        teamId: team.id,
        name: form.name.trim(),
        subject: form.subject.trim(),
        previewText: form.previewText.trim() || undefined,
        variables: usedTokens,
        categoryId: await resolveColdEmailCategoryId(apiFetch),
        htmlBody: html,
        designJson: "",
      };
      const endpoint = isNew ? "templates" : `templates/${templateId}`;
      const response = await apiFetch(endpoint, {
        method: isNew ? "POST" : "PUT",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || "Unable to save this template.");
      }
      const saved = await response.json();
      const savedId = saved?.data?.id ?? saved?.id ?? templateId;
      void queryClient.invalidateQueries({ queryKey: ["cold-email-templates"] });
      void queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success(isNew ? "Template saved" : "Template updated");
      if (isNew && savedId) router.replace(`/cold-email/${savedId}`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSend = async () => {
    if (!team?.id) return;
    if (!sendListId) {
      toast.error("Pick a list to send to.");
      return;
    }
    if (!sendSmtpId) {
      toast.error("Pick an SMTP sender.");
      return;
    }
    setIsSending(true);
    try {
      const html = form.htmlMode ? form.body : plainToHtml(form.body);
      // Persist first so we have an id to attach to the campaign.
      const saveEndpoint = isNew ? "templates" : `templates/${templateId}`;
      const saveResponse = await apiFetch(saveEndpoint, {
        method: isNew ? "POST" : "PUT",
        body: JSON.stringify({
          teamId: team.id,
          name: form.name.trim() || "Cold email",
          subject: form.subject.trim(),
          previewText: form.previewText.trim() || undefined,
          variables: usedTokens,
          categoryId: await resolveColdEmailCategoryId(apiFetch),
          htmlBody: html,
          designJson: "",
        }),
      });
      if (!saveResponse.ok) throw new Error("Save the template before sending.");
      const savedJson = await saveResponse.json();
      const savedId = savedJson?.data?.id ?? savedJson?.id ?? templateId;
      if (!savedId) throw new Error("The template did not return an id.");

      // Schedule the campaign 60 seconds out — effectively "send immediately" once
      // the worker picks it up. The user can still reschedule from the detail view.
      const launchAt = new Date(Date.now() + 60_000);
      const campaignResponse = await apiFetch("campaigns", {
        method: "POST",
        body: JSON.stringify({
          teamId: team.id,
          name: form.name.trim() || "Cold email",
          templateId: savedId,
          listId: sendListId,
          smtpConfigId: sendSmtpId,
          status: "SCHEDULED",
          schedule: "ONE_TIME",
          scheduledFor: launchAt.toISOString(),
        }),
      });
      if (!campaignResponse.ok) {
        const error = await campaignResponse.json().catch(() => ({}));
        throw new Error(error?.error || "The campaign could not be created.");
      }
      const campaign = await campaignResponse.json();
      const campaignId = campaign?.data?.id ?? campaign?.id;
      toast.success(
        `Launching at ${launchAt.toLocaleTimeString()} — review or pause from the Campaigns page.`,
      );
      if (campaignId) router.push(`/campaigns/${campaignId}`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  const [isSendingTest, setIsSendingTest] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const sendTest = async () => {
    const address = testEmail.trim();
    if (!address || !address.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    setIsSendingTest(true);
    try {
      const html = form.htmlMode ? form.body : plainToHtml(form.body);
      const response = await apiFetch("emails", {
        method: "POST",
        body: JSON.stringify({ to: address, html, subject: form.subject, test: true }),
      });
      if (!response.ok) throw new Error("Test send failed.");
      toast.success(`Test email sent to ${address}`);
      setShowTestDialog(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsSendingTest(false);
    }
  };

  const ready = !isNew ? !templateQuery.isPending && !templateQuery.error : true;
  const lists = listsQuery.data || [];
  const smtps = smtpQuery.data || [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      {/* LEFT — editor */}
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Cold email template</p>
            <Input
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="Template name (e.g. SaaS founder outreach v1)"
              className="mt-1 h-9 w-80 max-w-full border-transparent bg-transparent p-0 text-lg font-medium shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/cold-email">
                <Mail className="h-4 w-4" /> All templates
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowTestDialog(true)}
              disabled={!form.subject.trim() || !form.body.trim()}
            >
              <Send className="h-4 w-4" /> Send test
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !ready}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isNew ? "Save template" : "Save changes"}
            </Button>
          </div>
        </header>

        <div className="space-y-2">
          <Label htmlFor="cold-subject" className="text-xs text-muted-foreground">
            Subject line
          </Label>
          <Input
            id="cold-subject"
            value={form.subject}
            onChange={(e) => updateField("subject", e.target.value)}
            placeholder="Hi {{ first_name }}, quick question about {{ company }}"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cold-preview" className="text-xs text-muted-foreground">
            Preview text <span className="font-normal">(shown in the inbox next to the subject)</span>
          </Label>
          <Input
            id="cold-preview"
            value={form.previewText}
            onChange={(e) => updateField("previewText", e.target.value)}
            placeholder="Saw {{ company }} just shipped {{ industry }}…"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="cold-body" className="text-xs text-muted-foreground">
              Body
            </Label>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Plain text</span>
              <Switch
                checked={form.htmlMode}
                onCheckedChange={(checked) => updateField("htmlMode", checked)}
                aria-label="Toggle HTML editing"
              />
              <span>HTML</span>
            </div>
          </div>
          <Textarea
            id="cold-body"
            ref={bodyRef}
            value={form.body}
            onChange={(e) => updateField("body", e.target.value)}
            placeholder={`Hi {{ first_name }},

Saw that {{ company }} recently ...`}
            rows={form.htmlMode ? 14 : 12}
            className="font-mono text-sm leading-relaxed"
            spellCheck={!form.htmlMode}
          />
        </div>

        <MergeTagPicker
          used={usedTokens}
          customFields={discoverCustomFields(contactsQuery.data)}
          onInsert={insertToken}
        />

        <div className="grid gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Send to list</Label>
            <Select value={sendListId} onValueChange={setSendListId}>
              <SelectTrigger>
                <SelectValue placeholder={listsQuery.isPending ? "Loading lists…" : "Pick a list"} />
              </SelectTrigger>
              <SelectContent>
                {lists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From (SMTP)</Label>
            <Select value={sendSmtpId} onValueChange={setSendSmtpId}>
              <SelectTrigger>
                <SelectValue placeholder={smtpQuery.isPending ? "Loading senders…" : "Pick a sender"} />
              </SelectTrigger>
              <SelectContent>
                {smtps.map((smtp) => (
                  <SelectItem key={smtp.id} value={smtp.id}>
                    {smtp.from}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end justify-end">
            <Button
              onClick={handleSend}
              disabled={isSending || !ready || !sendListId || !sendSmtpId}
              className="gap-2"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Launch campaign
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* RIGHT — live preview */}
      <aside className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Live preview</h2>
          </div>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <Select value={previewContactId} onValueChange={setPreviewContactId} disabled={!contactsQuery.data?.length}>
              <SelectTrigger className="h-8 w-56">
                <SelectValue placeholder={sendListId ? "Pick a lead" : "Pick a list first"} />
              </SelectTrigger>
              <SelectContent>
                {(contactsQuery.data || []).map((contact) => (
                  <SelectItem key={contact.email ?? ""} value={contact.email ?? ""}>
                    {labelForContact(contact)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        <PersonalizePreview
          subject={form.subject}
          previewText={form.previewText}
          body={form.body}
          htmlMode={form.htmlMode}
          contact={sampleContact}
          unresolved={unresolved}
        />

        {!!unresolved.length && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <strong>{unresolved.length}</strong> unresolved token{unresolved.length === 1 ? "" : "s"} for this lead:{" "}
            {Array.from(new Set(unresolved.map((u) => u.key)))
              .slice(0, 8)
              .map((key) => (
                <span
                  key={key}
                  className="mx-0.5 inline-block rounded bg-amber-100 px-1 font-mono text-[11px]"
                >
                  {`{{ ${key} }}`}
                </span>
              ))}
          </div>
        )}
      </aside>

      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send a test email</DialogTitle>
            <DialogDescription>
              Send this exact template (unfilled — tokens stay as <span className="font-mono">{`{{ name }}`}</span>)
              to your own inbox so you can sanity-check formatting before launching.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="test-email">Your email</Label>
            <Input
              id="test-email"
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowTestDialog(false)}>
              Cancel
            </Button>
            <Button onClick={sendTest} disabled={isSendingTest}>
              {isSendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Look up (or create) a category called "Cold email" so cold-email templates
 * stay grouped in the existing Templates UI without forcing the user to pick
 * one. Falls back to the first available category if creation fails.
 */
async function resolveColdEmailCategoryId(apiFetch: ReturnType<typeof useApi>["apiFetch"]): Promise<string> {
  try {
    const response = await apiFetch("categories", { signal: undefined });
    if (!response.ok) throw new Error("categories request failed");
    const payload = await response.json();
    const list = (payload.data || []) as { id: string; name: string }[];
    const match = list.find((category) => category.name.toLowerCase() === "cold email");
    if (match) return match.id;
    if (list[0]) return list[0].id;
  } catch {
    /* swallow — caller will surface a clearer error */
  }
  return "";
}

function discoverCustomFields(contacts: PersonalizeContact[] | undefined): string[] {
  if (!contacts?.length) return [];
  const set = new Set<string>();
  for (const contact of contacts) {
    if (!contact.metadata) continue;
    for (const key of Object.keys(contact.metadata)) {
      if (key) set.add(key);
    }
  }
  return Array.from(set);
}

function labelForContact(contact: PersonalizeContact): string {
  const name = resolveField("name", contact);
  const email = resolveField("email", contact);
  const company = resolveField("company", contact);
  if (name && company) return `${name} · ${company}`;
  if (name) return name;
  if (email) return email;
  return "(missing email)";
}
