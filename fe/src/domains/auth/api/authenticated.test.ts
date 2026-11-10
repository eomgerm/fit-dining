import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/shared/api/api-error";

import { authenticated } from "./authenticated";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  refresh: vi.fn(),
  getSession: vi.fn(),
  clearSession: vi.fn(),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  ACCESS_TOKEN_EXPIRED_TYPE: "urn:fitdining:auth:access-token-expired",
  restore: mocks.restore,
  refresh: mocks.refresh,
  getSession: mocks.getSession,
  clearSession: mocks.clearSession,
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

describe("authenticated", () => {
  it("세션을 확인한 뒤 인자 없이 요청한다", async () => {
    const send = vi.fn().mockResolvedValue("ok");

    await expect(authenticated(send)).resolves.toBe("ok");
    expect(send).toHaveBeenCalledWith(
      await mocks.restore.mock.results[0].value,
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("세션이 만료되면 재시도 없이 401을 돌려준다", async () => {
    const send = vi.fn().mockRejectedValueOnce(expired).mockResolvedValue("ok");

    await expect(authenticated(send)).rejects.toBe(expired);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("동시에 인증 정보가 바뀌어도 실패한 요청을 재시도하지 않는다", async () => {
    mocks.getSession.mockReturnValue({ accessToken: "other" });
    const send = vi.fn().mockRejectedValueOnce(expired).mockResolvedValue("ok");

    await expect(authenticated(send)).rejects.toBe(expired);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("만료가 아닌 401과 다른 오류는 갱신하지 않고 그대로 던진다", async () => {
    const forged = new ApiError("http", "x", { status: 401 });
    const conflict = new ApiError("http", "x", { status: 409 });

    await expect(authenticated(() => Promise.reject(forged))).rejects.toBe(
      forged,
    );
    await expect(authenticated(() => Promise.reject(conflict))).rejects.toBe(
      conflict,
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("세션이 없으면 보내지 않고 인증 오류를 던진다", async () => {
    const noSession = new ApiError("http", "x", { status: 401 });
    mocks.restore.mockRejectedValue(noSession);
    const send = vi.fn();

    await expect(authenticated(send)).rejects.toBe(noSession);
    expect(send).not.toHaveBeenCalled();
  });
});
