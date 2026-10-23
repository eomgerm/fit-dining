import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ReviewItem } from "../model/review";
import { ReviewListView, type ReviewListViewProps } from "./review-list-view";

const noop = () => {};

const items: ReviewItem[] = [
  {
    reviewId: 2,
    createdAt: "2026-10-20T15:00:00+09:00",
    description: "국물이 진해요",
  },
  { reviewId: 1, createdAt: "2026-10-19T09:00:00+09:00" },
];

function render(props: Partial<ReviewListViewProps>) {
  return renderToStaticMarkup(
    <ReviewListView status="success" items={[]} onRetry={noop} {...props} />,
  );
}

describe("ReviewListView", () => {
  it("작성 버튼은 그리지 않는다. 장소 상세 하단 막대가 맡는다", () => {
    const html = render({ totalCount: 2, items });
    expect(html).not.toContain("방문 평가 남기기");
    expect(html).not.toContain("/place/review");
  });

  it("불러오는 중에는 자리 표시만 보이고 개수는 없다", () => {
    const html = render({ status: "pending", totalCount: 3 });
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(">3<");
  });

  it("불러오지 못하면 다시 시도 버튼을 보인다", () => {
    const html = render({ status: "error" });
    expect(html).toContain("리뷰를 불러오지 못했어요");
    expect(html).toContain("다시 시도");
  });

  it("리뷰가 없으면 리뷰 0과 빈 상태 안내를 보인다(6-E03)", () => {
    const html = render({ totalCount: 0 });
    expect(html).toContain(">0</span>");
    expect(html).toContain("아직 리뷰가 없어요");
    expect(html).not.toContain("<ul");
  });

  it("항목은 작성일과 본문을 보이고, 본문이 없으면 안내 문구를 보인다", () => {
    const html = render({ totalCount: 2, items });
    expect(html).toContain(">2</span>");
    expect(html).toMatch(
      /<time datetime="2026-10-20T15:00:00\+09:00"[^>]*>10월 20일 작성<\/time>/i,
    );
    expect(html).toContain("국물이 진해요");
    expect(html).toContain("내용 없이 남긴 리뷰예요");
  });

  it("본문은 HTML로 해석하지 않는다", () => {
    const html = render({
      totalCount: 1,
      items: [{ ...items[0], description: "<b>굵게</b>" }],
    });
    expect(html).toContain("&lt;b&gt;굵게&lt;/b&gt;");
  });

  it("onShowAll이 있으면 머리글에 전체 보기 버튼을 둔다(홈 미리보기)", () => {
    const html = render({ totalCount: 12, items, onShowAll: noop });
    expect(html).toMatch(/<button[^>]*>전체 보기<\/button>/);
    expect(html).not.toContain("<a ");
  });

  it("onShowAll이 있어도 리뷰가 없거나 불러오는 중이면 전체 보기를 숨긴다", () => {
    expect(render({ totalCount: 0, onShowAll: noop })).not.toContain(
      "전체 보기",
    );
    expect(render({ status: "pending", onShowAll: noop })).not.toContain(
      "전체 보기",
    );
  });

  it("onShowAll이 없으면 전체 보기가 없다(리뷰 탭)", () => {
    expect(render({ totalCount: 2, items })).not.toContain("전체 보기");
  });

  it("다음 페이지를 받는 중이면 자리 표시 한 줄을 더 보인다", () => {
    const html = render({
      totalCount: 21,
      items,
      hasNextPage: true,
      isFetchingNextPage: true,
    });
    expect(html).toContain('aria-busy="true"');
  });

  it("다음 페이지가 실패하면 받은 목록은 두고 다시 불러오기 버튼을 보인다", () => {
    const html = render({
      totalCount: 21,
      items,
      hasNextPage: true,
      isFetchNextPageError: true,
    });
    expect(html).toContain("국물이 진해요");
    expect(html).toContain("다시 불러오기");
  });
});
