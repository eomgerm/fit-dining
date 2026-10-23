import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewSection } from "./review-section";

// 서버 렌더에서는 쿼리가 돌지 않아 처음 불러오는 중 모양이 나온다. 두 모양의 차이만 확인한다
function render(onShowAll?: () => void) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSection placeId={1} onShowAll={onShowAll} />
    </QueryClientProvider>,
  );
}

function skeletonRows(html: string) {
  return html.match(/border-b border-line py-4/g)?.length ?? 0;
}

describe("ReviewSection", () => {
  it("onShowAll이 없으면 리뷰 탭 목록이다: 메뉴·정보 탭과 같은 여백, 자리 표시 5줄", () => {
    const html = render();
    expect(html).toContain("px-4 py-6");
    expect(skeletonRows(html)).toBe(5);
  });

  it("onShowAll이 있으면 홈 미리보기다: 바깥 여백 없음, 자리 표시 3줄", () => {
    const html = render(() => {});
    expect(html).not.toContain("px-4 py-6");
    expect(skeletonRows(html)).toBe(3);
  });
});
