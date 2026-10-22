import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tag } from "./tag";

describe("Tag", () => {
  it("기본은 회색 바탕의 보조 글자다", () => {
    const html = renderToStaticMarkup(<Tag>자리가 넉넉한 곳</Tag>);
    expect(html).toMatch(/^<span /);
    expect(html).toContain("bg-surface-sunken");
    expect(html).toContain("text-ink-muted");
    expect(html).toContain("text-caption-sm");
  });

  it("match는 취향에 맞는 태그를 주황으로 강조한다", () => {
    const html = renderToStaticMarkup(
      <Tag variant="match">조용하고 차분한 곳</Tag>,
    );
    expect(html).toContain("bg-primary-soft");
    expect(html).toContain("text-primary-strong");
    expect(html).toContain("text-label-sm");
  });

  it("prefix를 본문 앞에 굵게 붙인다", () => {
    const html = renderToStaticMarkup(
      <Tag prefix="아쉬움">대기가 길었어요</Tag>,
    );
    expect(html).toMatch(
      /<span class="[^"]*text-label-sm[^"]*">아쉬움<\/span>대기가 길었어요/,
    );
  });
});
