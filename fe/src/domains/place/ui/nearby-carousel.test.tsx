// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlaceCard, ScoreItem } from "../model/place-types";
import { NearbyCarousel } from "./nearby-carousel";

// 칸 배치와 스와이프는 Carousel 쪽 일이라 여기서는 칸만 그린다
vi.mock("@/shared/ui/display/carousel", () => ({
  Carousel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

const card: PlaceCard = {
  place: {
    id: 1,
    name: "카페 온담",
    categoryGroup: "CAFE",
    station: "YEOKSAM",
    lat: 37.5,
    lng: 127.03,
  },
  score: 84,
  labels: ["조용해요", "넓어요"],
  openStatus: "OPEN",
  reasons: [],
  scoreItems: [],
};

const item = (label: string, matched: boolean): ScoreItem => ({
  source: "PREFERENCE",
  label,
  matched,
  evidenceCount: 3,
});

function renderCarousel(data: PlaceCard) {
  render(
    <NearbyCarousel
      cards={[data]}
      selectedId={data.place.id}
      onSelect={() => {}}
      onOpen={() => {}}
    />,
  );
}

// 강조색 태그는 bg-primary-soft(Tag variant="match")다
const highlighted = (text: string) =>
  screen.getByText(text).className.includes("bg-primary-soft");

describe("NearbyCarousel 태그 색", () => {
  it("matched인 scoreItems와 문구가 같은 태그만 강조색이다", () => {
    renderCarousel({
      ...card,
      labels: ["조용해요", "넓어요"],
      scoreItems: [item("넓어요", true), item("조용해요", false)],
    });

    expect(highlighted("넓어요")).toBe(true);
    expect(highlighted("조용해요")).toBe(false);
  });

  it("첫 태그라도 맞은 조건이 아니면 회색이다", () => {
    renderCarousel({
      ...card,
      labels: ["역삼역", "조용해요"],
      scoreItems: [item("조용해요", true)],
    });

    expect(highlighted("역삼역")).toBe(false);
    expect(highlighted("조용해요")).toBe(true);
  });

  it("scoreItems가 비면 두 태그 모두 회색이다", () => {
    renderCarousel(card);

    expect(highlighted("조용해요")).toBe(false);
    expect(highlighted("넓어요")).toBe(false);
  });

  it("태그는 labels를 받은 순서 그대로 보인다", () => {
    renderCarousel({
      ...card,
      labels: ["역삼역", "조용해요"],
      scoreItems: [item("조용해요", true)],
    });

    const tags = ["역삼역", "조용해요"].map((text) => screen.getByText(text));
    expect(
      tags[0].compareDocumentPosition(tags[1]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
