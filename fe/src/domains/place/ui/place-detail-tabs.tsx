"use client";

import { useState, type ReactElement, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { Note } from "@/shared/ui/display/note";
import { Tag } from "@/shared/ui/display/tag";
import { CalendarIcon } from "@/shared/ui/icon/icons/calendar";
import { ChevronDownIcon } from "@/shared/ui/icon/icons/chevron-down";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { ClockIcon } from "@/shared/ui/icon/icons/clock";
import { CopyIcon } from "@/shared/ui/icon/icons/copy";
import { ExternalLinkIcon } from "@/shared/ui/icon/icons/external-link";
import { GlobeIcon } from "@/shared/ui/icon/icons/globe";
import { PhoneIcon } from "@/shared/ui/icon/icons/phone";
import { PinIcon } from "@/shared/ui/icon/icons/pin";
import { UsersIcon } from "@/shared/ui/icon/icons/users";
import { WifiIcon } from "@/shared/ui/icon/icons/wifi";
import { SectionHeader } from "@/shared/ui/layout/section-header";
import { useToast } from "@/shared/ui/overlay/toast";

import { distanceMeters, formatDistance } from "../model/nearby";
import {
  DAY_LABELS,
  hoursNotes,
  hoursText,
  todayHours,
  todayNotice,
} from "../model/opening-hours";
import {
  evidenceText,
  FACILITY_LABELS,
  missingEvidenceNotes,
  OPEN_STATUS_LABELS,
} from "../model/place-labels";
import type {
  DayCode,
  Facility,
  Hours,
  LatLng,
  Menu,
  PlaceCard,
  PlaceDetail,
} from "../model/place-types";
import { MenuCard, MenuRow } from "./menu-card";
import { OpenStatusText } from "./place-parts";
import { PlaceMap } from "./place-map";

const MENU_PREVIEW_COUNT = 6;

type TabProps = {
  detail: PlaceDetail;
  here?: LatLng;
};

// 홈 탭(6-01, 와이어프레임 Detail). 섹션 사이는 두꺼운 띠로 나눈다.
// 추천 이유, 근거 부족 안내, 주의점은 검색 카드가 있을 때만 보인다
export function HomeTab({
  detail,
  card,
  here,
  now,
  onShowInfo,
  onShowMenu,
  reviews,
}: TabProps & {
  card?: PlaceCard;
  now: Date;
  onShowInfo: () => void;
  onShowMenu: () => void;
  // 맨 아래 리뷰 미리보기. app이 리뷰 도메인으로 채운다
  reviews?: ReactNode;
}) {
  const [weekOpen, setWeekOpen] = useState(false);
  const today = todayHours(detail.hours, now);
  const reasons = card?.reasons ?? [];
  const notes = card ? missingEvidenceNotes(card.scoreItems) : [];

  return (
    <div className="flex flex-col">
      {(reasons.length > 0 || notes.length > 0 || card?.caution) && (
        <Section>
          {reasons.length > 0 && <SectionHeader title="AI 추천 이유" />}
          <div className="flex flex-col gap-2.5">
            {reasons.length > 0 && (
              <ul className="flex flex-col gap-2.5">
                {reasons.map((reason) => (
                  <li
                    key={reason.title}
                    className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4"
                  >
                    <p className="text-title-sm text-ink">{reason.title}</p>
                    <div className="flex flex-wrap gap-1">
                      {reason.tags.map((tag) => (
                        <Tag
                          key={`${tag.source}-${tag.label}`}
                          variant={
                            tag.source === "PREFERENCE" ? "match" : "default"
                          }
                        >
                          {evidenceText(tag.source, tag.label)}
                        </Tag>
                      ))}
                    </div>
                    {reason.quote && (
                      <blockquote className="border-l-2 border-line-strong pl-3 text-body-sm text-ink-muted">
                        “{reason.quote}”
                        {reason.quoteSource && (
                          <footer className="mt-0.5 text-caption-sm text-ink-subtle">
                            {reason.quoteSource}
                          </footer>
                        )}
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {notes.map((note) => (
              <Note key={note}>{note}</Note>
            ))}
            {card?.caution && <Note tone="warn">{card.caution}</Note>}
          </div>
        </Section>
      )}

      <Section>
        <AddressRow detail={detail} here={here} />
        <button
          type="button"
          aria-expanded={weekOpen}
          aria-label="요일별 영업시간 보기"
          onClick={() => setWeekOpen(!weekOpen)}
          className="flex min-h-11 w-full items-center gap-3 py-2.5 text-left"
        >
          <ClockIcon size="md" className="text-ink-muted" />
          <span className="flex-1 text-body-md text-ink">
            <OpenStatusLine
              detail={detail}
              notice={`오늘 ${today ? hoursText(today) : "영업시간 정보 없음"}`}
            />
          </span>
          <ChevronDownIcon
            size="md"
            className={cn("text-ink-muted", weekOpen && "rotate-180")}
          />
        </button>
        {weekOpen && (
          <WeekHours
            hours={detail.hours}
            today={today?.dayOfWeek}
            className="pb-2 pl-8"
          />
        )}
        <ContactRows detail={detail} />
        <button
          type="button"
          onClick={onShowInfo}
          className="mx-auto mt-2 flex min-h-11 items-center gap-0.5 rounded-full border border-line-strong bg-surface pr-3.5 pl-4.5 text-label-md text-ink"
        >
          정보 더보기
          <ChevronRightIcon size="sm" />
        </button>
      </Section>

      {detail.menus.length > 0 && (
        <Section>
          <button
            type="button"
            onClick={onShowMenu}
            className="-mt-2 mb-1 flex min-h-11 items-center gap-0.5 self-start text-title-lg text-ink"
          >
            메뉴
            <span className="ml-1.5 text-ink-muted">{detail.menus.length}</span>
            <ChevronRightIcon size="md" />
          </button>
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5">
            {detail.menus.slice(0, MENU_PREVIEW_COUNT).map((menu) => (
              <MenuCard key={`${menu.category}-${menu.name}`} menu={menu} />
            ))}
          </div>
        </Section>
      )}
      {reviews && <Section>{reviews}</Section>}
    </div>
  );
}

// 메뉴 탭(6-02, 와이어프레임 DetailMenu). 카테고리별로 묶는다
export function MenuTab({ detail }: TabProps) {
  // Map.groupBy는 Next 16 기본 대상(Safari 16.4, Chrome 111)에 없다
  const categories = new Map<string, Menu[]>();
  for (const menu of detail.menus) {
    categories.set(menu.category, [
      ...(categories.get(menu.category) ?? []),
      menu,
    ]);
  }
  return (
    <div className="flex flex-col px-5 pt-2 pb-7">
      {[...categories].map(([category, menus]) => (
        <section key={category} className="flex flex-col">
          <h2 className="mt-6 text-label-md text-ink-muted">{category}</h2>
          <ul className="divide-y divide-line border-b border-line">
            {menus.map((menu) => (
              <li key={menu.name}>
                <MenuRow menu={menu} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Note className="mt-5">정보가 실제와 다를 수 있어요</Note>
    </div>
  );
}

// 시설 칩의 아이콘. 공통 아이콘에 주차 아이콘이 없어 주차는 글자만 둔다
const FACILITY_ICONS: Partial<Record<Facility, ReactElement>> = {
  WIFI: <WifiIcon size="md" />,
  GROUP: <UsersIcon size="md" />,
  RESERVATION: <CalendarIcon size="md" />,
};

// 정보 탭(6-04, 와이어프레임 DetailInfo)
export function InfoTab({ detail, here, now }: TabProps & { now: Date }) {
  const { place } = detail;
  return (
    <div className="flex flex-col">
      <Section>
        <SectionHeader title="영업시간" />
        <OpenStatusText
          status={detail.openStatus}
          notice={todayNotice(detail.hours, detail.openStatus, now)}
        />
        <WeekHours
          hours={detail.hours}
          today={todayHours(detail.hours, now)?.dayOfWeek}
          className="mt-1"
        />
        {detail.closedDayNote && (
          <p className="mt-2 text-body-sm text-ink-muted">
            {detail.closedDayNote}
          </p>
        )}
      </Section>
      <Section>
        <SectionHeader title="위치" />
        <AddressRow detail={detail} here={here} copyable />
        {/* 정보 탭을 열 때만 만든다(지도 사용량은 지도 생성 횟수). 쓸 수 없으면 자리를 차지하지 않는다 */}
        <PlaceMap
          pins={[{ id: place.id, lat: place.lat, lng: place.lng }]}
          selectedId={place.id}
          center={place}
          onPinClick={() => {}}
          className="mt-2 h-36 w-full rounded-md"
        />
      </Section>
      {(detail.phone || detail.website) && (
        <Section>
          <SectionHeader title="연락처" />
          <ContactRows detail={detail} />
        </Section>
      )}
      <Section>
        {detail.facilities.length > 0 && (
          <>
            <SectionHeader title="시설" />
            <ul className="flex flex-wrap gap-2">
              {detail.facilities.map((facility) => (
                <li
                  key={facility}
                  className="flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-body-sm text-ink"
                >
                  {FACILITY_ICONS[facility]}
                  {FACILITY_LABELS[facility]}
                </li>
              ))}
            </ul>
          </>
        )}
        <Note className={cn(detail.facilities.length > 0 && "mt-3.5")}>
          정보가 실제와 다를 수 있어요
        </Note>
      </Section>
    </div>
  );
}

// 두꺼운 띠로 나뉘는 섹션(와이어프레임 sec)
function Section({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col border-t-8 border-line px-5 py-7">
      {children}
    </section>
  );
}

// "영업 중 · 오늘 08:00 – 22:00". 영업 상태를 모르면 안내만 보인다
function OpenStatusLine({
  detail,
  notice,
}: {
  detail: PlaceDetail;
  notice: string;
}) {
  if (!OPEN_STATUS_LABELS[detail.openStatus]) return notice;
  return <OpenStatusText status={detail.openStatus} notice={notice} />;
}

function AddressRow({
  detail,
  here,
  copyable,
}: TabProps & { copyable?: boolean }) {
  const toast = useToast();

  function copy() {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    (clipboard?.writeText(detail.address) ?? Promise.reject())
      .then(() => toast("주소를 복사했어요"))
      .catch(() => toast("주소를 복사하지 못했어요"));
  }

  return (
    <div className="flex items-start gap-3 py-2.5">
      <PinIcon size="md" className="mt-0.5 text-ink-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex items-center text-body-md text-ink">
          {detail.address}
          {copyable && (
            <button
              type="button"
              aria-label="주소 복사"
              onClick={copy}
              className="-my-3 ml-0.5 flex size-11 shrink-0 items-center justify-center text-ink-muted"
            >
              <CopyIcon size="sm" />
            </button>
          )}
        </p>
        {here && (
          <p className="text-caption-md text-ink-muted">
            내 위치에서 {formatDistance(distanceMeters(here, detail.place))}
          </p>
        )}
      </div>
    </div>
  );
}

function ContactRows({ detail }: { detail: PlaceDetail }) {
  return (
    <>
      {detail.phone && (
        <ContactRow
          icon={<PhoneIcon size="md" />}
          href={`tel:${detail.phone}`}
          trailing={<ChevronRightIcon size="md" />}
        >
          {detail.phone}
        </ContactRow>
      )}
      {detail.website && (
        <ContactRow
          icon={<GlobeIcon size="md" />}
          href={detail.website}
          target="_blank"
          rel="noreferrer"
          aria-label={`${detail.website} 웹사이트 열기`}
          trailing={<ExternalLinkIcon size="md" />}
        >
          {detail.website}
        </ContactRow>
      )}
    </>
  );
}

function ContactRow({
  icon,
  trailing,
  children,
  ...props
}: {
  icon: ReactElement;
  trailing: ReactElement;
  children: ReactNode;
  href: string;
  target?: string;
  rel?: string;
  "aria-label"?: string;
}) {
  return (
    <a {...props} className="flex min-h-11 items-center gap-3 py-2.5">
      <span className="text-ink-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-body-md text-ink">
        {children}
      </span>
      <span className="text-ink-muted">{trailing}</span>
    </a>
  );
}

// 요일별 영업시간 표. 오늘 줄은 굵게, 브레이크타임과 라스트오더는 줄마다 덧붙인다
function WeekHours({
  hours,
  today,
  className,
}: {
  hours: Hours[];
  today?: DayCode;
  className?: string;
}) {
  return (
    <table className={cn("w-full text-body-md", className)}>
      <tbody>
        {hours.map((day) => {
          const isToday = day.dayOfWeek === today;
          return (
            <tr
              key={day.dayOfWeek}
              className={cn(
                "border-b border-line align-top",
                isToday ? "font-semibold text-ink" : "text-ink",
              )}
            >
              <th
                scope="row"
                className={cn(
                  "w-16 py-2.5 text-left",
                  isToday
                    ? "font-semibold text-ink"
                    : "font-normal text-ink-muted",
                )}
              >
                {DAY_LABELS[day.dayOfWeek]}
                {isToday && " · 오늘"}
              </th>
              <td className={cn("py-2.5", day.closed && "text-ink-muted")}>
                <span className="block">{hoursText(day)}</span>
                {hoursNotes(day).map((note) => (
                  <span key={note} className="block">
                    {note}
                  </span>
                ))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
