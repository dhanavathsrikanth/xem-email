import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "@/app/api/billing/route";
import BillingPage from "@/app/settings/billing/page";
import { auth } from "@/auth";
import { useQuery } from "@tanstack/react-query";

jest.mock("@/auth", () => ({ auth: jest.fn() }));
jest.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { teamId: "fixture-team" } } }) }));
jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));

const session = { accessToken: "private-test-token" };
beforeEach(() => {
  jest.resetAllMocks();
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test/api/v1";
  delete process.env.INTERNAL_API_URL;
  (auth as jest.Mock).mockResolvedValue(session);
  global.fetch = jest.fn();
});

test("unauthenticated requests do not reach the backend", async () => {
  (auth as jest.Mock).mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

test("a missing subscription renders an empty workspace without hiding the catalog", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(Response.json({ plans: [] }))
    .mockResolvedValueOnce(Response.json({ error: "No active subscription" }, { status: 404 }));
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ plans: [], subscription: null });
  expect((fetch as jest.Mock).mock.calls[1][0]).toBe("https://api.example.test/api/v1/subscriptions");
  expect((fetch as jest.Mock).mock.calls[1][1].headers.Authorization).toBe("Bearer private-test-token");
});

test("database failures are errors rather than fake free subscriptions", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(Response.json({ plans: [] }))
    .mockResolvedValueOnce(Response.json({ error: "Database failure" }, { status: 500 }));
  expect((await GET()).status).toBe(503);
});

test("timeouts settle with a retryable error", async () => {
  (fetch as jest.Mock).mockRejectedValue(new Error("Timed out"));
  expect((await GET()).status).toBe(503);
});

test("a failed catalog request shows retry instead of a permanent spinner", () => {
  (useQuery as jest.Mock).mockReturnValue({ isLoading: false, isError: true, refetch: jest.fn() });
  const html = renderToStaticMarkup(<BillingPage />);
  expect(html).toContain("Try again");
  expect(html).not.toContain("animate-spin");
});

test("successful empty billing data finishes loading", () => {
  (useQuery as jest.Mock).mockReturnValue({ isLoading: false, data: { plans: [], subscription: null } });
  const html = renderToStaticMarkup(<BillingPage />);
  expect(html).toContain("No paid subscription");
  expect(html).toContain("No billing plans have been published");
  expect(html).not.toContain("animate-spin");
});
