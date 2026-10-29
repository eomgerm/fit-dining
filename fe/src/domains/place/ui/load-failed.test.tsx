import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/shared/api/api-error";

import { LoadFailed } from "./load-failed";

describe("LoadFailed", () => {
  it("서버 오류는 경고 색, 연결 실패는 회색 아이콘으로 보여 준다", () => {
    const server = renderToStaticMarkup(
      <LoadFailed
        error={new ApiError("http", "500", { status: 500 })}
        title="추천을 불러오지 못했어요"
        onRetry={() => {}}
      />,
    );
    expect(server).toContain("bg-warning-soft");

    const offline = renderToStaticMarkup(
      <LoadFailed
        error={new ApiError("network", "offline")}
        title="추천을 불러오지 못했어요"
        onRetry={() => {}}
      />,
    );
    expect(offline).not.toContain("bg-warning-soft");
    expect(offline).toContain("bg-surface-sunken");
  });
});
