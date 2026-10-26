import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/api-error";

import { withAccessToken } from "./with-access-token";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  refresh: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  ACCESS_TOKEN_EXPIRED_TYPE: "urn:fitdining:auth:access-token-expired",
  restore: mocks.restore,
  refresh: mocks.refresh,
  getSession: mocks.getSession,
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
});

describe("withAccessToken", () => {
  it("세션의 AT로 보낸다", async () => {
    const send = vi.fn().mockResolvedValue("ok");

    await expect(withAccessToken(send)).resolves.toBe("ok");
    expect(send).toHaveBeenCalledWith("old");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("AT가 만료됐으면 한 번 갱신해 새 AT로 다시 보낸다", async () => {
    const send = vi.fn().mockRejectedValueOnce(expired).mockResolvedValue("ok");

    await expect(withAccessToken(send)).resolves.toBe("ok");
    expect(send.mock.calls).toEqual([["old"], ["new"]]);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("그사이 다른 요청이 갱신했으면 다시 갱신하지 않고 그 AT를 쓴다", async () => {
    mocks.getSession.mockReturnValue({ accessToken: "other" });
    const send = vi.fn().mockRejectedValueOnce(expired).mockResolvedValue("ok");

    await withAccessToken(send);
    expect(send).toHaveBeenLastCalledWith("other");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("만료가 아닌 401과 다른 오류는 갱신하지 않고 그대로 던진다", async () => {
    const forged = new ApiError("http", "x", { status: 401 });
    const conflict = new ApiError("http", "x", { status: 409 });

    await expect(withAccessToken(() => Promise.reject(forged))).rejects.toBe(
      forged,
    );
    await expect(withAccessToken(() => Promise.reject(conflict))).rejects.toBe(
      conflict,
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("세션이 없으면 보내지 않고 인증 오류를 던진다", async () => {
    const noSession = new ApiError("http", "x", { status: 401 });
    mocks.restore.mockRejectedValue(noSession);
    const send = vi.fn();

    await expect(withAccessToken(send)).rejects.toBe(noSession);
    expect(send).not.toHaveBeenCalled();
  });
});
