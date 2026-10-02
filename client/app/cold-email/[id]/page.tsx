"use client";

import { ColdEmailEditor } from "@/components/cold-email/cold-email-editor";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use } from "react";

export default function EditColdEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" asChild>
          <Link href="/cold-email">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <h1 className="text-xl font-medium">Edit cold email</h1>
      </div>
      <ColdEmailEditor templateId={id} />
    </div>
  );
}
