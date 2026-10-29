import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { Chip } from "./chip";
import { TextButton } from "./text-button";

describe("Button", () => {
  it("폼 안에서 실수로 제출하지 않도록 type=button으로 그린다", () => {
    expect(renderToStaticMarkup(<Button>다음</Button>)).toMatch(
      /^<button type="button"/,
    );
  });

  it("disabled를 전달한다", () => {
    const html = renderToStaticMarkup(<Button disabled>다음</Button>);
    expect(html).toContain("disabled");
    expect(html).toContain("data-disabled");
  });

  it("render로 링크를 버튼 모양으로 그린다", () => {
    const html = renderToStaticMarkup(
      <Button render={<a href="/saved" />} nativeButton={false}>
        저장한 장소
      </Button>,
    );
    expect(html).toMatch(/^<a [^>]*href="\/saved"/);
  });

  it("배치용 className을 덧붙이고 크기 규칙을 따른다", () => {
    const html = renderToStaticMarkup(
      <Button size="sm" variant="outline" className="w-full">
        결과 보기
      </Button>,
    );
    expect(html).toContain("w-full");
    expect(html).toContain("rounded-full");
    expect(html).toContain("border-line-strong");
  });

  it("Figma에 없는 variant·size 조합은 타입 오류다", () => {
    // 타입 검사(tsc)에서 확인한다. 런타임 동작은 보지 않는다
    expect([
      // @ts-expect-error primary에는 sm이 없다
      <Button key="1" size="sm" />,
      // @ts-expect-error outline에는 lg가 없다
      <Button key="2" variant="outline" size="lg" />,
      // @ts-expect-error danger에는 md만 있다
      <Button key="3" variant="danger" size="sm" />,
    ]).toHaveLength(3);
  });
});

describe("TextButton", () => {
  it("밑줄 친 버튼으로 그린다", () => {
    const html = renderToStaticMarkup(<TextButton>나중에 할게요</TextButton>);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain("underline");
  });

  it("size에 맞는 글자 스타일을 쓴다", () => {
    expect(
      renderToStaticMarkup(<TextButton size="md">비밀번호 찾기</TextButton>),
    ).toContain("text-button-md");
    expect(
      renderToStaticMarkup(<TextButton size="sm">나중에 할게요</TextButton>),
    ).toContain("text-button-sm");
  });

  it("muted는 밑줄 없는 회색 보조 링크로 그린다", () => {
    const html = renderToStaticMarkup(
      <TextButton variant="muted">비밀번호 찾기</TextButton>,
    );
    expect(html).toContain("text-ink-muted");
    expect(html).not.toContain("underline");
  });
});

describe("Chip", () => {
  it("기본은 36px 칩, lg는 44px 칩으로 글자 토큰을 따른다", () => {
    const md = renderToStaticMarkup(<Chip>조용한 곳</Chip>);
    expect(md).toContain("h-9");
    expect(md).toContain("text-body-sm");
    expect(md).toContain("data-pressed:text-label-md");

    const lg = renderToStaticMarkup(<Chip size="lg">조용한 곳</Chip>);
    expect(lg).toContain("h-11");
    expect(lg).toContain("text-body-md");
  });
});
