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
import { useApi } from "@/hooks/use-api";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * One-by-one contact entry. Each row carries the standard merge fields plus
 * any number of custom keys (those become metadata — usable as `{{ foo }}`
 * merge tags in cold-email templates).
 *
 * "Save and add another" persists the current row, clears it, and refocuses the
 * email field so a batch entry session flows without closing the dialog.
 */
export interface AddContactDialogProps {
  listId: string;
  onAdded?: () => void;
}

interface CustomField {
  key: string;
  value: string;
}

interface ContactDraft {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  city: string;
  country: string;
  phone: string;
  linkedin: string;
  custom: CustomField[];
}

const EMPTY_DRAFT: ContactDraft = {
  email: "",
  firstName: "",
  lastName: "",
  company: "",
  title: "",
  city: "",
  country: "",
  phone: "",
  linkedin: "",
  custom: [],
};

export function AddContactDialog({ listId, onAdded }: AddContactDialogProps) {
  const { apiFetch } = useApi();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const addCustomField = () => {
    update("custom", [...draft.custom, { key: "", value: "" }]);
  };

  const updateCustomField = (index: number, patch: Partial<CustomField>) => {
    const next = draft.custom.slice();
    next[index] = { ...next[index], ...patch };
    update("custom", next);
  };

  const removeCustomField = (index: number) => {
    update(
      "custom",
      draft.custom.filter((_, idx) => idx !== index),
    );
  };

  const buildMetadata = () => {
    const meta: Record<string, string> = {};
    for (const { key, value } of draft.custom) {
      const cleanKey = key.trim().toLowerCase().replace(/\s+/g, "_");
      if (!cleanKey || !value.trim()) continue;
      meta[cleanKey] = value.trim();
    }
    return meta;
  };

  const resetAndClose = () => {
    setDraft(EMPTY_DRAFT);
    setOpen(false);
  };

  const persist = async (keepOpen: boolean) => {
    const email = draft.email.trim();
    if (!email) {
      toast.error("Email is required.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        email,
        firstName: draft.firstName.trim() || undefined,
        lastName: draft.lastName.trim() || undefined,
        company: draft.company.trim() || undefined,
        title: draft.title.trim() || undefined,
        city: draft.city.trim() || undefined,
        country: draft.country.trim() || undefined,
        phone: draft.phone.trim() || undefined,
        linkedin: draft.linkedin.trim() || undefined,
        listId,
        status: "ACTIVE",
        metadata: buildMetadata(),
      };
      // Drop undefined keys so the backend validator doesn't reject empty optionals.
      for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) delete payload[key];
      }

      const response = await apiFetch("contacts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || err?.message || "Unable to save this contact.");
      }
      toast.success(`Saved ${email}`);
      onAdded?.();
      if (keepOpen) {
        setDraft(EMPTY_DRAFT);
        // Focus the email field for fast batch entry.
        requestAnimationFrame(() => {
          document.getElementById("add-contact-email")?.focus();
        });
      } else {
        resetAndClose();
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : resetAndClose())}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <UserPlus className="h-4 w-4" /> Add contact
      </button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a contact</DialogTitle>
          <DialogDescription>
            Fill in the standard merge tags and add more below — they become
            custom metadata you can drop into cold emails as <span className="font-mono">{`{{ key }}`}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="add-contact-email">Email *</Label>
            <Input
              id="add-contact-email"
              type="email"
              value={draft.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="[email protected]"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-contact-first">First name</Label>
            <Input
              id="add-contact-first"
              value={draft.firstName}
              onChange={(e) => update("firstName", e.target.value)}
              placeholder="Priya"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-contact-last">Last name</Label>
            <Input
              id="add-contact-last"
              value={draft.lastName}
              onChange={(e) => update("lastName", e.target.value)}
              placeholder="Sharma"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-contact-company">Company</Label>
            <Input
              id="add-contact-company"
              value={draft.company}
              onChange={(e) => update("company", e.target.value)}
              placeholder="Acme Robotics"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-contact-title">Title</Label>
            <Input
              id="add-contact-title"
              value={draft.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="Head of Growth"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-contact-city">City</Label>
            <Input
              id="add-contact-city"
              value={draft.city}
              onChange={(e) => update("city", e.target.value)}
              placeholder="Mumbai"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-contact-country">Country</Label>
            <Input
              id="add-contact-country"
              value={draft.country}
              onChange={(e) => update("country", e.target.value)}
              placeholder="India"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-contact-phone">Phone</Label>
            <Input
              id="add-contact-phone"
              value={draft.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="+91 98xxxxxxxx"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-contact-linkedin">LinkedIn</Label>
            <Input
              id="add-contact-linkedin"
              value={draft.linkedin}
              onChange={(e) => update("linkedin", e.target.value)}
              placeholder="https://linkedin.com/in/..."
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Custom merge fields</Label>
              <p className="text-xs text-muted-foreground">
                Use these for {`{{ industry }}`}, {`{{ employee_count }}`}, {`{{ pain_point }}`}, anything you want
                to drop into a template.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addCustomField}>
              <Plus className="h-4 w-4" /> Add field
            </Button>
          </div>
          {draft.custom.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              No custom fields yet. Standard fields above are enough to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {draft.custom.map((field, index) => (
                <div key={index} className="grid grid-cols-[1fr_2fr_auto] items-center gap-2">
                  <Input
                    value={field.key}
                    onChange={(e) => updateCustomField(index, { key: e.target.value })}
                    placeholder="field_name"
                    className="font-mono text-xs"
                  />
                  <Input
                    value={field.value}
                    onChange={(e) => updateCustomField(index, { value: e.target.value })}
                    placeholder="value"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCustomField(index)}
                    aria-label="Remove custom field"
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={resetAndClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => persist(true)}
            disabled={saving || !draft.email.trim()}
          >
            Save and add another
          </Button>
          <Button onClick={() => persist(false)} disabled={saving || !draft.email.trim()}>
            {saving ? "Saving…" : "Save contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}