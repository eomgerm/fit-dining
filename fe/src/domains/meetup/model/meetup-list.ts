import { areaLabel, CATEGORY_LABELS, type MeetupListItem } from "./meetup";
import { formatWhen } from "./meetup-date";
import { toward } from "./poll";

// 내 모임의 묶음마다 처음 보이는 수. 넘으면 "더 보기"로 이어 본다(AC-75)
export const MY_MEETUPS_PAGE = 20;

// 진행 중인 모임과 끝난(정한) 모임. 서버가 정한 순서를 그대로 둔다
export function splitMeetups(items: MeetupListItem[]) {
  return {
    ongoing: items.filter((item) => item.phase !== "DECIDED"),
    ended: items.filter((item) => item.phase === "DECIDED"),
  };
}

// "선릉역 모임"
export function listTitle(item: MeetupListItem) {
  const area = areaLabel(item.area);
  return area ? `${area} 모임` : "모임";
}

// "취향 모으는 중 · 3명 남겼어요", "투표 중", "숯불 마당으로 정했어요"
export function listStatus(item: MeetupListItem) {
  switch (item.phase) {
    case "WAITING":
      return item.profileCount > 0
        ? `취향 모으는 중 · ${item.profileCount}명 남겼어요`
        : "취향 모으는 중";
    case "RESULT":
      return "추천 결과가 나왔어요";
    case "VOTING":
      return "투표 중";
    case "DECIDED":
      return item.decidedPlaceName
        ? `${toward(item.decidedPlaceName)} 정했어요`
        : "정한 곳이 있어요";
  }
}

// "11월 14일 (금) 저녁 7시 · 식당 · 4명"
export function listMeta(item: MeetupListItem) {
  return [
    item.date ? formatWhen(item.date, item.time) : "날짜 미정",
    CATEGORY_LABELS[item.category],
    item.headcount ? `${item.headcount}명` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
