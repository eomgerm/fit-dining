import type { TasteChip } from "../model/answers";

// 화면 확인용 가짜 분석기. 백엔드 연결 시 이 함수 내부만 교체한다.
export function analyzeTaste(
  text: string,
  { signal }: { signal: AbortSignal },
): Promise<TasteChip[]> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("분석 취소", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      if (process.env.NODE_ENV !== "production" && text.includes("#실패")) {
        reject(new Error("개발 환경 분석 실패"));
        return;
      }
      const dictionary: [RegExp, string][] = [
        [/담백.*국물|국물.*담백/, "담백한 국물"],
        [/담백/, "담백한 맛"],
        [/국물/, "국물"],
        [/매운|맵/, "매운맛"],
        [/달달|단맛/, "달달한 맛"],
        [/조용/, "조용한 분위기"],
        [/양\s*많/, "넉넉한 양"],
      ];
      const chips: TasteChip[] = [];
      // 연결 어미도 나누어 서로 다른 취향의 부정 표현이 섞이지 않게 한다.
      for (const fragment of text.split(
        /[,，.!?\n]|하고|하지만|그런데|좋아하며|좋아해요/,
      )) {
        for (const [pattern, label] of dictionary) {
          if (!pattern.test(fragment)) continue;
          if (
            (label === "담백한 맛" || label === "국물") &&
            /담백.*국물|국물.*담백/.test(fragment)
          )
            continue;
          const polarity = /별로|싫|안\s*좋|못\s*먹/.test(fragment)
            ? "dislike"
            : "like";
          if (
            !chips.some(
              (chip) => chip.label === label && chip.polarity === polarity,
            )
          )
            chips.push({ polarity, label });
        }
      }
      resolve(
        chips.length
          ? chips.slice(0, 5)
          : [
              {
                polarity: "like",
                label: text.trim().slice(0, 24) || "나만의 취향",
              },
            ],
      );
    }, 1200);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
