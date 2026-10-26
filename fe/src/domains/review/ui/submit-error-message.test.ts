import { describe, expect, it } from "vitest";

import { ApiError } from "@/shared/api/api-error";

import { submitErrorMessage } from "./submit-error-message";

describe("submitErrorMessage", () => {
  it("연결 실패와 시간 초과는 연결을 확인하라고 한다", () => {
    expect(submitErrorMessage(new ApiError("network", "x"))).toContain(
      "인터넷 연결",
    );
    expect(submitErrorMessage(new ApiError("timeout", "x"))).toContain(
      "인터넷 연결",
    );
  });

  it("400은 입력을 확인하라고 한다", () => {
    expect(submitErrorMessage(new ApiError("http", "x", { status: 400 }))).toBe(
      "입력한 내용을 확인해 주세요.",
    );
  });

  it("401은 다시 로그인하라고 하고 입력이 남아 있다고 한다", () => {
    const message = submitErrorMessage(
      new ApiError("http", "x", { status: 401 }),
    );
    expect(message).toContain("다시 로그인");
    expect(message).toContain("입력한 내용은 그대로");
  });

  it("409는 AC-13 문구로 이 날짜에 이미 리뷰를 남겼다고 한다", () => {
    expect(submitErrorMessage(new ApiError("http", "x", { status: 409 }))).toBe(
      "이 날짜에는 이미 리뷰를 남겼어요.",
    );
  });

  it("5xx와 알 수 없는 오류는 잠시 후 다시 시도하라고 한다", () => {
    expect(
      submitErrorMessage(new ApiError("http", "x", { status: 503 })),
    ).toContain("잠시 후");
    expect(submitErrorMessage(new Error("x"))).toContain("잠시 후");
  });
});
