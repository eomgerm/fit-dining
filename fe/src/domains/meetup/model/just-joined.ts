// 방금 취향을 남긴 모임. 그 모임 링크는 대기 화면 대신 "취향을 남겼어요"(참여자 5)를 연다.
// 이 탭의 메모리에만 두어 다시 열면(새로 고침 포함) 대기 화면이다
const joined = new Set<string>();

export function markJustJoined(code: string) {
  joined.add(code);
}

export function isJustJoined(code: string) {
  return joined.has(code);
}

export function clearJustJoined(code: string) {
  joined.delete(code);
}
