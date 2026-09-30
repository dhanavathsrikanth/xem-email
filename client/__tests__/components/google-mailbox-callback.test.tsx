/** @jest-environment jsdom */
import * as React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import GoogleMailboxCallback from "@/app/settings/imap/google/callback/page";

const mockRequest = jest.fn();
const mockRefresh = jest.fn();
let unstableTransport = false;
jest.mock("@/lib/marketing/api", () => ({
  useMarketing: () =>
    unstableTransport
      ? {
          request: (...args: unknown[]) => mockRequest(...args),
          refresh: () => mockRefresh(),
          ready: true,
        }
      : {
          request: mockRequest,
          refresh: mockRefresh,
          ready: true,
        },
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  unstableTransport = false;
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(url: string) {
  window.history.replaceState(null, "", url);
  await act(async () => root.render(<GoogleMailboxCallback />));
  await act(async () => Promise.resolve());
}

test("rejects an incomplete callback and removes query credentials", async () => {
  await render(
    "/settings/imap/google/callback?error=access_denied&state=state",
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "canceled or incomplete",
  );
  expect(window.location.search).toBe("");
  expect(mockRequest).not.toHaveBeenCalled();
});

test("completes once and keeps success visible when refresh fails", async () => {
  mockRequest.mockResolvedValue({});
  mockRefresh.mockRejectedValue(new Error("refresh failed"));
  await render(
    "/settings/imap/google/callback?code=one-time&state=state-token",
  );
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(mockRequest).toHaveBeenCalledWith(
    "mail-connections/google/complete",
    "POST",
    { code: "one-time", state: "state-token" },
  );
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Google mailbox connected",
  );
  expect(container.querySelector('a[href="/inbox"]')).not.toBeNull();
  expect(window.location.search).toBe("");
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<GoogleMailboxCallback />));
  await act(async () => Promise.resolve());
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Google mailbox connected",
  );
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

test("reattaches to an in-flight completion after the callback remounts", async () => {
  let complete!: () => void;
  mockRequest.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  mockRefresh.mockResolvedValue(undefined);
  await render(
    "/settings/imap/google/callback?code=one-time&state=state-token",
  );
  expect(window.location.search).toBe("");
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<GoogleMailboxCallback />));
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Completing",
  );
  await act(async () => complete());
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Google mailbox connected",
  );
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

test("keeps the completion subscription through Strict Mode and transport rerenders", async () => {
  unstableTransport = true;
  let complete!: () => void;
  mockRequest.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  mockRefresh.mockResolvedValue(undefined);
  window.history.replaceState(
    null,
    "",
    "/settings/imap/google/callback?code=one-time&state=state-token",
  );
  await act(async () =>
    root.render(
      <React.StrictMode>
        <GoogleMailboxCallback />
      </React.StrictMode>,
    ),
  );
  expect(mockRequest).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.render(
      <React.StrictMode>
        <GoogleMailboxCallback />
      </React.StrictMode>,
    ),
  );
  await act(async () => complete());
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Google mailbox connected",
  );
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

test("shows completion failures as an alert", async () => {
  mockRequest.mockRejectedValue(
    new Error("Google account could not be linked"),
  );
  await render("/settings/imap/google/callback?code=code&state=state");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "could not be linked",
  );
  expect(container.querySelector('a[href="/settings/imap"]')).not.toBeNull();
});
