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
});
