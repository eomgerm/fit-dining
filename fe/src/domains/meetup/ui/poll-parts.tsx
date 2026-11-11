"use client";

import { RadioGroup } from "@base-ui/react/radio-group";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/shared/ui/button/button";
import { TextButton } from "@/shared/ui/button/text-button";
import { Note } from "@/shared/ui/display/note";
import { Checkbox } from "@/shared/ui/form/checkbox";
import { Radio } from "@/shared/ui/form/radio";
import { Switch } from "@/shared/ui/form/switch";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";

import type {
  MeetupDecision,
  MeetupInfo,
  MeetupPoll,
  MeetupProfile,
} from "../model/meetup";
import { formatWhen } from "../model/meetup-date";
import { decisionLine, toward } from "../model/poll";
import {
  distanceText,
  fitLine,
  menuText,
  PLACE_CATEGORY_LABELS,
  type MeetupResultItem,
} from "../model/result";
import { KeepWords } from "./keep-words";

// 결과 카드 아래 동작 영역(AC-32). 모임장에게만 있고, 다섯 곳을 고르면 다른 카드는 더 올릴 수 없다(AC-44)
export function CardActions({
  selected,
  full,
  canPoll,
  canDecide,
  onToggle,
  onDecide,
}: {
  selected: boolean;
  full: boolean;
  canPoll: boolean;
  canDecide: boolean;
  onToggle: () => void;
  onDecide: () => void;
}) {
  if (!canPoll && !canDecide) return null;
  return (
    <div className="mx-3.5 flex items-center justify-between border-t border-line">
      {canPoll ? (
        <Checkbox
          checked={selected}
          disabled={!selected && full}
          onCheckedChange={onToggle}
        >
          투표에 올리기
        </Checkbox>
      ) : (
        <span />
      )}
      {canDecide && (
        <TextButton variant="muted" onClick={onDecide}>
          여기로 정하기
        </TextButton>
      )}
    </div>
  );
}

// 투표 없이 결과 카드에서 바로 정하기 전에 묻는다(상태 모음 4)
export function DecideDialog({
  item,
  pending,
  onClose,
  onDecide,
}: {
  item?: MeetupResultItem;
  pending: boolean;
  onClose: () => void;
  onDecide: (item: MeetupResultItem) => void;
}) {
  return (
    <ConfirmDialog
      open={!!item}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${toward(item?.place.name ?? "")} 정할까요?`}
      description={
        <KeepWords>
          투표 없이 정해요. 친구들 화면에도 정한 곳으로 보여요.
        </KeepWords>
      }
      secondaryAction={
        <Button variant="outline" size="md" onClick={onClose}>
          취소
        </Button>
      }
      action={
        <Button
          size="md"
          disabled={pending}
          onClick={() => item && onDecide(item)}
        >
          정하기
        </Button>
      }
    />
  );
}

// 투표 열기 시트(모임장 투표 열기). 추천에 반영되지 않은 취향이 있으면 알리고 다시 추천받기를 보이되 막지 않는다(AC-44)
export function PollOpenSheet({
  open,
  onOpenChange,
  items,
  profiles,
  canCalculate,
  pending,
  onOpen,
  onCalculate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: MeetupResultItem[];
  profiles: MeetupProfile[];
  canCalculate: boolean;
  pending: boolean;
  onOpen: (anonymous: boolean) => void;
  onCalculate: () => void;
}) {
  const [anonymous, setAnonymous] = useState(true);
  const late = profiles.filter((profile) => !profile.reflected);

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="투표 열기">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-title-sm text-ink">
            후보 {items.length}곳으로 투표를 열어요
          </p>
          <p className="text-caption-md text-ink-muted">
            친구들이 모임 링크에서 한 곳을 골라요.
          </p>
        </div>
        <ol className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li
              key={item.place.id}
              className="flex items-center gap-3 rounded-md bg-surface-sunken px-3.5 py-2.5"
            >
              <span className="text-label-md text-primary">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-title-sm text-ink">
                {item.place.name}
              </span>
              <span className="text-caption-md text-ink-muted">
                {fitLine(item.fit, profiles).text}
              </span>
            </li>
          ))}
        </ol>
        <Switch
          checked={anonymous}
          onCheckedChange={setAnonymous}
          label="익명 투표"
          description="켜면 누가 어디를 골랐는지 보이지 않아요. 끄면 고른 사람 이름이 보여요."
        />
        {late.length > 0 && (
          <Note tone="warn">
            {late.map((profile) => `${profile.name}님`).join(", ")} 취향은 아직
            추천에 반영되지 않았어요. 투표를 열면 반영할 수 없어요.
          </Note>
        )}
        <p className="flex items-start gap-1 text-caption-sm text-ink-subtle">
          <InfoIcon size="sm" className="mt-px shrink-0" />
          투표를 시작하면 익명 설정과 후보를 바꿀 수 없고, 다시 추천받을 수도
          없어요.
        </p>
        <div className="flex flex-col gap-2 pb-2">
          <Button disabled={pending} onClick={() => onOpen(anonymous)}>
            투표 열기
          </Button>
          {late.length > 0 && canCalculate && (
            <Button variant="outline" size="md" onClick={onCalculate}>
              다시 추천받기
            </Button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

// 결과 화면 맨 위의 정한 곳(AC-45, 상태 모음 3). 모임 날짜 전에는 만날 날짜·시간과 장소를 보이고 방문 평가는 없다
export function DecidedCard({
  decision,
  poll,
  item,
  info,
  hostName,
  href,
  canChange,
  canCancel,
  onChange,
  onCancel,
}: {
  decision: MeetupDecision;
  poll?: MeetupPoll;
  item?: MeetupResultItem;
  info: MeetupInfo;
  hostName?: string;
  href: string;
  canChange: boolean;
  canCancel: boolean;
  onChange: () => void;
  onCancel: () => void;
}) {
  const name = item?.place.name ?? "정한 곳";
  const meta = item
    ? [
        PLACE_CATEGORY_LABELS[item.place.categoryGroup],
        distanceText(item.distance),
      ].filter((part): part is string => !!part)
    : [];

  return (
    <section
      aria-label="정한 곳"
      className="flex flex-col gap-2 rounded-lg bg-primary-soft p-4"
    >
      <p className="text-label-md text-primary">
        {decisionLine(decision, poll, hostName)}
      </p>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="truncate text-title-lg text-ink">{name}</h2>
          {meta.length > 0 && (
            <p className="text-caption-md text-ink-muted">{meta.join(" · ")}</p>
          )}
          {item?.menu && (
            <p className="text-caption-md text-ink-muted">
              대표 메뉴 <span className="text-ink">{menuText(item.menu)}</span>
            </p>
          )}
        </div>
        <Link
          href={href}
          className="shrink-0 text-label-md text-ink underline underline-offset-2"
        >
          장소 정보 보기
        </Link>
      </div>
      <div className="flex flex-col gap-0.5 border-t border-primary-line pt-2">
        {info.date && (
          <p className="text-title-sm text-ink">
            {formatWhen(info.date, info.time)}
          </p>
        )}
        <p className="text-caption-md text-ink-muted">
          {name}에서 만나요. 모임 당일부터 방문 평가를 남길 수 있어요.
        </p>
      </div>
      {(canChange || canCancel) && (
        <>
          <div className="flex gap-2 pt-1 *:flex-1">
            {canChange && (
              <Button variant="outline" size="md" onClick={onChange}>
                다른 곳으로 바꾸기
              </Button>
            )}
            {canCancel && (
              <Button variant="outline" size="md" onClick={onCancel}>
                정하기 취소
              </Button>
            )}
          </div>
          <p className="text-caption-sm text-ink-subtle">
            바꾸거나 취소하면 친구들 화면에도 바로 보여요.{" "}
            {poll
              ? "취소하면 투표 화면으로 돌아가요."
              : "취소하면 결과 화면으로 돌아가요."}
          </p>
        </>
      )}
    </section>
  );
}

// 다른 곳으로 바꾸기(상태 모음 4). 투표 후보를 위에, 나머지 추천을 아래에 보인다(AC-41)
export function ChangeDecisionSheet({
  open,
  onOpenChange,
  decision,
  poll,
  items,
  pending,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decision: MeetupDecision;
  poll?: MeetupPoll;
  items: MeetupResultItem[];
  pending: boolean;
  onChange: (item: MeetupResultItem) => void;
}) {
  const [picked, setPicked] = useState<number>();
  const byId = new Map(items.map((item) => [item.place.id, item]));
  const candidates = (poll?.candidates ?? []).flatMap((candidate) => {
    const item = byId.get(candidate.placeId);
    return item ? [{ item, votes: candidate.votes }] : [];
  });
  const candidateIds = new Set(candidates.map(({ item }) => item.place.id));
  const others = items.filter((item) => !candidateIds.has(item.place.id));
  const target = picked === undefined ? undefined : byId.get(picked);

  const row = (item: MeetupResultItem, note?: string) => {
    const current = item.place.id === decision.placeId;
    return (
      <div key={item.place.id} className="flex items-center gap-2">
        <Radio value={item.place.id} disabled={current}>
          {item.place.name}
        </Radio>
        <span className="ml-auto text-caption-md text-ink-muted">
          {current ? "지금 정한 곳" : note}
        </span>
      </div>
    );
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="다른 곳으로 바꾸기"
    >
      <RadioGroup
        value={picked ?? null}
        onValueChange={(value) => setPicked(value as number)}
        className="flex flex-col gap-3"
      >
        {candidates.length > 0 && (
          <section className="flex flex-col">
            <h3 className="text-label-md text-ink-muted">투표 후보</h3>
            {candidates.map(({ item, votes }) => row(item, `${votes}표`))}
          </section>
        )}
        {others.length > 0 && (
          <section className="flex flex-col">
            <h3 className="text-label-md text-ink-muted">다른 추천</h3>
            {others.map((item) => row(item))}
          </section>
        )}
      </RadioGroup>
      <div className="flex flex-col pt-4 pb-2">
        <Button
          disabled={!target || pending}
          onClick={() => target && onChange(target)}
        >
          {target
            ? `${toward(target.place.name)} 바꾸기`
            : "바꿀 곳을 골라 주세요"}
        </Button>
      </div>
    </BottomSheet>
  );
}

// 정한 곳이 있을 때 내 취향을 고치기 전에 추천이 바뀌지 않는다는 것을 알린다(AC-45)
export function TasteAfterDecisionDialog({
  open,
  onClose,
  onEdit,
}: {
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="이미 정한 곳이 있어요"
      description="취향을 고쳐도 추천과 정한 곳은 바뀌지 않아요."
      secondaryAction={
        <Button variant="outline" size="md" onClick={onClose}>
          취소
        </Button>
      }
      action={
        <Button
          size="md"
          onClick={() => {
            onClose();
            onEdit();
          }}
        >
          수정하기
        </Button>
      }
    />
  );
}
