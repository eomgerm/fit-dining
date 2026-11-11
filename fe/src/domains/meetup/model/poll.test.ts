import { describe, expect, it } from "vitest";

import type { MeetupPoll, MeetupProfile } from "./meetup";
import {
  closeConfirmText,
  decisionLine,
  notVotedLine,
  tiedCandidates,
  tieTitle,
  toggleCandidate,
  toward,
  votedLine,
  voterLine,
} from "./poll";

const profile = (id: number, name: string): MeetupProfile => ({
  id,
  name,
  color: id,
  member: false,
  host: id === 1,
  reflected: true,
});
const PROFILES = [
  profile(1, "민지"),
  profile(2, "도윤"),
  profile(3, "하린"),
  profile(4, "서진"),
];
const NAMED: MeetupPoll = {
  state: "OPEN",
  anonymous: false,
  tie: false,
  reopenable: false,
  candidates: [
    { placeId: 10, votes: 2, voters: [1, 2] },
    { placeId: 20, votes: 1, voters: [3] },
  ],
  votedCount: 3,
  notVotedCount: 1,
  notVoted: [4],
};

describe("투표 화면 글", () => {
  it("투표한 수와 아직 투표하지 않은 사람을 말한다", () => {
    expect(votedLine(NAMED)).toBe("4명 중 3명 투표했어요");
    expect(notVotedLine(NAMED, PROFILES)).toBe(
      "아직 서진님이 투표하지 않았어요.",
    );
    expect(voterLine([1, 2], PROFILES)).toBe("민지 · 도윤");
    expect(
      notVotedLine({ ...NAMED, notVoted: undefined }, PROFILES),
    ).toBeUndefined();
  });

  it("마감 확인은 익명 투표면 이름 없이 수만 말한다", () => {
    expect(closeConfirmText(NAMED, PROFILES)).toEqual({
      title: "아직 1명이 투표하지 않았어요",
      description: "지금 마감하면 서진님은 투표할 수 없어요.",
    });
    expect(
      closeConfirmText(
        { ...NAMED, anonymous: true, notVoted: undefined, notVotedCount: 2 },
        PROFILES,
      ),
    ).toEqual({
      title: "아직 2명이 투표하지 않았어요",
      description: "지금 마감하면 남은 사람은 투표할 수 없어요.",
    });
  });

  it("동점 안내는 마감할 때 고정한 표 수로 말한다", () => {
    const tied: MeetupPoll = {
      ...NAMED,
      state: "CLOSED",
      tie: true,
      tieVotes: 2,
      candidates: [
        { placeId: 10, votes: 2 },
        { placeId: 20, votes: 2 },
        { placeId: 30, votes: 0 },
      ],
    };
    expect(tieTitle(tied)).toBe("2곳이 2표로 동점이에요");
    expect(tiedCandidates(tied).map((c) => c.placeId)).toEqual([10, 20]);

    const afterRemoval: MeetupPoll = {
      ...tied,
      candidates: [
        { placeId: 10, votes: 2 },
        { placeId: 20, votes: 1 },
        { placeId: 30, votes: 0 },
      ],
    };
    expect(tieTitle(afterRemoval)).toBe("2표로 동점이에요");
    expect(tiedCandidates(afterRemoval).map((c) => c.placeId)).toEqual([
      10, 20, 30,
    ]);
  });

  it("정한 곳 위 줄은 정한 방법을 말한다", () => {
    expect(
      decisionLine({ placeId: 10, method: "PICK", tieVotes: 2 }, NAMED, "민지"),
    ).toBe("2표씩 동점이라 민지님이 골랐어요");
    expect(decisionLine({ placeId: 10, method: "VOTE" }, NAMED, "민지")).toBe(
      "투표로 정했어요 · 2표",
    );
    expect(
      decisionLine({ placeId: 10, method: "DIRECT" }, undefined, undefined),
    ).toBe("모임장이 정했어요");
  });

  it("장소 이름 뒤에 받침에 맞는 '로'를 붙인다", () => {
    expect(toward("숯불 마당")).toBe("숯불 마당으로");
    expect(toward("바다 횟집")).toBe("바다 횟집으로");
    expect(toward("연기 한 점")).toBe("연기 한 점으로");
    expect(toward("온담 카페")).toBe("온담 카페로");
    expect(toward("하늘")).toBe("하늘로");
    expect(toward("BBQ")).toBe("BBQ로");
  });

  it("투표 후보는 다섯 곳까지 고른다", () => {
    expect(toggleCandidate([1, 2], 2)).toEqual([1]);
    expect(toggleCandidate([1, 2, 3, 4], 5)).toEqual([1, 2, 3, 4, 5]);
    expect(toggleCandidate([1, 2, 3, 4, 5], 6)).toEqual([1, 2, 3, 4, 5]);
  });
});
