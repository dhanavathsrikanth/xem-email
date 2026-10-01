/** @jest-environment jsdom */
import * as React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { CloudflareRelays } from "@/components/settings/cloudflare-relay";

const mockRequest = jest.fn();
const mockRefresh = jest.fn();
jest.mock("@/lib/marketing/api", () => ({
  useMarketing: () => ({ request: mockRequest, refresh: mockRefresh }),
  useMarketingQuery: () => ({
    data: { relays: [] },
    isLoading: false,
    error: null,
  }),
}));
jest.mock("@/components/ui/confirm-sheet", () => ({
  useConfirmSheet: () => jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("connects a customer-owned Worker with a write-only API secret", async () => {
  mockRequest.mockResolvedValue({
    id: "relay",
    mailboxId: "mailbox",
    address: "support@example.com",
    workerUrl: "https://mailbox.example.workers.dev",
    enabled: true,
  });
  await act(async () => root.render(<CloudflareRelays />));
  const values: Record<string, string> = {
    "worker-url": "https://mailbox.example.workers.dev",
    "worker-address": "support@example.com",
    "worker-secret": "preview-secret-1234567890-abcdefghij",
  };
  for (const [id, value] of Object.entries(values)) {
    const input = container.querySelector(`#${id}`) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(mockRequest).toHaveBeenCalledWith(
    "mail-connections/cloudflare-relays",
    "POST",
    {
      workerUrl: values["worker-url"],
      address: values["worker-address"],
      secret: values["worker-secret"],
    },
  );
  expect(container.textContent).toContain("never shown again");
});
