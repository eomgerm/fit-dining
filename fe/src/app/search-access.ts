import { readAnswers } from "@/domains/onboarding/model/storage";
import type { SearchAccess } from "@/domains/place/api/place-queries";

import { threadAuth } from "./search-thread-auth";

// BE Preferences.TasteChip의 code 규칙. 맞지 않는 답을 실으면 그 비회원의 모든 검색이 400이다
const TASTE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

// 검색 요청에 실을 값(place-ai-search D-16). 세션 확인은 검색 기록 저장과 같은 것을 쓴다.
// 회원은 토큰(만료면 한 번 갱신), 비회원은 기기의 온보딩 답, 확인하지 못했으면 아무것도 싣지 않는다
export const searchAccess: SearchAccess = async (send) => {
  const key = await threadAuth.resolve();
  if (key.kind === "member") {
    return threadAuth.send(key, (accessToken) => send({ accessToken }));
  }
  if (key.kind === "unknown") return send({});
  const answers = readAnswers();
  const valid = answers?.tastes.every(
    ({ code }) => code == null || TASTE_CODE.test(code),
  );
  return send(valid ? { preferences: answers } : {});
};
