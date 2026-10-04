"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Loader2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { workspaceClassName } from "@/lib/workspace-styles";
import type { WorkspaceBilling } from "@/lib/billing/types";

export default function BillingPage() {
	const { data: session } = useSession();
  const billing = useQuery<WorkspaceBilling>({
    queryKey: ["workspace-billing", session?.user?.teamId],
    enabled: !!session?.user?.teamId,
    queryFn: async () => {
      const response = await fetch("/api/billing", {
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load billing.");
      return data;
    },
    retry: false,
    staleTime: 60_000,
  });

  if (billing.isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]" role="status" aria-label="Loading billing">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>;
  }
  if (billing.isError || !billing.data) {
    return <Card className="m-6 p-6 space-y-3" role="alert">
      <h2 className="font-semibold">Billing couldn’t be loaded</h2>
      <p className="text-sm text-muted-foreground">Please try again. Your workspace is still available.</p>
      <Button onClick={() => billing.refetch()} disabled={billing.isFetching}>Try again</Button>
    </Card>;
  }

  const { plans, subscription } = billing.data;
  const currentPlan = subscription?.product || plans.find(p => p.id === subscription?.product_id);
  return <div className={workspaceClassName("workspace-page-body space-y-6")}>
    <Card className="p-6 space-y-2">
      <div className="flex items-center gap-2 font-semibold"><CreditCard className="h-5 w-5" />Current subscription</div>
      <p>{subscription ? (currentPlan?.name || "Workspace subscription") : "No paid subscription"}</p>
      {subscription && <p className="text-sm capitalize text-muted-foreground">Status: {subscription.status}</p>}
      <p className="text-sm text-muted-foreground">Online payments are not available on this installation yet. You can continue using your workspace.</p>
    </Card>
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {plans.map(plan => <Card key={plan.id} className="p-6 space-y-3">
        <h2 className="font-semibold text-lg">{plan.name}</h2>
        <p className="text-sm text-muted-foreground">{plan.description}</p>
        {plan.id === subscription?.product_id && <p className="text-sm font-medium">Current plan</p>}
        <ul className="space-y-2 text-sm">
          {(plan.features || []).filter(f => f.enabled).map(f => <li key={f.feature}>
            {f.feature.replace(/_/g, " ")}{f.limit > 0 ? ` · Limit: ${f.limit}` : ""}
          </li>)}
        </ul>
      </Card>)}
    </div>
    {plans.length === 0 && <Card className="p-6 text-sm text-muted-foreground">No billing plans have been published yet.</Card>}
  </div>;
}
