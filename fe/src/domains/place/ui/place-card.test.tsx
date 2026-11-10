// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PlaceCard as PlaceCardData } from "../model/place-types";
import { PlaceCard } from "./place-card";

afterEach(cleanup);

const card: PlaceCardData = {
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

function renderCard(data: PlaceCardData) {
  render(
    <PlaceCard card={data} rank={1} selected={false} onPress={() => {}} />,
  );
}

describe("PlaceCard", () => {
  it("점수가 있으면 핏 점수를 그린다", () => {
    renderCard(card);

    expect(screen.getByText("84")).toBeTruthy();
    expect(screen.getByText("핏 점수")).toBeTruthy();
  });

  it("점수가 없으면 핏 점수를 그리지 않고 나머지 정보는 그대로 그린다", () => {
    renderCard({ ...card, score: undefined });

    expect(screen.queryByText("핏 점수")).toBeNull();
    expect(screen.getByText("카페 온담")).toBeTruthy();
    expect(screen.getByText("조용해요")).toBeTruthy();
  });

  // 강조색 태그는 bg-primary-soft(Tag variant="match")다
  const highlighted = (text: string) =>
    screen.getByText(text).className.includes("bg-primary-soft");

  it("이번 검색에서 맞은 조건 태그에만 강조색을 칠한다", () => {
    renderCard({
      ...card,
      labels: ["작업하기 좋아요", "조용해요"],
      scoreItems: [
        {
          source: "REQUEST",
          label: "작업하기 좋아요",
          matched: true,
          evidenceCount: 7,
        },
        {
          source: "PREFERENCE",
          label: "조용해요",
          matched: false,
          evidenceCount: 1,
        },
      ],
    });

    expect(highlighted("작업하기 좋아요")).toBe(true);
    expect(highlighted("조용해요")).toBe(false);
  });

  it("맞은 조건이 없으면 첫 태그도 회색이다", () => {
    renderCard(card);

    expect(highlighted("조용해요")).toBe(false);
    expect(highlighted("넓어요")).toBe(false);
  });

  it("주의점이 있어도 카드에는 그리지 않는다", () => {
    renderCard({ ...card, caution: "주말엔 웨이팅이 길어요" });

    expect(screen.queryByText("주말엔 웨이팅이 길어요")).toBeNull();
  });
});
