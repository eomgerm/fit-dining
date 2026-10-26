import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToastProvider } from "@/shared/ui/overlay/toast";

import { SimpleReviewForm } from "./simple-review-form";

function render() {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <SimpleReviewForm
          placeId={1}
          withAccessToken={(send) => send("token")}
          onSuccess={() => {}}
          onClose={() => {}}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("SimpleReviewForm", () => {
  it("본문 입력칸은 500자까지만 받고 글자 수를 보인다", () => {
    const html = render();
    expect(html).toMatch(/<textarea[^>]*maxLength="500"/i);
    expect(html).toContain("0/500");
  });

  it("등록하기는 폼을 제출하는 버튼이다", () => {
    expect(render()).toMatch(/<button type="submit"[^>]*>등록하기<\/button>/);
  });

  it("닫기 버튼과 화면 제목이 있다", () => {
    const html = render();
    expect(html).toContain('aria-label="닫기"');
    expect(html).toContain("방문 평가");
  });
});
