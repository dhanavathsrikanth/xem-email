import { auth } from "@/auth";
import type { WorkspaceBilling } from "@/lib/billing/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken || session.error) {
    return Response.json({ error: "Please sign in again." }, { status: 401 });
  }
  const base = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!base) {
    return Response.json({ error: "Billing is not available yet." }, { status: 503 });
  }
  try {
    const options: RequestInit = {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    };
    const [plans, subscription] = await Promise.all([
      fetch(`${base.replace(/\/$/, "")}/plans`, options),
      fetch(`${base.replace(/\/$/, "")}/subscriptions`, options),
    ]);
    if (subscription.status === 401 || subscription.status === 403) {
      return Response.json({ error: "Please sign in again." }, { status: subscription.status });
    }
    if (!plans.ok || (!subscription.ok && subscription.status !== 404)) {
      throw new Error("Billing request failed");
    }
    const catalog = await plans.json();
    if (!Array.isArray(catalog.plans)) throw new Error("Invalid catalog");
    const result: WorkspaceBilling = {
      plans: catalog.plans,
      subscription: subscription.status === 404 ? null : await subscription.json(),
    };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "We couldn’t load billing. Please try again." },
      { status: 503 },
    );
  }
}
