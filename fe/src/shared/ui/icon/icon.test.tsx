import { readdirSync } from "node:fs";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Icon } from "./icon";

describe("Icon", () => {
  const path = <path d="M5 12L10 17L19 7" />;

  it("label이 없으면 장식으로 보고 화면 낭독기에서 숨긴다", () => {
    const html = renderToStaticMarkup(<Icon>{path}</Icon>);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
  });

  it("label이 있으면 이미지로 읽힌다", () => {
    const html = renderToStaticMarkup(<Icon label="저장됨">{path}</Icon>);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="저장됨"');
    expect(html).not.toContain("aria-hidden");
  });

  it("size로 크기를 고른다", () => {
    expect(renderToStaticMarkup(<Icon>{path}</Icon>)).toContain("size-6");
    expect(renderToStaticMarkup(<Icon size="md">{path}</Icon>)).toContain(
      "size-5",
    );
    expect(renderToStaticMarkup(<Icon size="sm">{path}</Icon>)).toContain(
      "size-4",
    );
  });
});

// 아이콘을 추가할 때의 실수(이름 규칙, 고정 색, 크기 틀)를 잡는다
describe("icons/", () => {
  const files = readdirSync(new URL("./icons", import.meta.url)).filter(
    (file) => file.endsWith(".tsx"),
  );

  it("아이콘 파일이 있다", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s", async (file) => {
    const exports: Record<string, ComponentType> = await import(
      `./icons/${file}`
    );
    const pascal = file
      .replace(".tsx", "")
      .replace(/(^|-)(\w)/g, (_, __, char: string) => char.toUpperCase());

    expect(Object.keys(exports)).toEqual([`${pascal}Icon`]);
    const Component = exports[`${pascal}Icon`];
    const html = renderToStaticMarkup(<Component />);
    expect(html).toMatch(/^<svg [^>]*viewBox="0 0 24 24"/);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|white|black/i);
  });
});
