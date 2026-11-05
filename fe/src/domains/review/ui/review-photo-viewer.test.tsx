// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { ReviewPhotoStrip } from "./review-photo-viewer";

const embla = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  destroy: vi.fn(),
  scrollTo: vi.fn(),
  selectedScrollSnap: vi.fn(() => 0),
  internalEngine: vi.fn(() => ({
    scrollBody: { duration: vi.fn(), useDuration: vi.fn() },
  })),
}));
vi.mock("embla-carousel", () => ({ default: () => embla }));

const photos = [1, 2].map((n) => ({
  photoId: `p${n}`,
  url: `/photos/p${n}.jpg`,
  thumbUrl: `/photos/p${n}.thumb.jpg`,
}));

afterEach(cleanup);

describe("ReviewPhotoStrip 크게 보기", () => {
  it("창 이름 '사진'은 화면 낭독기에만 남기고 화면에는 보이지 않는다(D-54)", () => {
    render(<ReviewPhotoStrip photos={photos} label="밤산책의 리뷰" />);

    fireEvent.click(screen.getByRole("button", { name: "사진 2/2 크게 보기" }));

    const dialog = screen.getByRole("dialog", { name: "사진" });
    expect(screen.getByText("사진").className).toContain("sr-only");
    expect(dialog.querySelector('img[alt="사진 2/2"]')).toBeTruthy();
  });

  it("닫히는 페이드 동안 보던 사진이 창과 함께 남는다", () => {
    // jsdom에는 getAnimations가 없어 Base UI가 닫힘을 기다리지 않고 바로 지운다. 있으면 다음 프레임까지 남긴다
    Element.prototype.getAnimations = () => [];
    onTestFinished(() => {
      delete (Element.prototype as Partial<Element>).getAnimations;
    });
    render(<ReviewPhotoStrip photos={photos} label="밤산책의 리뷰" />);
    fireEvent.click(screen.getByRole("button", { name: "사진 2/2 크게 보기" }));

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog.hasAttribute("data-ending-style")).toBe(true);
    expect(dialog.querySelector('img[alt="사진 2/2"]')).toBeTruthy();
  });
});
