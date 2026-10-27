// 작성 화면 데이터(review-form)의 이유 태그. group이 같은 태그는 함께 고를 수 없다(D-5)
export type FormTag = {
  code: string;
  label: string;
  group: string;
  displayGroup: string;
};

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
