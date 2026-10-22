import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewSection } from "./review-section";

// 서버 렌더에서는 쿼리가 돌지 않아 처음 불러오는 중 모양이 나온다. 두 모양의 차이만 확인한다
function render(previewHref?: string) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSection placeId={1} previewHref={previewHref} />
    </QueryClientProvider>,
  );
}

function skeletonRows(html: string) {
  return html.match(/border-b border-line py-4/g)?.length ?? 0;
}

describe("ReviewSection", () => {
  it("previewHref가 없으면 리뷰 탭 목록이다: 제목은 글자이고 자리 표시 5줄", () => {
    const html = render();
    expect(html).not.toContain("<a ");
    expect(skeletonRows(html)).toBe(5);
    expect(html).toContain("pt-4 pb-7");
  });

  it("previewHref가 있으면 홈 미리보기다: 제목이 그 주소 링크이고 자리 표시 3줄", () => {
    const html = render("/place?id=1&tab=review");
    expect(html).toMatch(/<a [^>]*href="\/place\?id=1&amp;tab=review"/);
    expect(skeletonRows(html)).toBe(3);
    expect(html).toContain("py-7");
  });
});
