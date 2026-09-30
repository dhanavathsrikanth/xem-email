/** @jest-environment jsdom */
import * as React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MailSummary } from "@/components/marketing/mail-summary";
import { messageKey, sortMailMessages } from "@/components/marketing/inbox";
import { PreviewTransport } from "@/lib/marketing/api";

const mockRequest = jest.fn();
let enabled = true;

jest.mock("@/lib/marketing/api", () => ({
  PreviewTransport: React.createContext(
    async (path: string, method: string, body: unknown) => {
      if (method === "GET") return { enabled };
      return mockRequest(path, method, body);
    },
  ),
  useMarketing: () => ({ scope: "test-team" }),
}));
jest.mock("@/components/marketing/mail-compose", () => ({
  MailCompose: () => null,
}));

let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  enabled = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const props = {
  configId: "11111111-1111-4111-8111-111111111111",
  folder: "INBOX",
  uid: 42,
  uidValidity: 7,
};
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((node) =>
    node.textContent?.includes(label),
  )!;

test("summary is explicit and sends only the stable message selector", async () => {
  mockRequest.mockResolvedValue({
    summary: "Needs review.",
    keyPoints: ["Budget changed"],
    actionItems: ["Reply Thursday"],
    truncated: false,
  });
  await act(async () => root.render(<MailSummary {...props} />));
  expect(container.textContent).toContain(
    "sent to your configured AI provider",
  );
  expect(mockRequest).not.toHaveBeenCalled();
  await act(async () => button("Summarize").click());
  expect(mockRequest).toHaveBeenCalledWith(
    "assistant/mail-summary",
    "POST",
    props,
  );
  expect(container.textContent).toContain("Needs review.");
  expect(container.textContent).toContain("Reply Thursday");
});

test("disabled workspaces explain why summary is unavailable", async () => {
  enabled = false;
  await act(async () => root.render(<MailSummary {...props} />));
  expect(container.textContent).toContain("Email summaries are not enabled");
  expect(container.querySelector("button")).toBeNull();
});

test("cancelled results are ignored", async () => {
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(<MailSummary {...props} />));
  await act(async () => button("Summarize").click());
  await act(async () => button("Cancel").click());
  await act(async () =>
    finish({
      summary: "Late result",
      keyPoints: [],
      actionItems: [],
      truncated: false,
    }),
  );
  expect(container.textContent).not.toContain("Late result");
  expect(container.textContent).toContain("Summarize");
});

test("stable inbox identity uses UID validity and UID", () => {
  const base = {
    subject: "Same",
    from: "a@example.com",
    to: "b@example.com",
    cc: "",
    bcc: "",
    body: "",
    date: "",
    messageId: "duplicate",
    flags: [],
    attachments: [],
  };
  expect(messageKey({ ...base, uid: 8, uidValidity: 2 })).toBe("uid:2:8");
  expect(messageKey({ ...base, uid: 8, uidValidity: 3 })).toBe("uid:3:8");
});

test("canonical identity and starred navigation order stay aligned", () => {
  const base = {
    subject: "",
    from: "a",
    to: "b",
    cc: "",
    bcc: "",
    body: "",
    date: "",
    messageId: "same",
    attachments: [],
  };
  const plain = {
    ...base,
    id: "mailbox-a:INBOX:1:8",
    uid: 8,
    uidValidity: 1,
    flags: [],
  };
  const starred = {
    ...base,
    id: "mailbox-b:INBOX:1:8",
    uid: 8,
    uidValidity: 1,
    flags: ["\\Flagged"],
  };
  expect(messageKey(plain)).not.toBe(messageKey(starred));
  expect(sortMailMessages([plain, starred]).map(messageKey)).toEqual([
    messageKey(starred),
    messageKey(plain),
  ]);
});

test("production summary uses same-origin fetch and forwards an abort signal", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        summary: "Safe",
        keyPoints: [],
        actionItems: [],
        truncated: false,
      }),
    });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
  });
  await act(async () =>
    root.render(
      <PreviewTransport.Provider value={null}>
        <MailSummary {...props} />
      </PreviewTransport.Provider>,
    ),
  );
  await act(async () => button("Summarize").click());
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/assistant/mail-summary",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
      body: JSON.stringify(props),
    }),
  );
  delete (globalThis as { fetch?: unknown }).fetch;
});
