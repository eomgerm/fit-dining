export type HighlightPart = { text: string; match: boolean };

// 자동완성 후보에서 입력과 같은 부분을 강조하려고 나눈다. 입력을 공백으로 나눈 단어마다 대소문자를 무시하고
// 찾으며, 겹치거나 이어진 구간은 하나로 합친다. 한글 조합 중인 마지막 글자는 글자 그대로 맞을 때만 표시된다
export function highlightParts(text: string, input: string): HighlightPart[] {
  const needles = new Set(
    input.trim().toLowerCase().split(/\s+/).filter(Boolean),
  );
  if (needles.size === 0) return [{ text, match: false }];

  const haystack = text.toLowerCase();
  const marked = Array.from({ length: text.length }, () => false);
  for (const needle of needles) {
    for (
      let found = haystack.indexOf(needle);
      found >= 0;
      found = haystack.indexOf(needle, found + 1)
    ) {
      marked.fill(true, found, found + needle.length);
    }
  }

  const parts: HighlightPart[] = [];
  let start = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || marked[index] !== marked[start]) {
      parts.push({ text: text.slice(start, index), match: marked[start] });
      start = index;
    }
  }
  return parts;
}
