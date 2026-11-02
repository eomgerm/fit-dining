import { describe, expect, it } from "vitest";

import { ApiError } from "@/shared/api/api-error";

import { deleteFailureMessage, editFailure } from "./edit-failure";

const http = (status: number) => new ApiError("http", "", { status });

describe("editFailure", () => {
  it.each([
    [new ApiError("network", ""), "offline"],
    [new ApiError("timeout", ""), "server"],
    [http(401), "signedOut"],
    [http(404), "notFound"],
    [http(400), "invalid"],
    [
      new ApiError("http", "", {
        status: 400,
        problem: { status: 400, type: "urn:fitdining:review:invalid-photo" },
      }),
      "photo",
    ],
    [http(403), "forbidden"],
    [http(409), "conflict"],
    [http(500), "server"],
    [new Error("boom"), "server"],
  ])("%s는 %s다", (error, kind) => {
    expect(editFailure(error)).toBe(kind);
  });
});

describe("deleteFailureMessage", () => {
  it("이미 지운 리뷰와 그 밖의 실패를 나눠 알린다", () => {
    expect(deleteFailureMessage(http(404))).toBe("이미 삭제된 리뷰예요");
    expect(deleteFailureMessage(http(401))).toBe(
      "로그인이 끝났어요. 다시 로그인해 주세요",
    );
    expect(deleteFailureMessage(new ApiError("network", ""))).toBe(
      "인터넷에 연결되어 있지 않아요",
    );
    expect(deleteFailureMessage(http(500))).toBe("리뷰를 삭제하지 못했어요");
    expect(deleteFailureMessage(http(403))).toBe("리뷰를 삭제하지 못했어요");
  });
});
