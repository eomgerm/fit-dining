import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormTag } from "../model/review";
import { DetailFields, PlaceRow, ReasonTagGroups } from "./review-write-parts";

const tags: FormTag[] = [
  {
    code: "QUIET_GOOD",
    label: "조용해서 좋았어요",
    group: "NOISE",
    displayGroup: "분위기",
  },
  {
    code: "LIVELY_GOOD",
    label: "활기차서 좋았어요",
    group: "NOISE",
    displayGroup: "분위기",
  },
  {
    code: "SHORT_WAIT_GOOD",
    label: "바로 들어갔어요",
    group: "SHORT_WAIT",
    displayGroup: "이용",
  },
];

const count = (html: string, text: string) => html.split(text).length - 1;

describe("ReasonTagGroups", () => {
  it("화면 묶음마다 이름과 칩을 보이고 고른 칩과 막힌 칩을 표시한다", () => {
    const html = renderToStaticMarkup(
      <ReasonTagGroups
        tags={tags}
        selected={["QUIET_GOOD"]}
        disabled={new Set(["LIVELY_GOOD"])}
        onToggle={() => {}}
      />,
    );

    expect(html).toContain('aria-label="분위기"');
    expect(html).toContain('aria-label="이용"');
    expect(count(html, 'aria-pressed="true"')).toBe(1);
    expect(count(html, 'data-disabled=""')).toBe(1);
    expect(html).toMatch(
      /data-disabled=""[^<]*>(<svg.*?<\/svg>)?활기차서 좋았어요/,
    );
  });
});

describe("DetailFields", () => {
  function render(revisitIntent: boolean) {
    return renderToStaticMarkup(
      <DetailFields
        revisitIntent={revisitIntent}
        description=""
        spentPerPerson="15000"
        limits={{
          descriptionMax: 500,
          photoMax: 5,
          spentPerPersonMax: 1_000_000,
        }}
        onRevisitIntentChange={() => {}}
        onDescriptionChange={() => {}}
        onSpentPerPersonChange={() => {}}
        onAddPhoto={() => {}}
      />,
    );
  }

  it("와이어프레임 문구와 입력칸을 그대로 보인다", () => {
    const html = render(false);

    expect(html).toContain("또 오고 싶다면?");
    expect(html).toContain("비슷한 취향의 장소를 찾아드릴게요.");
    expect(html).toContain("재방문 의사 있어요");
    expect(html).toContain("0/500");
    expect(html).toContain("최대 5장");
    expect(html).toContain("추가");
    expect(html).toContain('value="15,000"');
    expect(html).toContain("원");
    expect(html).toContain("추천이나 화면에는 쓰지 않아요.");
  });

  it("재방문 의사를 누른 상태를 보인다", () => {
    expect(render(false)).toContain('aria-pressed="false"');
    expect(render(true)).toContain('aria-pressed="true"');
  });
});

describe("PlaceRow", () => {
  const place = {
    name: "카페 온담",
    categoryGroup: "CAFE",
    station: "YEOKSAM",
  };

  it("대표 사진이 없으면 기본 이미지를 그린다", () => {
    const html = renderToStaticMarkup(<PlaceRow place={place} />);
    expect(html).toContain("카페 온담");
    expect(html).not.toContain("<img");
    expect(html).toContain("bg-linear-to-br");
  });

  it("대표 사진이 있으면 그 사진을 보인다", () => {
    const html = renderToStaticMarkup(
      <PlaceRow
        place={{ ...place, thumbnailUrl: "https://example.com/a.jpg" }}
      />,
    );
    expect(html).toContain('src="https://example.com/a.jpg"');
  });
});
