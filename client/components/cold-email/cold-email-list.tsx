"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { useTeam } from "@/app/providers/team-provider";
import { EmailTemplate } from "@/lib";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

/**
 * The Cold Email templates index. Mirrors the existing Templates list but
 * scoped to cold-email use cases (no starter gallery, just a single CTA to
 * create one).
 */
export function ColdEmailList() {
  const { apiFetch, session } = useApi();
  const { team } = useTeam();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["cold-email-templates", team?.id],
    enabled: !!team?.id && !!session?.accessToken,
    queryFn: async ({ signal }) => {
      const response = await apiFetch("templates?limit=100", { signal });
      if (!response.ok) throw new Error("Unable to load your templates");
      const payload = await response.json();
      const data = payload.data || payload || [];
      return (Array.isArray(data) ? data : []) as EmailTemplate[];
    },
  });

  const templates = templatesQuery.data || [];

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await apiFetch(`templates/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to delete this template.");
      void queryClient.invalidateQueries({ queryKey: ["cold-email-templates"] });
      void queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template removed");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-medium">
            <Mail className="h-5 w-5 text-muted-foreground" /> Cold email templates
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Write one message, fill in <code className="font-mono text-xs">{`{{ name }}`}</code>, and Xem sends a
            personalised version to every lead on your list.
          </p>
        </div>
        <Button asChild>
          <Link href="/cold-email/new">
            <Plus className="h-4 w-4" /> New template
          </Link>
        </Button>
      </header>

      {templatesQuery.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your templates…
        </div>
      ) : templatesQuery.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {(templatesQuery.error as Error).message}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Tokens used</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/cold-email/${template.id}`}
                      className="hover:underline"
                    >
                      {template.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[28rem] truncate text-muted-foreground" title={template.subject}>
                    {template.subject || "(no subject)"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(template.variables || []).slice(0, 4).map((variable) => (
                        <Badge key={variable} variant="secondary" className="font-mono text-[10px]">
                          {`{{ ${variable} }}`}
                        </Badge>
                      ))}
                      {(template.variables || []).length > 4 && (
                        <Badge variant="outline" className="text-[10px]">
                          +{template.variables.length - 4}
                        </Badge>
                      )}
                      {!(template.variables || []).length && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {template.updatedAt ? new Date(template.updatedAt).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={deletingId === template.id}
                      onClick={() => handleDelete(template.id)}
                    >
                      {deletingId === template.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center">
      <h2 className="text-lg font-medium">Start your first cold email</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Personalised templates live here. Click a chip to drop a merge tag into the body, and the right-hand
        preview shows the result filled in for any lead in your audience.
      </p>
      <Button asChild className="mt-4">
        <Link href="/cold-email/new">
          <Plus className="h-4 w-4" /> Create a cold email template
        </Link>
      </Button>
    </div>
  );
}
