import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { getUserProfile, withdraw } from "./user-profile";
const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  refresh: vi.fn(),
  getSession: vi.fn(),
  request: vi.fn(),
  clearSession: vi.fn(),
  endSession: vi.fn(),
}));
vi.mock("./auth-client", () => ({
  ...mocks,
  ACCESS_TOKEN_EXPIRED_TYPE: "expired",
}));
vi.mock("@/shared/api/client", () => ({ request: mocks.request }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.restore.mockResolvedValue({ userId: "user/id", accessToken: "old" });
  mocks.getSession.mockReturnValue({ accessToken: "old" });
  mocks.refresh.mockResolvedValue({ accessToken: "new" });
});
it("sends an encoded owner id and bearer token", async () => {
  mocks.request.mockResolvedValue({ nickname: "name" });
  await getUserProfile();
  expect(mocks.request).toHaveBeenCalledWith("/v1/users/user%2Fid", {
    headers: { Authorization: "Bearer old" },
  });
});
it("refreshes an expired access token once", async () => {
  mocks.request
    .mockRejectedValueOnce(
      new ApiError("http", "expired", {
        status: 401,
        problem: { status: 401, type: "expired" },
      }),
    )
    .mockResolvedValueOnce({ nickname: "name" });
  await getUserProfile();
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.request).toHaveBeenLastCalledWith("/v1/users/user%2Fid", {
    headers: { Authorization: "Bearer new" },
  });
});
it("does not retry an ordinary 401", async () => {
  const error = new ApiError("http", "unauthorized", { status: 401 });
  mocks.request.mockRejectedValue(error);
  await expect(getUserProfile()).rejects.toBe(error);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.clearSession).toHaveBeenCalledTimes(1);
});
it("does not retry a second expired response", async () => {
  const error = new ApiError("http", "expired", {
    status: 401,
    problem: { status: 401, type: "expired" },
  });
  mocks.request.mockRejectedValue(error);
  await expect(getUserProfile()).rejects.toBe(error);
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.clearSession).toHaveBeenCalledTimes(1);
});
it("preserves the session on server errors", async () => {
  const error = new ApiError("http", "unavailable", { status: 503 });
  mocks.request.mockRejectedValue(error);
  await expect(getUserProfile()).rejects.toBe(error);
  expect(mocks.clearSession).not.toHaveBeenCalled();
});
it("withdraws with the owner id and bearer token, then ends the session", async () => {
  mocks.request.mockResolvedValue(undefined);
  await withdraw();
  expect(mocks.request).toHaveBeenCalledWith("/v1/users/user%2Fid", {
    method: "DELETE",
    headers: { Authorization: "Bearer old" },
  });
  expect(mocks.endSession).toHaveBeenCalledTimes(1);
  expect(mocks.clearSession).not.toHaveBeenCalled();
});
it("withdraw refreshes an expired access token once", async () => {
  mocks.request
    .mockRejectedValueOnce(
      new ApiError("http", "expired", {
        status: 401,
        problem: { status: 401, type: "expired" },
      }),
    )
    .mockResolvedValueOnce(undefined);
  await withdraw();
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.request).toHaveBeenLastCalledWith("/v1/users/user%2Fid", {
    method: "DELETE",
    headers: { Authorization: "Bearer new" },
  });
  expect(mocks.endSession).toHaveBeenCalledTimes(1);
});
it("withdraw clears the session on 401", async () => {
  const error = new ApiError("http", "unauthorized", { status: 401 });
  mocks.request.mockRejectedValue(error);
  await expect(withdraw()).rejects.toBe(error);
  expect(mocks.clearSession).toHaveBeenCalledTimes(1);
  expect(mocks.endSession).not.toHaveBeenCalled();
});
it("withdraw keeps the session on server errors", async () => {
  const error = new ApiError("http", "unavailable", { status: 503 });
  mocks.request.mockRejectedValue(error);
  await expect(withdraw()).rejects.toBe(error);
  expect(mocks.clearSession).not.toHaveBeenCalled();
  expect(mocks.endSession).not.toHaveBeenCalled();
});
