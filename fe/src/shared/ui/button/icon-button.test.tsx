import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Fab } from "./fab";
import { IconButton } from "./icon-button";
import { MoreIcon } from "@/shared/ui/icon/icons/more";

describe.each([
  ["IconButton", IconButton],
  ["Fab", Fab],
])("%s", (_, Component) => {
  const html = renderToStaticMarkup(
    <Component label="더보기">
      <MoreIcon />
    </Component>,
  );

  it("label을 버튼 이름으로 쓴다", () => {
    expect(html).toMatch(/^<button type="button"[^>]*aria-label="더보기"/);
  });

  it("44px 원 안에 아이콘을 그린다", () => {
    expect(html).toContain("size-11");
    expect(html).toContain("rounded-full");
    expect(html).toContain("<svg");
  });
});

describe("Fab", () => {
  it("지도·사진 위에 뜨도록 흰 바탕과 그림자를 가진다", () => {
    const html = renderToStaticMarkup(
      <Fab label="내 위치">
        <MoreIcon />
      </Fab>,
    );
    expect(html).toContain("bg-surface");
    expect(html).toContain("shadow-2");
  });
});

describe("IconButton", () => {
  it("바탕과 그림자가 없다", () => {
    const html = renderToStaticMarkup(
      <IconButton label="닫기">
        <MoreIcon />
      </IconButton>,
    );
    expect(html).not.toContain("bg-");
    expect(html).not.toContain("shadow");
  });
});
