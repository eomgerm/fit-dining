"use client";

import "./globals.css";

import { ErrorView } from "./error-view";

// 루트 레이아웃(layout.tsx, providers.tsx)이 깨졌을 때 문서 전체를 대신한다.
// 레이아웃이 없으니 html·body·제목을 직접 둔다. 폰트는 레이아웃이 싣는 Pretendard 대신 기본 글꼴이다
export default function GlobalError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <title>문제가 생겼어요 | 핏다이닝</title>
        <ErrorView retry={retry} />
      </body>
    </html>
  );
}
