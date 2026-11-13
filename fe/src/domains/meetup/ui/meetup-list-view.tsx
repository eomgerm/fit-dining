"use client";

import Link from "next/link";
import { useState } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { TextButton } from "@/shared/ui/button/text-button";
import { AvatarBadgeMark } from "@/shared/ui/display/avatar";
import { Note } from "@/shared/ui/display/note";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { UsersIcon } from "@/shared/ui/icon/icons/users";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

import { meetupHref, type MeetupListItem } from "../model/meetup";
import {
  listMeta,
  listStatus,
  listTitle,
  MY_MEETUPS_PAGE,
  splitMeetups,
} from "../model/meetup-list";

export type MeetupListState = "loading" | "error" | "ready";

// 내 모임(화면 예시 모임장 2-1·2-2, AC-75). 진행 중인 모임을 위에, 끝난 모임을 아래에 두고 만든 모임에는 왕관을 붙인다.
// 모임이 없으면 소개와 만들기 버튼만 보인다
export function MeetupListView({
  items,
  state,
  onBack,
  onCreate,
  onRetry,
}: {
  items?: MeetupListItem[];
  state: MeetupListState;
  onBack: () => void;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const { ongoing, ended } = splitMeetups(items ?? []);
  const empty = state === "ready" && ongoing.length + ended.length === 0;
  return (
    <Screen>
      <TopBar
        start={
          <IconButton label="뒤로" onClick={onBack}>
            <ChevronLeftIcon className="text-icon" />
          </IconButton>
        }
        title="내 모임"
      />
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-20 text-center text-balance">
          <span
            aria-hidden="true"
            className="flex size-13 items-center justify-center rounded-full bg-primary-soft text-primary"
          >
            <UsersIcon />
          </span>
          <h2 className="text-title-lg">친구들과 갈 곳을 같이 정해요</h2>
          <p className="text-body-sm text-ink-muted">
            모임을 만들고 링크를 보내면
            <br />
            친구들이 가입 없이 취향을 남겨요.
          </p>
          <p className="pt-2 text-caption-md text-ink-subtle">
            만들거나 로그인하고 참여한 모임이 여기에 보여요.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 px-5 pt-2 pb-4">
          {state === "loading" && (
            <div aria-hidden="true" className="flex flex-col gap-2">
              {[0, 1, 2].map((key) => (
                <div key={key} className="h-23 skeleton rounded-xl" />
              ))}
            </div>
          )}
          {state === "error" && (
            <div className="flex flex-col items-start gap-1">
              <Note tone="warn">
                모임을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.
              </Note>
              <TextButton onClick={onRetry}>다시 시도</TextButton>
            </div>
          )}
          {ongoing.length > 0 && (
            <MeetupGroup id="ongoing" title="진행 중" items={ongoing} />
          )}
          {ended.length > 0 && (
            <MeetupGroup id="ended" title="끝난 모임" items={ended} />
          )}
          {state === "ready" && (
            <p className="flex items-start gap-2 rounded-md bg-surface-sunken px-3.5 py-3 text-caption-md text-ink-muted">
              <InfoIcon size="sm" className="mt-px shrink-0" />
              로그인하고 참여한 모임만 보여요. 로그인 없이 참여한 모임은 받은
              링크로 들어가 주세요.
            </p>
          )}
        </div>
      )}
      <BottomBar>
        <Button onClick={onCreate}>새로운 모임 만들기</Button>
      </BottomBar>
    </Screen>
  );
}

function MeetupGroup({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: MeetupListItem[];
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, MY_MEETUPS_PAGE);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-label-md text-ink-muted">
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {shown.map((item) => (
          <li key={item.code}>
            <Link
              href={meetupHref(item.code)}
              className="flex items-center gap-3 rounded-xl py-3.5 pr-3 pl-4 ring-1 ring-line transition ring-inset motion-safe:active:scale-99"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-title-sm text-ink">
                    {listTitle(item)}
                  </span>
                  {item.role === "HOST" && (
                    <AvatarBadgeMark kind="host" size="lg" placement="inline" />
                  )}
                </span>
                <span
                  className={cn(
                    "text-label-md",
                    item.phase === "DECIDED"
                      ? "font-normal text-ink"
                      : "text-primary-strong",
                  )}
                >
                  {listStatus(item)}
                </span>
                <span className="text-caption-md text-ink-subtle">
                  {listMeta(item)}
                </span>
              </span>
              <ChevronRightIcon className="shrink-0 text-icon-subtle" />
            </Link>
          </li>
        ))}
      </ul>
      {!all && items.length > MY_MEETUPS_PAGE && (
        <TextButton variant="muted" onClick={() => setAll(true)}>
          더 보기
        </TextButton>
      )}
    </section>
  );
}
