import { describe, expect, it } from "vitest";

import { ApiError } from "@/shared/api/api-error";

import { submitFailure } from "./submit-failure";

const http = (status: number) => new ApiError("http", "x", { status });

describe("submitFailure", () => {
  it("연결이 끊기면 7-E06, 시간 초과와 5xx는 7-E05다", () => {
    expect(submitFailure(new ApiError("network", "x"))).toBe("offline");
    expect(submitFailure(new ApiError("timeout", "x"))).toBe("server");
    expect(submitFailure(http(500))).toBe("server");
    expect(submitFailure(http(503))).toBe("server");
  });

  it("409는 이미 쓴 날짜, 401은 로그인이 끝난 것이다", () => {
    expect(submitFailure(http(409))).toBe("duplicate");
    expect(submitFailure(http(401))).toBe("signedOut");
  });

  it("그 밖의 4xx는 입력 확인, 알 수 없는 오류는 7-E05다", () => {
    expect(submitFailure(http(400))).toBe("invalid");
    expect(submitFailure(http(404))).toBe("invalid");
    expect(submitFailure(new Error("x"))).toBe("server");
  });
});
