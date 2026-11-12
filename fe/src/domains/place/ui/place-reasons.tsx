"use client";

import { useQuery } from "@tanstack/react-query";

import { Note } from "@/shared/ui/display/note";
import { Tag } from "@/shared/ui/display/tag";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionRow,
  AccordionTrigger,
} from "@/shared/ui/layout/accordion";
import { SectionHeader } from "@/shared/ui/layout/section-header";

import { placeQueries } from "../api/place-queries";
import {
  EVIDENCE_LABELS,
  reasonAuthor,
  visitedDay,
} from "../model/place-labels";
import type { PlaceFit, Reason, ReasonView } from "../model/place-types";

// 홈 탭 맨 위 "AI 추천 이유"(5단계 상세 추천 이유). 카드가 고른 이유를 접었다 펴는 줄 목록으로 보인다.
// 상세를 연 뒤 추천 이유 API로 제목과 근거를 받고, 받는 동안은 줄 수만큼 뼈대를 보인다.
// API가 실패하면 카드의 대체 제목으로 펼칠 수 없는 줄을 보인다
export function PlaceReasons({
  placeId,
  reasons,
  sentence,
}: {
  placeId: number;
  reasons: Reason[];
  sentence?: string;
}) {
  const query = useQuery(placeQueries.reasons(placeId, sentence, reasons));
  const rows: ReasonView[] =
    query.data?.reasons ??
    reasons.map(({ source, label, fallbackTitle }) => ({
      source,
      label,
      title: fallbackTitle,
      reviews: [],
    }));

  return (
    <div>
      <SectionHeader title="AI 추천 이유" className="mb-1" />
      {query.isPending ? (
        <div aria-busy className="flex flex-col">
          <span className="sr-only">추천 이유를 불러오는 중</span>
          {reasons.map(({ code, source }) => (
            <div
              key={`${source}-${code}`}
              className="flex flex-col gap-1.5 border-b border-line py-3 last:border-b-0"
            >
              <div className="h-4 w-1/4 skeleton rounded-xs" />
              <div className="h-5 w-3/4 skeleton rounded-xs" />
            </div>
          ))}
        </div>
      ) : (
        <Accordion>
          {rows.map((row) => {
            const key = `${row.source}-${row.label}`;
            if (row.reviews.length === 0 && !row.personaSummary) {
              // 근거가 없는 줄은 펼칠 수 없다
              return (
                <AccordionRow key={key}>
                  <ReasonHead row={row} />
                </AccordionRow>
              );
            }
            return (
              <AccordionItem key={key}>
                <AccordionTrigger>
                  <ReasonHead row={row} />
                </AccordionTrigger>
                <AccordionPanel>
                  <ReasonEvidence row={row} />
                </AccordionPanel>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

// 출처는 색이 아니라 글자로 구분한다("요청 · 조용해요")
function ReasonHead({ row }: { row: ReasonView }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="text-caption-md text-ink-muted">
        {EVIDENCE_LABELS[row.source]} · {row.label}
      </span>
      <span className="text-title-sm text-ink">{row.title}</span>
    </span>
  );
}

// 앱 리뷰가 있으면 최대 2건, 없으면 "이런 손님이 많이 찾아요"와 페르소나 요약 한 줄
function ReasonEvidence({ row }: { row: ReasonView }) {
  if (row.reviews.length > 0) {
    return (
      <ul className="flex flex-col gap-2 pb-3">
        {row.reviews.map((review) => (
          <li
            key={`${review.nickname ?? ""}-${review.visitedAt}`}
            className="flex flex-col items-start gap-1.5 rounded-md bg-surface-sunken p-3"
          >
            <p className="text-caption-md text-ink-muted">
              <span className="text-label-sm text-ink">
                {reasonAuthor(review)}
              </span>
              {" · "}
              <time dateTime={review.visitedAt}>
                {visitedDay(review.visitedAt)}
              </time>
            </p>
            <Tag variant="match">{review.tag}</Tag>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 pb-3">
      <p className="text-caption-md text-ink-muted">이런 손님이 많이 찾아요</p>
      <p className="text-body-sm text-ink">{row.personaSummary}</p>
    </div>
  );
}

// 모임에서 연 상세의 "AI 추천 이유"(모임 D-22). 모임 결과 카드가 완성해 준 이유를 추천 이유 API 없이 그대로 보인다.
// 검색 상세가 펼치는 목록으로 바뀌기 전의 모양(제목, 근거 태그, 인용, 주의점)이다
export function GivenReasons({ fit }: { fit: PlaceFit }) {
  const { reasons, caution } = fit;
  return (
    <>
      {reasons.length > 0 && (
        <SectionHeader title="AI 추천 이유" className="mb-3" />
      )}
      <div className="flex flex-col gap-2.5">
        {reasons.length > 0 && (
          <ul className="flex flex-col gap-2.5">
            {reasons.map((reason) => (
              <li
                key={reason.title}
                className="flex flex-col gap-2.5 rounded-lg bg-surface p-4 ring-1 ring-line ring-inset"
              >
                <p className="text-title-sm text-ink">{reason.title}</p>
                <div className="flex flex-wrap gap-1">
                  {reason.tags.map((tag) => (
                    <Tag
                      key={`${tag.source}-${tag.label}`}
                      variant={tag.source === "PREFERENCE" ? "match" : "default"}
                    >
                      {EVIDENCE_LABELS[tag.source]} · {tag.label}
                    </Tag>
                  ))}
                </div>
                {reason.quote && (
                  <blockquote className="border-l-2 border-primary-disabled pl-3 text-body-sm text-ink">
                    “{reason.quote}”
                    {reason.quoteSource && (
                      <footer className="mt-0.5 text-caption-sm text-ink-muted">
                        {reason.quoteSource}
                      </footer>
                    )}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        )}
        {caution && <Note tone="warn">{caution}</Note>}
      </div>
    </>
  );
}
