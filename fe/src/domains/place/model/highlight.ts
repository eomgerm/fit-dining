export type HighlightPart = { text: string; match: boolean };

// 자동완성 후보에서 입력과 같은 부분을 강조하려고 나눈다(대소문자 무시)
export function highlightParts(text: string, input: string): HighlightPart[] {
  const needle = input.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];

  const haystack = text.toLowerCase();
  const parts: HighlightPart[] = [];
  let start = 0;
  for (
    let found = haystack.indexOf(needle);
    found >= 0;
    found = haystack.indexOf(needle, start)
  ) {
    if (found > start)
      parts.push({ text: text.slice(start, found), match: false });
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    start = found + needle.length;
  }
  if (start < text.length)
    parts.push({ text: text.slice(start), match: false });
  return parts;
}
