// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { ToastProvider } from "@/shared/ui/overlay/toast";
import { SocialError } from "./social-error";
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});
it("shows social failure once and removes only the error query", async () => {
  window.history.replaceState(null, "", "/signup?error=social&keep=1");
  render(
    <StrictMode>
      <ToastProvider>
        <SocialError />
      </ToastProvider>
    </StrictMode>,
  );
  expect(
    await screen.findByText("로그인하지 못했어요. 다시 시도해 주세요."),
  ).toBeTruthy();
  expect(replace).toHaveBeenCalledExactlyOnceWith("/signup?keep=1");
});
