import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ReviewItem } from "../model/review";
import { ReviewListView, type ReviewListViewProps } from "./review-list-view";

const noop = () => {};

const items: ReviewItem[] = [
  {
    reviewId: 2,
    createdAt: "2026-10-20T15:00:00+09:00",
    visitedAt: "2026-10-12",
    nickname: "밤산책",
    revisitIntent: true,
    tags: [
      { code: "QUIET_GOOD", label: "조용해서 좋았어요", sentiment: "GOOD" },
      { code: "SHORT_WAIT_BAD", label: "대기가 길었어요", sentiment: "BAD" },
    ],
    description: "국물이 진해요",
    photos: [],
    mine: false,
  },
  {
    reviewId: 1,
    createdAt: "2026-10-19T09:00:00+09:00",
    visitedAt: "2026-10-10",
    nickname: "라테한잔",
    revisitIntent: false,
    tags: [],
    photos: [],
    mine: false,
  },
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
    expect(html).not.toContain('/review"');
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

  it("홈 탭 미리보기는 리뷰가 없으면 개수 없이 리뷰만 쓴다(6-E01)", () => {
    const html = render({ totalCount: 0, onShowAll: noop });
    expect(html).toContain("아직 리뷰가 없어요");
    expect(html).not.toContain(">0</span>");
  });

  it("항목은 닉네임, 재방문 의사, 방문일, 태그, 본문을 보인다(6-03)", () => {
    const html = render({ totalCount: 2, items });
    expect(html).toContain(">2</span>");
    expect(html).toContain("밤산책");
    expect(html.match(/재방문 의사 있어요/g)).toHaveLength(1);
    expect(html).toMatch(
      /<time datetime="2026-10-12"[^>]*>10월 12일 방문<\/time>/i,
    );
    expect(html).not.toContain("작성</time>");
    expect(html).toContain("국물이 진해요");
  });

  it("좋았어요 태그는 강조 태그, 아쉬웠어요 태그는 '아쉬움'을 앞에 붙인다", () => {
    const html = render({ totalCount: 2, items });
    expect(html).toMatch(/text-primary-strong[^"]*">조용해서 좋았어요/);
    expect(html).toMatch(
      /<span class="text-label-sm">아쉬움<span class="sr-only"> <\/span><\/span>대기가 길었어요/,
    );
  });

  it("내 리뷰는 닉네임 옆에 '내 리뷰' 태그를 붙이고, 탈퇴한 회원의 리뷰는 '탈퇴한 회원'으로 보인다", () => {
    const html = render({
      totalCount: 2,
      items: [
        { ...items[0], mine: true },
        { ...items[1], nickname: undefined },
      ],
    });
    expect(html).toMatch(/밤산책<\/p><span class="[^"]*">내 리뷰<\/span>/);
    expect(html.match(/>내 리뷰</g)).toHaveLength(1);
    expect(html).toContain("탈퇴한 회원");
  });

  it("사진이 있으면 썸네일 줄을 보이고 누르면 크게 보도록 번호를 붙인다(6-03)", () => {
    const photos = ["p1", "p2"].map((photoId) => ({
      photoId,
      url: `/photos/dev/confirmed/${photoId}.jpg`,
      thumbUrl: `/photos/dev/confirmed/${photoId}.thumb.jpg`,
    }));
    const html = render({ totalCount: 1, items: [{ ...items[0], photos }] });

    expect(html).toContain('aria-label="밤산책의 10월 12일 방문 리뷰 사진"');
    expect(html).toContain('src="/photos/dev/confirmed/p1.thumb.jpg"');
    expect(html).toContain('aria-label="사진 2/2 크게 보기"');
    expect(html).not.toContain('src="/photos/dev/confirmed/p1.jpg"');
  });

  it("사진만 있는 리뷰에는 내용 없음 안내를 보이지 않는다", () => {
    const photo = { photoId: "p1", url: "/p1.jpg", thumbUrl: "/p1.thumb.jpg" };
    expect(
      render({ totalCount: 1, items: [{ ...items[1], photos: [photo] }] }),
    ).not.toContain("내용 없이 남긴 리뷰예요");
  });

  it("본문이 없으면 태그도 없는 예전 리뷰에만 안내 문구를 보인다", () => {
    const withTags = { ...items[0], description: undefined };
    expect(render({ totalCount: 1, items: [withTags] })).not.toContain(
      "내용 없이 남긴 리뷰예요",
    );
    expect(render({ totalCount: 1, items: [items[1]] })).toContain(
      "내용 없이 남긴 리뷰예요",
    );
  });

  it("리뷰 탭은 머리글 오른쪽에 누를 수 없는 '최신순'을 둔다", () => {
    const html = render({ totalCount: 2, items });
    expect(html).toMatch(/<span[^>]*>최신순<\/span>/);
    expect(html).not.toMatch(/<button[^>]*>최신순/);
    expect(render({ totalCount: 0 })).not.toContain("최신순");
  });

  it("본문은 HTML로 해석하지 않는다", () => {
    const html = render({
      totalCount: 1,
      items: [{ ...items[0], description: "<b>굵게</b>" }],
    });
    expect(html).toContain("&lt;b&gt;굵게&lt;/b&gt;");
  });

  it("onShowAll이 있으면 머리글 '리뷰 N >' 전체가 버튼이다(홈 미리보기 6-01)", () => {
    const html = render({ totalCount: 12, items, onShowAll: noop });
    expect(html).toMatch(
      /<h2><button type="button"[^>]*>리뷰<span[^>]*>12<\/span><svg/,
    );
    expect(html).not.toContain("전체 보기");
    expect(html).not.toContain("최신순");
    expect(html).not.toContain("<a ");
  });

  it("onShowAll이 있어도 리뷰가 없거나 불러오는 중이면 머리글이 버튼이 아니다", () => {
    expect(render({ totalCount: 0, onShowAll: noop })).not.toContain("<button");
    expect(render({ status: "pending", onShowAll: noop })).not.toContain(
      "<h2><button",
    );
  });

  it("onShowAll이 없으면 머리글은 버튼이 아니다(리뷰 탭)", () => {
    expect(render({ totalCount: 2, items })).not.toContain("<h2><button");
  });

  it("수정·삭제를 넘기면 내 리뷰에만 방문일로 구분되는 ⋯ 메뉴를 둔다(6-06)", () => {
    const html = render({
      totalCount: 2,
      items: [{ ...items[0], mine: true }, items[1]],
      onEdit: noop,
      onDelete: noop,
    });
    expect(html.match(/aria-label="[^"]*리뷰 메뉴"/g)).toEqual([
      'aria-label="10월 12일 방문 리뷰 메뉴"',
    ]);
  });

  it("신고를 넘기면 남의 리뷰에 작성자와 방문일로 구분되는 ⋯ 메뉴를 둔다(6-10)", () => {
    const html = render({
      totalCount: 3,
      items: [
        { ...items[0], mine: true },
        items[1],
        { ...items[1], reviewId: 3, nickname: undefined },
      ],
      onEdit: noop,
      onDelete: noop,
      onReport: noop,
    });
    expect(html.match(/aria-label="[^"]*리뷰 메뉴"/g)).toEqual([
      'aria-label="10월 12일 방문 리뷰 메뉴"',
      'aria-label="라테한잔의 10월 10일 방문 리뷰 메뉴"',
      'aria-label="탈퇴한 회원의 10월 10일 방문 리뷰 메뉴"',
    ]);
  });

  it("수정·삭제를 넘기지 않으면 ⋯ 메뉴가 없다", () => {
    const html = render({
      totalCount: 1,
      items: [{ ...items[0], mine: true }],
    });
    expect(html).not.toContain("리뷰 메뉴");
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
