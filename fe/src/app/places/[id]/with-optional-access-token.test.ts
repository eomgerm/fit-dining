import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/api-error";

import { withOptionalAccessToken } from "./with-optional-access-token";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  refresh: vi.fn(),
  getSession: vi.fn(),
  // 인증 상태가 바뀌었다고 알리는 함수. withOptionalAccessToken이 처음 불릴 때 등록한다
  sessionChanged: undefined as (() => void) | undefined,
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  ACCESS_TOKEN_EXPIRED_TYPE: "urn:fitdining:auth:access-token-expired",
  restore: mocks.restore,
  refresh: mocks.refresh,
  getSession: mocks.getSession,
  subscribe: (listener: () => void) => {
    mocks.sessionChanged = listener;
    return () => {};
  },
}));

const expired = new ApiError("http", "x", {
  status: 401,
  problem: { status: 401, type: "urn:fitdining:auth:access-token-expired" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.restore.mockResolvedValue({ accessToken: "old" });
  mocks.getSession.mockReturnValue({ accessToken: "old" });
  mocks.refresh.mockResolvedValue({ accessToken: "new" });
  mocks.sessionChanged?.();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withOptionalAccessToken", () => {
  const unauthorized = new ApiError("http", "x", { status: 401 });

  it("메모리에 세션이 있으면 그 AT로 보낸다", async () => {
    const send = vi.fn().mockResolvedValue("ok");

    await expect(withOptionalAccessToken(send)).resolves.toBe("ok");
    expect(send.mock.calls).toEqual([["old"]]);
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("메모리에 세션이 없으면 세션을 되살려 AT를 붙인다", async () => {
    mocks.getSession.mockReturnValue(null);
    const send = vi.fn().mockResolvedValue("ok");

    await withOptionalAccessToken(send);
    expect(send.mock.calls).toEqual([["old"]]);
  });

  it("세션이 없으면 AT 없이 보내고, 인증 상태가 바뀔 때까지 다시 갱신하지 않는다", async () => {
    mocks.getSession.mockReturnValue(null);
    mocks.restore.mockRejectedValue(unauthorized);
    const send = vi.fn().mockResolvedValue("ok");

    await withOptionalAccessToken(send);
    await withOptionalAccessToken(send);
    expect(send.mock.calls).toEqual([[], []]);
    expect(mocks.restore).toHaveBeenCalledTimes(1);

    mocks.sessionChanged?.();
    await withOptionalAccessToken(send);
    expect(mocks.restore).toHaveBeenCalledTimes(2);
  });

  it("세션 확인이 3초 안에 끝나지 않으면 AT 없이 보낸다", async () => {
    vi.useFakeTimers();
    mocks.getSession.mockReturnValue(null);
    mocks.restore.mockReturnValue(new Promise(() => {}));
    const send = vi.fn().mockResolvedValue("ok");

    const result = withOptionalAccessToken(send);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(result).resolves.toBe("ok");
    expect(send.mock.calls).toEqual([[]]);
  });

  it("AT가 만료됐으면 한 번 갱신해 새 AT로 다시 보낸다", async () => {
    const send = vi.fn().mockRejectedValueOnce(expired).mockResolvedValue("ok");

    await withOptionalAccessToken(send);
    expect(send.mock.calls).toEqual([["old"], ["new"]]);
  });

  it("갱신에 실패하면 AT 없이 다시 보낸다", async () => {
    mocks.refresh.mockRejectedValue(unauthorized);
    const send = vi.fn().mockRejectedValueOnce(expired).mockResolvedValue("ok");

    await withOptionalAccessToken(send);
    expect(send.mock.calls).toEqual([["old"], []]);
  });

  it("거부된 AT는 AT 없이 다시 보내고, 인증 상태가 바뀔 때까지 다시 쓰지 않는다", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValue("ok");

    await withOptionalAccessToken(send);
    await withOptionalAccessToken(send);
    expect(send.mock.calls).toEqual([["old"], [], []]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("갱신한 AT도 거부되면 AT 없이 다시 보낸다", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(expired)
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValue("ok");

    await expect(withOptionalAccessToken(send)).resolves.toBe("ok");
    expect(send.mock.calls).toEqual([["old"], ["new"], []]);
  });

  it("401이 아닌 오류는 그대로 던진다", async () => {
    const failure = new ApiError("http", "x", { status: 500 });

    await expect(
      withOptionalAccessToken(() => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
