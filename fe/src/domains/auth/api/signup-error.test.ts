import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import {
  signupFailure,
  verificationFailure,
  validationFieldError,
} from "./signup-error";

it("reads only the requested validation field from a 400 errors array", () => {
  const error = new ApiError("http", "invalid", {
    status: 400,
    problem: {
      status: 400,
      errors: [
        null,
        { field: "body", reason: "body error" },
        { field: "contactEmail", reason: 5 },
        { field: "contactEmail", reason: "email format" },
      ],
    },
  });
  expect(validationFieldError(error, "contactEmail")).toBe("email format");
  expect(validationFieldError(error, "email")).toBeUndefined();
  expect(validationFieldError(new Error("failed"), "email")).toBeUndefined();
});

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

describe("email verification errors", () => {
  it("returns to verification when signup token is missing or expired", () => {
    const failure = signupFailure(
      new ApiError("http", "bad input", {
        status: 400,
        problem: {
          status: 400,
          type: "urn:fitdining:auth:verification-required",
        },
      }),
    );
    expect(failure.resetVerification).toBe(true);
    expect(failure.fields.email).toBe(
      "이메일 인증이 만료됐어요. 다시 인증해 주세요.",
    );
    expect(failure.message).toBe("");
  });
  it.each([
    ["email-taken", 409, "이미 가입한 이메일이에요. 로그인해 주세요."],
    ["verification-code-mismatch", 400, "인증번호가 맞지 않아요."],
    ["verification-expired", 400, "인증번호가 만료됐어요. 다시 받아 주세요."],
    ["verification-attempts-exceeded", 429, "인증번호를 다시 받아 주세요."],
    [
      "mail-unavailable",
      503,
      "메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.",
    ],
  ])("maps %s by type", (type, status, text) =>
    expect(
      verificationFailure(
        new ApiError("http", "failed", {
          status,
          problem: { status, type: `urn:fitdining:auth:${type}` },
        }),
      ),
    ).toBe(text),
  );
  it("maps untyped rate limit, field errors and network failures", () => {
    expect(
      verificationFailure(new ApiError("http", "limited", { status: 429 })),
    ).toBe("잠시 후 다시 시도해 주세요.");
    expect(
      verificationFailure(
        new ApiError("http", "bad", {
          status: 400,
          problem: {
            status: 400,
            errors: [
              { field: "code", reason: "인증번호 6자리를 입력해 주세요." },
            ],
          },
        }),
      ),
    ).toBe("인증번호 6자리를 입력해 주세요.");
    expect(verificationFailure(new ApiError("network", "offline"))).toBe(
      "offline",
    );
  });
});
