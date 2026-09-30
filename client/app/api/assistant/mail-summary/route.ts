import { readJSON } from "@/lib/assistant/http";
import {
  createMailSummary,
  mailSummaryEnabled,
} from "@/lib/assistant/mail-summary";
import { authenticate, errorResponse } from "@/lib/assistant/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    await authenticate();
    return Response.json(
      { enabled: mailSummaryEnabled() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const result = await createMailSummary(
      await readJSON(request, 2_000),
      request.signal,
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
