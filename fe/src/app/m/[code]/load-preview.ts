import { cache } from "react";

import { fetchPreview } from "@/domains/meetup/api/meetup-api";
import type { MeetupPreview } from "@/domains/meetup/model/meetup";
import { isApiError } from "@/shared/api/api-error";

export type LoadedPreview = MeetupPreview | "not-found" | "failed";

// 메신저의 미리보기 봇이 기다리는 동안 페이지가 BE 응답을 기다리므로 기본 10초보다 짧게 끊는다
const SERVER_TIMEOUT_MS = 3_000;

// 서버에서 링크 미리보기용 모임 정보를 읽는다. 한 요청 안에서 여러 번 불러도 BE는 한 번만 부른다(React cache).
// 실패해도 던지지 않는다. 메타 태그는 일반 안내가 되고 화면은 브라우저가 스냅숏을 받아 그린다
export const loadPreview = cache(
  async (code: string): Promise<LoadedPreview> => {
    try {
      return await fetchPreview(code, AbortSignal.timeout(SERVER_TIMEOUT_MS));
    } catch (error) {
      // BE의 ProblemDetail이 있는 404만 없는 모임이다. 앞단이 본문 없이 준 404는 실패로 본다
      return isApiError(error) && error.problem?.status === 404
        ? "not-found"
        : "failed";
    }
  },
);
