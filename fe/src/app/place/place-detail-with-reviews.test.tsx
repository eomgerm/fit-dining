// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { takeLoginReturn } from "../login-return";
import { PlaceDetailWithReviews } from "./place-detail-with-reviews";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("../use-bookmark-access", () => ({ useBookmarkAccess: () => ({}) }));
// 장소 상세는 리뷰 자리만 그린다
vi.mock("@/domains/place/ui/place-detail-screen", () => ({
  PlaceDetailScreen: ({
    slots,
  }: {
    slots: {
      reviewTab: (placeId: number) => ReactNode;
      bottomAction: (placeId: number) => ReactNode;
    };
  }) => (
    <>
      {slots.reviewTab(3)}
      {slots.bottomAction(3)}
    </>
  ),
}));
vi.mock("@/domains/review/ui/review-section", () => ({
  ReviewSection: ({ onSignIn }: { onSignIn: () => void }) => (
    <button onClick={onSignIn}>신고 안내의 로그인</button>
  ),
}));
vi.mock("@/domains/review/ui/review-entry-button", () => ({
  ReviewEntryButton: ({ onSignIn }: { onSignIn: () => void }) => (
    <button onClick={onSignIn}>방문 평가 안내의 로그인</button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/place?id=3&from=saved");
});

afterEach(cleanup);

it.each(["신고 안내의 로그인", "방문 평가 안내의 로그인"])(
  "%s은 로그인 화면으로 가고 지금 장소 상세 주소를 남긴다(D-48)",
  (name) => {
    render(<PlaceDetailWithReviews />);

    fireEvent.click(screen.getByRole("button", { name }));

    expect(mocks.push).toHaveBeenCalledWith("/login");
    expect(takeLoginReturn()).toBe("/place?id=3&from=saved");
  },
);
