import { describe, expect, it } from "vitest";

import { missingEvidenceNotes } from "./place-labels";

describe("missingEvidenceNotes", () => {
  it("점수에 넣지 못한 항목마다 출처에 맞춘 안내를 만든다", () => {
    expect(
      missingEvidenceNotes([
        {
          source: "REQUEST",
          label: "대화하기 좋은",
          matched: true,
          evidenceCount: 12,
        },
        {
          source: "PREFERENCE",
          label: "아늑한 곳",
          matched: false,
          evidenceCount: 0,
        },
        { source: "REQUEST", label: "주차", matched: false, evidenceCount: 1 },
      ]),
    ).toEqual([
      "이 장소는 ‘아늑한 곳’ 취향을 확인할 근거가 부족해요",
      "이 장소는 ‘주차’ 요청을 확인할 근거가 부족해요",
    ]);
  });

  it("모두 반영됐으면 안내가 없다", () => {
    expect(
      missingEvidenceNotes([
        { source: "REQUEST", label: "조용한", matched: true, evidenceCount: 3 },
      ]),
    ).toEqual([]);
  });
});
