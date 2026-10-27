import type { FormTag } from "./review";

export type { FormTag };

export function toggleTag(selected: readonly string[], code: string) {
  return selected.includes(code)
    ? selected.filter((c) => c !== code)
    : [...selected, code];
}

// 7-01·7-02가 다른 페이지여도 같은 그룹의 다른 태그를 막는다
export function disabledTagCodes(
  selected: readonly string[],
  tags: readonly FormTag[],
) {
  const groups = new Set(
    tags.filter((tag) => selected.includes(tag.code)).map((tag) => tag.group),
  );
  return new Set(
    tags
      .filter((tag) => groups.has(tag.group) && !selected.includes(tag.code))
      .map((tag) => tag.code),
  );
}

export function hasGoodTag(
  selected: readonly string[],
  goodTags: readonly FormTag[],
) {
  return goodTags.some((tag) => selected.includes(tag.code));
}

// 화면 묶음(분위기·공간·이용·양·방문 목적)을 받은 순서대로 나눈다
export function groupByDisplayGroup(tags: readonly FormTag[]) {
  const groups = new Map<string, FormTag[]>();
  for (const tag of tags) {
    groups.set(tag.displayGroup, [
      ...(groups.get(tag.displayGroup) ?? []),
      tag,
    ]);
  }
  return [...groups].map(([name, items]) => ({ name, tags: items }));
}
