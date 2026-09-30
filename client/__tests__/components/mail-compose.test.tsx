/** @jest-environment jsdom */
import * as React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MailCompose } from "@/components/marketing/mail-compose";
import { MarketingRequestError } from "@/lib/marketing/api";

const mockRequest = jest.fn();
const mockConfirm = jest.fn();
const mockSuccess = jest.fn();
const mockClose = jest.fn();
const mockSenders = [
  {
    id: "sender",
    fromEmail: "test@example.com",
    provider: "CUSTOM",
    isDefault: true,
  },
];
jest.mock("@/lib/marketing/api", () => ({
  MarketingRequestError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  useMarketing: () => ({ request: mockRequest }),
  useMarketingQuery: () => ({ data: mockSenders, isLoading: false }),
}));
jest.mock("@/components/ui/confirm-sheet", () => ({
  useConfirmSheet: () => mockConfirm,
}));
jest.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => mockSuccess(...args) },
}));
jest.mock("@maily-to/render", () => ({
  Maily: class {
    async render() {
      return "<p>Test body</p>";
    }
  },
}));
jest.mock("@/components/ai/email-writer", () => ({ EmailWriter: () => null }));
jest.mock("@/components/marketing/shared", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Field: ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <label>
      {label}
      {children}
    </label>
  ),
}));
jest.mock("@/components/rich-message-editor", () => ({
  RichMessageEditor: ({ onReady, onChange, editable }: any) => {
    const editor = React.useRef({
      isEmpty: true,
      getJSON: () => ({}),
      getText: () => "",
    });
    React.useEffect(() => {
      onReady(editor.current);
    }, []);
    return (
      <button
        type="button"
        disabled={!editable}
        onClick={() => {
          editor.current.isEmpty = false;
          // An image-only draft has content despite no plain text.
          onChange(editor.current);
        }}
      >
        Insert image
      </button>
    );
  },
}));

let root: Root, container: HTMLDivElement;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: () => "b5b850fc-638f-486a-86b5-1d943f9c82fa",
  });
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
function button(label: string) {
  const result = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function render(sender?: string, requireExplicitSender = false) {
  await act(async () =>
    root.render(
      <MailCompose
        value={{
          to: "reader@example.com",
          subject: "Receipt",
          smtpConfigId: sender,
          requireExplicitSender,
        }}
        close={mockClose}
      />,
    ),
  );
  await act(async () => button("Insert image").click());
}
function submitEvent() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
async function submit() {
  await act(async () => submitEvent());
}

test("missing reply identity stays unavailable instead of changing the sender", async () => {
  await render("disconnected");
  expect(button("Send message").disabled).toBe(true);
  expect(container.textContent).toContain("original sender is unavailable");
  expect(mockRequest).not.toHaveBeenCalled();
});

test("receive-only mailbox replies require an explicit sender choice", async () => {
  await render(undefined, true);
  expect(button("Send message").disabled).toBe(true);
  expect(container.textContent).toContain(
    "receive-only mailbox has no linked sender",
  );
  expect(mockRequest).not.toHaveBeenCalled();
});

test("double submit queues once and image-only content can be sent", async () => {
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  expect(button("Send message").disabled).toBe(false);
  await act(async () => {
    submitEvent();
    submitEvent();
  });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(button("Saving to outbox…").disabled).toBe(true);
  await act(async () => finish({ id: "outbox-id" }));
  expect(mockSuccess).toHaveBeenCalledTimes(1);
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test("an uncertain send preserves its payload and key even when a retry receives a 4xx", async () => {
  mockRequest.mockRejectedValueOnce(new Error("network disconnected"));
  mockRequest.mockRejectedValueOnce(
    new MarketingRequestError("Sender disconnected", 400),
  );
  mockRequest.mockResolvedValueOnce({ id: "original-outbox-id" });
  await render();
  await submit();
  const original = mockRequest.mock.calls[0][2];
  expect(button("Retry safely").disabled).toBe(false);
  expect(button("Insert image").disabled).toBe(true);
  await submit();
  expect(button("Retry safely").disabled).toBe(false);
  expect(button("Insert image").disabled).toBe(true);
  await submit();
  expect(mockRequest.mock.calls.every((call) => call[2] === original)).toBe(
    true,
  );
  expect(mockSuccess).toHaveBeenCalledTimes(1);
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test("a malformed success receipt never displays success or discards the draft", async () => {
  mockRequest.mockResolvedValueOnce({});
  await render();
  await submit();
  expect(mockSuccess).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  expect(button("Retry safely").disabled).toBe(false);
});

test("a first-attempt validation rejection allows editing, and cancel preserves the draft", async () => {
  mockRequest.mockRejectedValueOnce(
    new MarketingRequestError("Sender inactive", 400),
  );
  mockConfirm.mockResolvedValueOnce(false);
  await render();
  await submit();
  expect(button("Insert image").disabled).toBe(false);
  expect(container.textContent).toContain("Sender inactive");
  await act(async () => button("Cancel").click());
  expect(mockConfirm).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Discard this draft?" }),
  );
  expect(mockClose).not.toHaveBeenCalled();
});
