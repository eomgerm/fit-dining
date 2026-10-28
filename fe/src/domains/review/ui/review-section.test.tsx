import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToastProvider } from "@/shared/ui/overlay/toast";

import {
  reviewKeys,
  type WithAccessToken,
  type WithOptionalAccessToken,
} from "../api/queries";
import type { ReviewListResponse } from "../model/review";
import { ReviewSection } from "./review-section";

const anonymous: WithOptionalAccessToken = (send) => send();
const withAccessToken: WithAccessToken = (send) => send("token");

// 서버 렌더에서는 쿼리가 돌지 않아 처음 불러오는 중 모양이 나온다. 두 모양의 차이만 확인한다
function render(onShowAll?: () => void) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <ReviewSection
          placeId={1}
          onShowAll={onShowAll}
          withOptionalAccessToken={anonymous}
          withAccessToken={withAccessToken}
          onEdit={() => {}}
        />
      </ToastProvider>
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

  it("리뷰 수는 첫 페이지 응답에서 읽는다. 다음 페이지 응답에는 리뷰 수가 없다", () => {
    const client = new QueryClient();
    const item = (reviewId: number) => ({
      reviewId,
      createdAt: "2026-10-21T12:00:00+09:00",
      visitedAt: "2026-10-21",
      nickname: "밤산책",
      revisitIntent: false,
      tags: [],
      mine: false,
    });
    const pages: ReviewListResponse[] = [
      { totalCount: 21, items: [item(2)], nextCursor: "next" },
      { items: [item(1)] },
    ];
    client.setQueryData(reviewKeys.list(1), {
      pages,
      pageParams: [undefined, "next"],
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ReviewSection
            placeId={1}
            withOptionalAccessToken={anonymous}
            withAccessToken={withAccessToken}
            onEdit={() => {}}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(html).toContain('<span class="text-ink-muted">21</span>');
  });
});
