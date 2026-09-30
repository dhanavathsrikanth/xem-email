/** @jest-environment jsdom */
import * as React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { useInboxSidebarCollapse } from "@/components/app-shell";

jest.mock("next-auth/react", () => ({
  signOut: jest.fn(),
  useSession: () => ({ data: null }),
}));
jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: jest.fn() }),
}));
jest.mock("@/components/app-header", () => ({ AppHeader: () => null }));
jest.mock("@/components/assistant/workspace-ai", () => ({
  WorkspaceAIProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/marketing/shared", () => ({ Modal: () => null }));
jest.mock("@/components/ui/dropdown-menu", () => ({}));
jest.mock("@/components/ui/sheet", () => ({}));
jest.mock("@/components/workspace-shell.module.css", () => ({}));

function Harness({ active }: { active: string }) {
  const [collapsed, setCollapsed] = useInboxSidebarCollapse(active);
  return (
    <div data-collapsed={collapsed}>
      <button
        type="button"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={() => setCollapsed((value) => !value)}
      />
    </div>
  );
}

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(active: string) {
  await act(async () => root.render(<Harness active={active} />));
}

function shell() {
  return container.querySelector("[data-collapsed]") as HTMLElement;
}

function toggle() {
  return container.querySelector("button") as HTMLButtonElement;
}

test("direct Inbox loads collapsed and can be manually expanded", async () => {
  await render("/inbox");
  expect(shell().dataset.collapsed).toBe("true");
  expect(toggle().getAttribute("aria-label")).toBe("Expand sidebar");

  await act(async () => toggle().click());
  expect(shell().dataset.collapsed).toBe("false");
  expect(toggle().getAttribute("aria-label")).toBe("Collapse sidebar");

  await render("/inbox/thread/42");
  expect(shell().dataset.collapsed).toBe("false");
});

test("entering Inbox collapses once and leaving restores desktop preference", async () => {
  await render("/dashboard");
  expect(shell().dataset.collapsed).toBe("false");

  await render("/inbox");
  expect(shell().dataset.collapsed).toBe("true");
  await act(async () => toggle().click());
  expect(shell().dataset.collapsed).toBe("false");

  await render("/campaigns");
  expect(shell().dataset.collapsed).toBe("false");
  await act(async () => toggle().click());
  expect(shell().dataset.collapsed).toBe("true");

  await render("/inbox");
  expect(shell().dataset.collapsed).toBe("true");
  await act(async () => toggle().click());
  await render("/dashboard");
  expect(shell().dataset.collapsed).toBe("true");
});
