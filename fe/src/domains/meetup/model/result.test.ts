import { describe, expect, it } from "vitest";

import type { MeetupInfo, MeetupProfile } from "./meetup";
import {
  conditionChips,
  distanceText,
  fitLine,
  menuText,
  openStatusLabel,
  reasonChips,
  topic,
} from "./result";

const INFO: MeetupInfo = {
  area: { kind: "STATION", name: "선릉" },
  category: "RESTAURANT",
  date: "2026-11-14",
  time: "19:00",
};

function profile(id: number, name: string): MeetupProfile {
  return { id, name, color: id, member: false, host: false, reflected: true };
}

const PROFILES = [profile(1, "민지"), profile(2, "도윤"), profile(3, "하린")];

describe("결과 문구", () => {
  it("조건 칩은 지역, 업종, 모임 시각, 합친 취향 순서다", () => {
    expect(
      conditionChips(INFO, {
        mood: "QUIET",
        likeFoods: ["KOREAN", "WESTERN"],
        wantMenus: ["곱창"],
        noSpicy: true,
      }),
    ).toEqual([
      "선릉역",
      "식당",
      "토 저녁 7시 영업",
      "조용한 곳",
      "한식·양식 선호",
      "곱창 원해요",
      "매운 음식 덜 추천",
    ]);
  });

  it("상관없음 업종과 시각이 없는 모임은 그 칩이 없다", () => {
    expect(
      conditionChips(
        { ...INFO, category: "ANY", date: undefined, time: undefined },
        {},
      ),
    ).toEqual(["선릉역"]);
  });

  it("받침에 따라 은과 는을 붙인다", () => {
    expect(topic("곱창")).toBe("곱창은");
    expect(topic("파스타")).toBe("파스타는");
    expect(topic("pho")).toBe("pho은");
  });

  it("잘 맞는 사람 줄은 모두, 반영된 수, 대체로를 구분한다", () => {
    expect(fitLine({ kind: "ALL", fitProfileIds: [1, 2] }, PROFILES)).toEqual({
      people: [PROFILES[0], PROFILES[1]],
      text: "모두에게 잘 맞아요",
      misfit: false,
    });
    expect(
      fitLine({ kind: "COUNT", fitProfileIds: [1, 2, 3] }, PROFILES).text,
    ).toBe("3명에게 잘 맞아요");
    expect(fitLine({ kind: "MOSTLY", fitProfileIds: [1] }, PROFILES).text).toBe(
      "대체로 잘 맞아요",
    );
  });

  it("덜 맞는 사람이 원한 메뉴를 팔지 않으면 그 메뉴를 말한다", () => {
    expect(
      fitLine(
        {
          kind: "MISFIT",
          fitProfileIds: [1, 3],
          misfitProfileIds: [2],
          missedMenus: [{ profileId: 2, menu: "곱창" }],
        },
        PROFILES,
      ),
    ).toEqual({
      people: [PROFILES[1]],
      text: "도윤님이 원한 곱창은 아니에요",
      misfit: true,
    });
    expect(
      fitLine(
        { kind: "MISFIT", fitProfileIds: [2], misfitProfileIds: [1, 3] },
        PROFILES,
      ).text,
    ).toBe("민지님, 하린님 취향과는 조금 달라요");
  });

  it("영업 상태는 모임 시각이 있으면 그 시각, 없으면 지금 기준이다", () => {
    expect(openStatusLabel("OPEN", INFO)).toBe("저녁 7시 영업");
    expect(openStatusLabel("CLOSED", INFO)).toBe("저녁 7시 영업 안 해요");
    expect(openStatusLabel("OPEN", { ...INFO, time: undefined })).toBe(
      "영업 중",
    );
    expect(openStatusLabel("UNKNOWN", INFO)).toBeNull();
  });

  it("추천 이유 칩은 근거 이름을 겹치지 않게 두 개까지다", () => {
    expect(
      reasonChips([
        {
          title: "a",
          tags: [
            { source: "REQUEST", label: "모임하기 좋아요" },
            { source: "REQUEST", label: "대화하기 좋아요" },
          ],
        },
        { title: "b", tags: [{ source: "REQUEST", label: "모임하기 좋아요" }] },
        { title: "c", tags: [{ source: "PREFERENCE", label: "넓어요" }] },
      ]),
    ).toEqual(["모임하기 좋아요", "대화하기 좋아요"]);
  });

  it("메뉴와 거리를 카드 글로 바꾼다", () => {
    expect(menuText({ name: "숙성 삼겹살", price: 16000 })).toBe(
      "숙성 삼겹살 16,000원",
    );
    expect(menuText({ name: "오마카세" })).toBe("오마카세");
    expect(distanceText({ station: "선릉역", walkMinutes: 4 })).toBe(
      "도보 4분",
    );
    expect(distanceText({ meters: 1250 })).toBe("1.3km");
    expect(distanceText(undefined)).toBeNull();
  });
});
