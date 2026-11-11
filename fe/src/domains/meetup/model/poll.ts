// 투표와 정한 곳의 화면 글(화면 예시의 투표, 동점, 정한 곳)
import {
  POLL_CANDIDATES_MAX,
  type MeetupDecision,
  type MeetupPoll,
  type MeetupProfile,
} from "./meetup";

function names(ids: number[], profiles: MeetupProfile[]) {
  return ids
    .map((id) => profiles.find((profile) => profile.id === id)?.name)
    .filter((name): name is string => !!name);
}

// "민지님, 도윤님"
function honorific(ids: number[], profiles: MeetupProfile[]) {
  return names(ids, profiles)
    .map((name) => `${name}님`)
    .join(", ");
}

// 후보 칸의 고른 사람. "민지 · 도윤"
export function voterLine(
  ids: number[] | undefined,
  profiles: MeetupProfile[],
) {
  return names(ids ?? [], profiles).join(" · ");
}

export function anonymityLine(poll: MeetupPoll) {
  return poll.anonymous ? "익명 투표예요" : "이름이 보이는 투표예요";
}

// "4명 중 3명 투표했어요"
export function votedLine(poll: MeetupPoll) {
  return `${poll.votedCount + poll.notVotedCount}명 중 ${poll.votedCount}명 투표했어요`;
}

// 이름이 보이는 투표에서 아직 투표하지 않은 사람. 익명이거나 모두 투표했으면 없다
export function notVotedLine(poll: MeetupPoll, profiles: MeetupProfile[]) {
  const who = honorific(poll.notVoted ?? [], profiles);
  return who ? `아직 ${who}이 투표하지 않았어요.` : undefined;
}

// 아직 투표하지 않은 사람이 있을 때 마감 전에 묻는 글(AC-44). 익명 투표면 이름 없이 수만 말한다
export function closeConfirmText(poll: MeetupPoll, profiles: MeetupProfile[]) {
  const who = honorific(poll.notVoted ?? [], profiles);
  return {
    title: `아직 ${poll.notVotedCount}명이 투표하지 않았어요`,
    description: who
      ? `지금 마감하면 ${who}은 투표할 수 없어요.`
      : "지금 마감하면 남은 사람은 투표할 수 없어요.",
  };
}

// 동점으로 마감할 때의 후보. 마감 뒤 프로필이 지워져 표가 줄었으면 모든 후보를 표 순서로 보인다
export function tiedCandidates(poll: MeetupPoll) {
  const tied = poll.candidates.filter(
    (candidate) => candidate.votes === poll.tieVotes,
  );
  if (tied.length >= 2) return tied;
  return [...poll.candidates].sort((a, b) => b.votes - a.votes);
}

// "2곳이 2표로 동점이에요". 표 수는 마감할 때 고정한 값이다(AC-40)
export function tieTitle(poll: MeetupPoll) {
  const tied = poll.candidates.filter(
    (candidate) => candidate.votes === poll.tieVotes,
  ).length;
  return tied >= 2
    ? `${tied}곳이 ${poll.tieVotes}표로 동점이에요`
    : `${poll.tieVotes}표로 동점이에요`;
}

// 정한 곳 위 줄. 동점에서 골랐으면 "2표씩 동점이라 민지님이 골랐어요"(AC-41)
export function decisionLine(
  decision: MeetupDecision,
  poll: MeetupPoll | undefined,
  hostName: string | undefined,
) {
  const host = hostName ? `${hostName}님이` : "모임장이";
  if (decision.method === "PICK")
    return `${decision.tieVotes}표씩 동점이라 ${host} 골랐어요`;
  if (decision.method === "VOTE") {
    const votes = poll?.candidates.find(
      (candidate) => candidate.placeId === decision.placeId,
    )?.votes;
    return votes ? `투표로 정했어요 · ${votes}표` : "투표로 정했어요";
  }
  return `${host} 정했어요`;
}

// 받침이 없거나 ㄹ 받침이면 "로", 그 밖의 받침이면 "으로"다. 한글이 아니면 "로"다. "숯불 마당으로", "한결 고깃집으로"
export function toward(word: string) {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}로`;
  const batchim = (last - 0xac00) % 28;
  return batchim === 0 || batchim === 8 ? `${word}로` : `${word}으로`;
}

// 결과 카드에서 투표에 올릴 곳을 고르고 뺀다. 다섯 곳이 찼으면 더 고르지 않는다(AC-44)
export function toggleCandidate(selected: number[], placeId: number) {
  if (selected.includes(placeId))
    return selected.filter((id) => id !== placeId);
  return selected.length >= POLL_CANDIDATES_MAX
    ? selected
    : [...selected, placeId];
}
