import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TextField } from "./text-field";

describe("TextField invalid", () => {
  it("invalid만으로 오류 테두리 상태를 만들고 외부 오류 연결 하나를 유지한다", () => {
    const html = renderToStaticMarkup(
      <TextField label="아이디" invalid aria-describedby="login-error" />,
    );

    expect(html.split(">", 1)[0]).toContain("data-invalid");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="login-error"');
  });

  it("invalid를 생략하면 기존처럼 error로 무효 상태를 정한다", () => {
    const html = renderToStaticMarkup(
      <TextField label="아이디" error="입력 정보를 확인해 주세요." />,
    );

    expect(html.split(">", 1)[0]).toContain("data-invalid");
    expect(html).toContain("입력 정보를 확인해 주세요.");
  });

  it("invalid와 error가 없으면 무효 상태를 만들지 않는다", () => {
    const html = renderToStaticMarkup(<TextField label="아이디" />);

    expect(html.split(">", 1)[0]).not.toContain("data-invalid");
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("포커스는 안쪽 1.5px 테두리로, 오류면 포커스 중에도 빨강 테두리를 유지한다", () => {
    const normal = renderToStaticMarkup(<TextField label="아이디" />);
    expect(normal).toContain("focus-within:border-primary-strong");
    expect(normal).not.toContain("outline-focus-ring");

    const invalid = renderToStaticMarkup(<TextField label="아이디" invalid />);
    expect(invalid).toContain("border-danger");
    expect(invalid).not.toContain("primary-strong");
    expect(invalid).not.toContain("outline-focus-ring");
  });

  it("명시한 invalid=false는 error의 기본 무효 상태보다 우선한다", () => {
    const html = renderToStaticMarkup(
      <TextField label="아이디" invalid={false} error="서버 오류" />,
    );

    expect(html.split(">", 1)[0]).not.toContain("data-invalid");
    expect(html).not.toContain('aria-invalid="true"');
  });
});
