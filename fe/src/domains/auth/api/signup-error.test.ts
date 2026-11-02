import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { signupFailure } from "./signup-error";

describe("signup errors", () => {
  it.each(["email", "nickname"] as const)(
    "maps duplicate %s by type",
    (field) => {
      const error = new ApiError("http", "conflict", {
        status: 409,
        problem: { status: 409, type: `urn:fitdining:auth:${field}-taken` },
      });
      expect(signupFailure(error).fields[field]).toBeTruthy();
      if (field === "email")
        expect(signupFailure(error).fields.email).toBe(
          "사용 중인 이메일입니다.",
        );
      expect(signupFailure(error).message).toBe("");
    },
  );
  it("maps recognized 400 fields and ignores malformed extensions", () => {
    const error = new ApiError("http", "bad input", {
      status: 400,
      problem: {
        status: 400,
        errors: [
          null,
          { field: "password", reason: "password rule" },
          { field: "nickname", reason: "name rule" },
          { field: "__proto__", reason: "ignored" },
          { field: "email", reason: 5 },
        ],
      },
    });
    expect(signupFailure(error).fields).toEqual({
      password: "password rule",
      nickname: "name rule",
    });
  });
  it("shows rate limiting and network failures", () => {
    expect(
      signupFailure(new ApiError("http", "limited", { status: 429 })).message,
    ).toBe("잠시 후 다시 시도해주세요.");
    expect(signupFailure(new ApiError("network", "offline")).message).toBe(
      "offline",
    );
  });
});
