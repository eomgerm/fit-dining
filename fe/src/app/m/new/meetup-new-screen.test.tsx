// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/overlay/toast";

import { MeetupNewScreen } from "./meetup-new-screen";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  rememberLoginReturn: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, back: mocks.back }),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  restore: mocks.restore,
}));
vi.mock("../../login-return", () => ({
  rememberLoginReturn: mocks.rememberLoginReturn,
}));

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MeetupNewScreen />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.restore.mockRejectedValue(new Error("401"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("모임 만들기 화면", () => {
  it("로그인하지 않았으면 로그인 안내를 띄운다", async () => {
    mount();
    expect(await screen.findByText("로그인이 필요해요")).toBeTruthy();
    expect(screen.getByText(/모임은 로그인해야 만들 수 있어요/)).toBeTruthy();
  });

  it("로그인을 고르면 이 화면으로 돌아올 주소를 남기고 로그인 화면으로 간다", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "로그인" }));
    expect(mocks.rememberLoginReturn).toHaveBeenCalledWith("/m/new");
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });

  it("로그인했으면 안내 없이 만들기 화면을 보인다", async () => {
    mocks.restore.mockResolvedValue({ userId: "u1", nickname: "민재" });
    mount();
    await waitFor(() => expect(mocks.restore).toHaveBeenCalled());
    expect(screen.getByText(/같이 정해요/)).toBeTruthy();
    expect(screen.queryByText("로그인이 필요해요")).toBeNull();
  });
});
