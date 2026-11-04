"use client";

import { ErrorView } from "./error-view";

// 페이지를 그리다 예상하지 못한 예외가 나면 루트 레이아웃 안에서 본문 대신 그린다.
// 화면별로 처리하는 불러오기 실패는 여기 오지 않는다
export default function ErrorPage({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return <ErrorView retry={retry} />;
}
