import { describe, expect, it } from "vitest";

import { highlightParts } from "./highlight";

describe("highlightParts", () => {
  it("입력과 같은 부분을 표시한다", () => {
    expect(highlightParts("하노이 쌀국수 역삼점", "쌀국수")).toEqual([
      { text: "하노이 ", match: false },
      { text: "쌀국수", match: true },
      { text: " 역삼점", match: false },
    ]);
  });

  it("대소문자를 구분하지 않고 앞뒤 공백을 뺀 입력으로 찾는다", () => {
    expect(highlightParts("Cafe ONDAM", " ondam ")).toEqual([
      { text: "Cafe ", match: false },
      { text: "ONDAM", match: true },
    ]);
  });

  it("여러 번 나오면 모두 표시한다", () => {
    expect(highlightParts("라떼와 라떼", "라떼")).toEqual([
      { text: "라떼", match: true },
      { text: "와 ", match: false },
      { text: "라떼", match: true },
    ]);
  });

  it("같은 부분이 없거나 입력이 비면 그대로다", () => {
    expect(highlightParts("카페 온담", "식당")).toEqual([
      { text: "카페 온담", match: false },
    ]);
    expect(highlightParts("카페 온담", " ")).toEqual([
      { text: "카페 온담", match: false },
    ]);
  });
});
