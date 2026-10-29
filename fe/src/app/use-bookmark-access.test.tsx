// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bookmarkKeys } from "@/domains/place/api/bookmark-queries";
import { BookmarkAccountChanged } from "@/domains/place/model/bookmark";
import { ApiError } from "@/shared/api/api-error";
import { createQueryClient } from "@/shared/api/query-client";

import { useBookmarkAccess } from "./use-bookmark-access";

type Session = { userId: string; accessToken: string };

const auth = vi.hoisted(() => ({
  session: null as Session | null,
  listeners: new Set<() => void>(),
  restore: vi.fn(),
  refresh: vi.fn(),
  clearSession: vi.fn(),
}));
function setSession(next: Session | null) {
  auth.session = next;
  auth.listeners.forEach((listener) => listener());
}
vi.mock("@/domains/auth/api/auth-client", () => ({
  ACCESS_TOKEN_EXPIRED_TYPE: "urn:fitdining:auth:access-token-expired",
  getSession: () => auth.session,
  subscribe: (listener: () => void) => {
    auth.listeners.add(listener);
    return () => auth.listeners.delete(listener);
  },
  restore: auth.restore,
  refresh: auth.refresh,
  clearSession: auth.clearSession,
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const expired = () =>
  new ApiError("http", "만료", {
    status: 401,
    problem: { status: 401, type: "urn:fitdining:auth:access-token-expired" },
  });

let queryClient = createQueryClient();
function renderAccess() {
  queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useBookmarkAccess(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.session = null;
  auth.listeners.clear();
  auth.restore.mockImplementation(async () => auth.session);
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("로그인 상태", () => {
  it("세션이 있으면 그 사용자다", async () => {
    auth.session = { userId: "a", accessToken: "t1" };
    const { result } = renderAccess();

    expect(result.current.session).toEqual({ status: "user", userId: "a" });
  });

  it("복원이 실패하면 비로그인이다", async () => {
    auth.restore.mockRejectedValue(new Error("unauthenticated"));
    const { result } = renderAccess();

    expect(result.current.session).toEqual({ status: "checking" });
    await act(async () => {});
    expect(result.current.session).toEqual({ status: "guest" });
  });

  it("복원이 3초 안에 끝나지 않으면 비로그인으로 보이고, 그 뒤 복원되면 로그인한 사용자로 다시 그린다", async () => {
    vi.useFakeTimers();
    auth.restore.mockImplementation(() => new Promise(() => {}));
    const { result } = renderAccess();

    await act(async () => vi.advanceTimersByTimeAsync(2999));
    expect(result.current.session).toEqual({ status: "checking" });
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.session).toEqual({ status: "guest" });

    act(() => setSession({ userId: "a", accessToken: "t1" }));
    expect(result.current.session).toEqual({ status: "user", userId: "a" });
  });

  it("계정이 바뀌면 이전 계정의 북마크 캐시를 지운다", async () => {
    auth.session = { userId: "a", accessToken: "t1" };
    renderAccess();
    queryClient.setQueryData(bookmarkKeys.status("a", 1), { bookmarked: true });
    queryClient.setQueryData([...bookmarkKeys.lists("a"), 1], []);

    act(() => setSession({ userId: "b", accessToken: "t2" }));

    expect(
      queryClient.getQueryData(bookmarkKeys.status("a", 1)),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData([...bookmarkKeys.lists("a"), 1]),
    ).toBeUndefined();
  });

  it("세션 종료는 인증 모듈의 clearSession이고, [로그인]은 돌아올 주소를 남기고 로그인 화면으로 간다", async () => {
    auth.session = { userId: "a", accessToken: "t1" };
    const { result } = renderAccess();

    result.current.endSession();
    result.current.login("/place?id=3");

    expect(auth.clearSession).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/login");
    expect(
      JSON.parse(sessionStorage.getItem("fitdining:login-return") ?? "{}").path,
    ).toBe("/place?id=3");
  });
});

describe("누른 계정의 AT로만 보내기", () => {
  it("지금 세션이 누른 계정이면 그 AT로 보낸다", async () => {
    auth.session = { userId: "a", accessToken: "t1" };
    const { result } = renderAccess();
    const request = vi.fn(async (token: string) => token);

    await expect(result.current.send("a", request)).resolves.toBe("t1");
  });

  it("로그인 정보가 없거나 다른 계정이면 보내지 않는다", async () => {
    auth.session = { userId: "b", accessToken: "t2" };
    const { result } = renderAccess();
    const request = vi.fn(async () => "sent");

    await expect(result.current.send("a", request)).rejects.toBeInstanceOf(
      BookmarkAccountChanged,
    );
    auth.session = null;
    await expect(result.current.send("a", request)).rejects.toBeInstanceOf(
      BookmarkAccountChanged,
    );
    expect(request).not.toHaveBeenCalled();
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it("같은 계정이어도 보내려는 AT가 지금 세션의 AT가 아니면 보내지 않는다", async () => {
    auth.session = { userId: "a", accessToken: "t1" };
    // 복원이 돌려준 세션이 그사이 바뀐 경우(다른 계정으로 갔다가 같은 계정으로 다시 로그인)
    auth.restore.mockResolvedValue({ userId: "a", accessToken: "stale" });
    const { result } = renderAccess();
    const request = vi.fn(async () => "sent");

    await expect(result.current.send("a", request)).rejects.toBeInstanceOf(
      BookmarkAccountChanged,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("AT가 만료돼 RT로 갱신했더니 다른 계정이면 다시 보내지 않는다", async () => {
    auth.session = { userId: "a", accessToken: "t1" };
    auth.refresh.mockImplementation(async () => {
      auth.session = { userId: "b", accessToken: "t2" };
      return auth.session;
    });
    const { result } = renderAccess();
    const request = vi.fn(async () => {
      throw expired();
    });

    await expect(result.current.send("a", request)).rejects.toBeInstanceOf(
      BookmarkAccountChanged,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("같은 계정으로 갱신했으면 새 AT로 한 번 다시 보낸다", async () => {
    auth.session = { userId: "a", accessToken: "t1" };
    auth.refresh.mockImplementation(async () => {
      auth.session = { userId: "a", accessToken: "t2" };
      return auth.session;
    });
    const { result } = renderAccess();
    const request = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(expired())
      .mockImplementation(async (token) => token);

    await expect(result.current.send("a", request)).resolves.toBe("t2");
  });
});
