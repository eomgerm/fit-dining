import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("우리 글자 스타일과 글자색을 둘 다 남긴다", () => {
    expect(cn("text-button-lg", "text-on-primary")).toBe(
      "text-button-lg text-on-primary",
    );
  });

  it("같은 종류가 겹치면 뒤의 것만 남긴다", () => {
    expect(cn("text-ink", "text-danger")).toBe("text-danger");
    expect(cn("text-body-md", "text-title-sm")).toBe("text-title-sm");
    expect(cn("shadow-1", "shadow-pin")).toBe("shadow-pin");
  });

  it("그림자 크기와 그림자 색은 서로 지우지 않는다", () => {
    expect(cn("shadow-2", "shadow-ink")).toBe("shadow-2 shadow-ink");
  });

  it("조건부 클래스를 받는다", () => {
    expect(cn("w-full", false && "mt-4", undefined)).toBe("w-full");
  });
});
