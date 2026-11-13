// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/api-error";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import { EditScreen } from "./edit-screen";

const api = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  updateMeetup: vi.fn(),
  searchAreas: vi.fn(),
}));
vi.mock("@/domains/meetup/api/meetup-api", () => api);
vi.mock("@/domains/auth/api/authenticated", () => ({
  authenticated: <T,>(send: () => Promise<T>) => send(),
}));

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks,
}));
vi.mock("../../../login-return", () => ({
  rememberLoginReturn: vi.fn(),
}));

const CODE = "AbCdEfGhIjKlMnOpQrStUv";

function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
      }
    >
      <ToastProvider>
        <EditScreen code={CODE} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("모임 정보 수정 화면", () => {
  it("모임을 받지 못하면 실패 안내와 다시 시도를 보이고, 다시 시도하면 다시 받는다", async () => {
    api.fetchSnapshot.mockRejectedValue(
      new ApiError("http", "server", { status: 500 }),
    );
    mount();
    expect(await screen.findByText("모임을 불러오지 못했어요")).toBeTruthy();
    const before = api.fetchSnapshot.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() =>
      expect(api.fetchSnapshot.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("앱 안에서 왔으면 받지 못했을 때 뒤로가 이전 화면으로 간다", async () => {
    vi.spyOn(History.prototype, "length", "get").mockReturnValue(3);
    api.fetchSnapshot.mockRejectedValue(
      new ApiError("http", "server", { status: 500 }),
    );
    mount();
    await screen.findByText("모임을 불러오지 못했어요");
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
    expect(mocks.back).toHaveBeenCalled();
  });
});
