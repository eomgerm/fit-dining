// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewPhotoStrip } from "./review-photo-viewer";

const embla = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  scrollTo: vi.fn(),
  selectedScrollSnap: vi.fn(() => 0),
  internalEngine: vi.fn(() => ({
    scrollBody: { duration: vi.fn(), useDuration: vi.fn() },
  })),
}));
vi.mock("embla-carousel-react", () => ({ default: () => [vi.fn(), embla] }));

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
});
