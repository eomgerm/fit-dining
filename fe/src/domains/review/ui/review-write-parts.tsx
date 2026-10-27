import { Toggle } from "@base-ui/react/toggle";
import Image from "next/image";

import { Chip } from "@/shared/ui/button/chip";
import { Textarea } from "@/shared/ui/form/textarea";
import { TextField } from "@/shared/ui/form/text-field";
import { CalendarIcon } from "@/shared/ui/icon/icons/calendar";
import { CameraIcon } from "@/shared/ui/icon/icons/camera";
import { ChevronDownIcon } from "@/shared/ui/icon/icons/chevron-down";
import { HeartIcon } from "@/shared/ui/icon/icons/heart";
import { SectionHeader } from "@/shared/ui/layout/section-header";

import type { FormTag, ReviewFormResponse } from "../model/review";
import { formatSpent } from "../model/review-draft";
import { groupByDisplayGroup } from "../model/review-tags";
import { formatVisitDate } from "../model/visit-calendar";

// 7-01·7-02 머리의 장소 줄. 대표 사진이 없으면 장소 카드와 같은 그라데이션을 그린다
export function PlaceRow({ place }: { place: ReviewFormResponse["place"] }) {
  return (
    <div className="flex items-center gap-3">
      {place.thumbnailUrl ? (
        <div className="relative size-12 shrink-0 overflow-hidden rounded-md">
          <Image
            src={place.thumbnailUrl}
            alt=""
            fill
            unoptimized
            className="object-cover"
          />
        </div>
      ) : (
        <div
          aria-hidden
          className="size-12 shrink-0 rounded-md bg-linear-to-br from-primary-line to-primary-disabled"
        />
      )}
      <p className="truncate text-title-sm text-ink">{place.name}</p>
    </div>
  );
}

export function VisitDateButton({
  value,
  today,
  onClick,
}: {
  value: string | null;
  today: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full items-center gap-2 rounded-md bg-surface-sunken px-3 text-left"
    >
      <CalendarIcon size="md" className="text-icon" />
      <span className="text-body-sm text-ink-muted">방문일</span>
      <span className="truncate text-body-md font-semibold text-ink">
        {value ? formatVisitDate(value, today) : "방문일을 골라 주세요"}
      </span>
      <ChevronDownIcon size="md" className="ml-auto text-icon" />
    </button>
  );
}

// 7-01·7-02의 태그 칩 묶음. 다른 페이지에서 고른 태그와 같은 그룹이면 비활성이다(D-5)
export function ReasonTagGroups({
  tags,
  selected,
  disabled,
  onToggle,
}: {
  tags: readonly FormTag[];
  selected: readonly string[];
  disabled: ReadonlySet<string>;
  onToggle: (code: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {groupByDisplayGroup(tags).map((group) => (
        <div
          key={group.name}
          role="group"
          aria-label={group.name}
          className="flex flex-col gap-2"
        >
          <p className="text-caption-md text-ink-muted">{group.name}</p>
          <div className="flex flex-wrap gap-2">
            {group.tags.map((tag) => (
              <Chip
                key={tag.code}
                pressed={selected.includes(tag.code)}
                disabled={disabled.has(tag.code)}
                onPressedChange={() => onToggle(tag.code)}
              >
                {tag.label}
              </Chip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type DetailFieldsProps = {
  revisitIntent: boolean;
  description: string;
  spentPerPerson: string;
  limits: ReviewFormResponse["limits"];
  onRevisitIntentChange: (value: boolean) => void;
  onDescriptionChange: (value: string) => void;
  onSpentPerPersonChange: (raw: string) => void;
  onAddPhoto: () => void;
};

// 7-04·7-05. 문구는 와이어프레임 그대로다(D-41)
export function DetailFields({
  revisitIntent,
  description,
  spentPerPerson,
  limits,
  onRevisitIntentChange,
  onDescriptionChange,
  onSpentPerPersonChange,
  onAddPhoto,
}: DetailFieldsProps) {
  return (
    <>
      <section className="flex flex-col items-center px-5 pt-6 pb-7 text-center">
        <h2 className="text-title-lg text-ink">또 오고 싶다면?</h2>
        <p className="mt-1 text-body-sm text-ink-muted">
          비슷한 취향의 장소를 찾아드릴게요.
        </p>
        <Toggle
          pressed={revisitIntent}
          onPressedChange={onRevisitIntentChange}
          className="group mt-4 inline-flex h-12 items-center gap-2 rounded-md border border-line-strong bg-surface px-5 text-button-md text-ink transition-colors duration-200 select-none data-pressed:border-primary data-pressed:bg-primary-soft data-pressed:text-primary-strong"
        >
          <HeartIcon
            size="md"
            className="text-primary group-data-pressed:fill-current"
          />
          재방문 의사 있어요
        </Toggle>
      </section>
      <div aria-hidden className="h-2 shrink-0 bg-surface-sunken" />
      <div className="flex flex-col gap-7 px-5 pt-6 pb-6">
        <div className="flex flex-col gap-3">
          <SectionHeader size="md" title="리뷰" />
          <Textarea
            label="리뷰"
            maxLength={limits.descriptionMax}
            placeholder="자유롭게 적어 주세요"
            value={description}
            onValueChange={(value) => onDescriptionChange(value)}
          />
        </div>
        <div className="flex flex-col gap-3">
          <SectionHeader
            size="md"
            title="사진"
            hint={`최대 ${limits.photoMax}장`}
          />
          <button
            type="button"
            onClick={onAddPhoto}
            className="flex size-18 flex-col items-center justify-center gap-1 rounded-md border border-line-strong bg-surface text-ink-muted"
          >
            <CameraIcon size="md" />
            <span className="text-caption-sm">추가</span>
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <SectionHeader size="md" title="1인당 쓴 금액" />
          <TextField
            label="1인당 쓴 금액"
            inputMode="numeric"
            placeholder="금액"
            suffix="원"
            description="추천이나 화면에는 쓰지 않아요."
            value={formatSpent(spentPerPerson)}
            onValueChange={(value) => onSpentPerPersonChange(String(value))}
          />
        </div>
      </div>
    </>
  );
}
