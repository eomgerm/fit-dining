import { cache } from "react";

import { getPlace } from "@/domains/place/api/place-api";
import type { PlaceDetail } from "@/domains/place/model/place-types";
import { isApiError } from "@/shared/api/api-error";

export type LoadedPlace = PlaceDetail | "not-found" | "failed";

// 페이지는 Suspense 없이 BE 응답까지 기다려 그리므로 기본 10초보다 짧게 끊는다
const SERVER_TIMEOUT_MS = 3_000;

// 서버에서 장소 상세를 읽는다. 한 요청 안에서 여러 번 불러도 BE는 한 번만 부른다(React cache).
// 실패해도 던지지 않는다. 화면은 브라우저가 다시 받아 기존의 없음·실패 상태를 그린다
export const loadPlace = cache(async (id: number): Promise<LoadedPlace> => {
  try {
    return await getPlace(id, AbortSignal.timeout(SERVER_TIMEOUT_MS));
  } catch (error) {
    // BE의 ProblemDetail이 있는 404만 없는 장소다. dev 엣지 게이트처럼 앞단이 본문 없이 준 404는 실패로 본다
    return isApiError(error) && error.problem?.status === 404
      ? "not-found"
      : "failed";
  }
});
