import { describe, expect, it } from "vitest";

import { ApiError } from "@/shared/api/api-error";

import { reportFailure } from "./report-failure";

const http = (status: number) => new ApiError("http", "", { status });

describe("reportFailure", () => {
  it.each([
    [http(401), "로그인이 끝났어요. 다시 로그인해 주세요"],
    [http(404), "이미 삭제된 리뷰예요"],
    [http(409), "이미 신고한 리뷰예요"],
    [http(400), "이 리뷰는 신고할 수 없어요"],
  ])("다시 보내도 같은 %s는 알리고 시트를 닫는다", (error, message) => {
    expect(reportFailure(error)).toEqual({ message, close: true });
  });

  it.each([
    [new ApiError("network", ""), "인터넷에 연결되어 있지 않아요"],
    [
      new ApiError("timeout", ""),
      "신고하지 못했어요. 잠시 후 다시 시도해 주세요",
    ],
    [http(500), "신고하지 못했어요. 잠시 후 다시 시도해 주세요"],
    [new Error("boom"), "신고하지 못했어요. 잠시 후 다시 시도해 주세요"],
  ])("다시 보낼 수 있는 %s는 알리고 시트를 둔다", (error, message) => {
    expect(reportFailure(error)).toEqual({ message, close: false });
  });
});
