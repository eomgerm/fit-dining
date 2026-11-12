// 회원 프로필로 바꿀지는 모임마다 한 번만 묻는다(D-25). 이 브라우저에 남기고, 저장소를 쓸 수 없을 때만 이 탭의 메모리에 둔다
const askedInTab = new Set<string>();

const storageKey = (code: string) => `fitdining:meetup-link-asked:${code}`;

export function wasLinkAsked(code: string) {
  try {
    return window.localStorage.getItem(storageKey(code)) === "1";
  } catch {
    return askedInTab.has(code);
  }
}

export function markLinkAsked(code: string) {
  try {
    window.localStorage.setItem(storageKey(code), "1");
  } catch {
    askedInTab.add(code);
  }
}
