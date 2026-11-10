import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { getUserProfile, withdraw } from "./user-profile";
const marks = vi.hoisted(() => ({
  clearSignedIn: vi.fn(),
  signedInMarks: vi.fn(),
}));
vi.mock("../model/signed-in-cookie", () => marks);
const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  getSession: vi.fn(),
  request: vi.fn(),
  clearSession: vi.fn(),
  endSession: vi.fn(),
}));
vi.mock("./auth-client", () => mocks);
vi.mock("@/shared/api/client", () => ({ request: mocks.request }));
beforeEach(() => {
  vi.resetAllMocks();
  const session = { userId: "user/id", sessionExpiresAt: 123 };
  mocks.restore.mockResolvedValue(session);
  mocks.getSession.mockReturnValue(session);
  marks.signedInMarks.mockReturnValue("sent-mark");
});
it("sends an encoded owner id and session cookie", async () => {
  mocks.request.mockResolvedValue({ nickname: "name" });
  await getUserProfile();
  expect(mocks.request).toHaveBeenCalledWith("/v1/users/user%2Fid", {});
});
it("does not retry an expired session", async () => {
  mocks.request
    .mockRejectedValueOnce(
      new ApiError("http", "expired", {
        status: 401,
        problem: { status: 401, type: "expired" },
      }),
    )
    .mockResolvedValueOnce({ nickname: "name" });
  await expect(getUserProfile()).rejects.toMatchObject({ status: 401 });
  expect(mocks.request).toHaveBeenLastCalledWith("/v1/users/user%2Fid", {});
});
it("does not retry an ordinary 401", async () => {
  const error = new ApiError("http", "unauthorized", { status: 401 });
  mocks.request.mockRejectedValue(error);
  await expect(getUserProfile()).rejects.toBe(error);
  expect(mocks.clearSession).toHaveBeenCalledTimes(1);
  expect(marks.clearSignedIn).toHaveBeenCalledWith("sent-mark");
});
it("does not retry a repeated expired session response", async () => {
  const error = new ApiError("http", "expired", {
    status: 401,
    problem: { status: 401, type: "expired" },
  });
  mocks.request.mockRejectedValue(error);
  await expect(getUserProfile()).rejects.toBe(error);
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.clearSession).toHaveBeenCalledTimes(1);
  expect(marks.clearSignedIn).toHaveBeenCalledWith("sent-mark");
});
it("preserves the session on server errors", async () => {
  const error = new ApiError("http", "unavailable", { status: 503 });
  mocks.request.mockRejectedValue(error);
  await expect(getUserProfile()).rejects.toBe(error);
  expect(mocks.clearSession).not.toHaveBeenCalled();
});
it("withdraws with the owner id and session cookie, then ends the session", async () => {
  mocks.request.mockResolvedValue(undefined);
  await withdraw();
  expect(mocks.request).toHaveBeenCalledWith("/v1/users/user%2Fid", {
    method: "DELETE",
  });
  expect(mocks.endSession).toHaveBeenCalledTimes(1);
  expect(mocks.clearSession).not.toHaveBeenCalled();
});
it("withdraw does not retry an expired session", async () => {
  mocks.request
    .mockRejectedValueOnce(
      new ApiError("http", "expired", {
        status: 401,
        problem: { status: 401, type: "expired" },
      }),
    )
    .mockResolvedValueOnce(undefined);
  await expect(withdraw()).rejects.toMatchObject({ status: 401 });
  expect(mocks.request).toHaveBeenLastCalledWith("/v1/users/user%2Fid", {
    method: "DELETE",
  });
  expect(mocks.endSession).not.toHaveBeenCalled();
});
it("withdraw clears the session on 401", async () => {
  const error = new ApiError("http", "unauthorized", { status: 401 });
  mocks.request.mockRejectedValue(error);
  await expect(withdraw()).rejects.toBe(error);
  expect(mocks.clearSession).toHaveBeenCalledTimes(1);
  expect(marks.clearSignedIn).toHaveBeenCalledWith("sent-mark");
  expect(mocks.endSession).not.toHaveBeenCalled();
});
it("withdraw keeps the session on server errors", async () => {
  const error = new ApiError("http", "unavailable", { status: 503 });
  mocks.request.mockRejectedValue(error);
  await expect(withdraw()).rejects.toBe(error);
  expect(mocks.clearSession).not.toHaveBeenCalled();
  expect(mocks.endSession).not.toHaveBeenCalled();
});

it.each([getUserProfile, withdraw])(
  "a stale 401 preserves a newer login: %s",
  async (operation) => {
    const newer = { userId: "new-user", sessionExpiresAt: 456 };
    mocks.request.mockImplementation(async () => {
      mocks.getSession.mockReturnValue(newer);
      throw new ApiError("http", "expired", { status: 401 });
    });
    await expect(operation()).rejects.toMatchObject({ status: 401 });
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(marks.clearSignedIn).not.toHaveBeenCalled();
  },
);

it.each([getUserProfile, withdraw])(
  "uses the verified session when memory is cleared before send: %s",
  async (operation) => {
    const verified = { userId: "verified/user", sessionExpiresAt: 123 };
    mocks.restore.mockImplementation(async () => {
      mocks.getSession.mockReturnValue(null);
      return verified;
    });
    mocks.request.mockResolvedValue(undefined);
    await operation();
    expect(mocks.request).toHaveBeenCalledWith(
      "/v1/users/verified%2Fuser",
      operation === withdraw ? { method: "DELETE" } : {},
    );
  },
);
