"use client";

import { useState, type ReactNode } from "react";

import { TextButton } from "@/shared/ui/button/text-button";
import { InfoRow } from "@/shared/ui/display/info-row";
import { Note } from "@/shared/ui/display/note";
import { Tag } from "@/shared/ui/display/tag";
import { ChevronDownIcon } from "@/shared/ui/icon/icons/chevron-down";
import { ChevronUpIcon } from "@/shared/ui/icon/icons/chevron-up";
import { ClockIcon } from "@/shared/ui/icon/icons/clock";
import { GlobeIcon } from "@/shared/ui/icon/icons/globe";
import { PhoneIcon } from "@/shared/ui/icon/icons/phone";
import { PinIcon } from "@/shared/ui/icon/icons/pin";
import {
  SectionHeader,
  SectionHeaderAction,
} from "@/shared/ui/layout/section-header";

import { distanceMeters, formatDistance } from "../model/nearby";
import { DAY_LABELS, hoursText, todayHours } from "../model/opening-hours";
import { evidenceText, FACILITY_LABELS } from "../model/place-labels";
import type {
  Hours,
  LatLng,
  Menu,
  PlaceCard,
  PlaceDetail,
} from "../model/place-types";
import { MenuCard, MenuRow } from "./menu-card";

const MENU_PREVIEW_COUNT = 6;

type TabProps = {
  detail: PlaceDetail;
  here?: LatLng;
};

// 홈 탭(6-01). 추천 이유와 주의점은 검색 카드가 있을 때만 보인다
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

  return (
    <div className="flex flex-col gap-8 px-4 py-6">
      {card && card.reasons.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionHeader title="AI 추천 이유" />
          <ul className="flex flex-col gap-4">
            {card.reasons.map((reason) => (
              <li
                key={reason.title}
                className="flex flex-col gap-2 rounded-md bg-surface p-4"
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
                      <footer className="mt-1 text-caption-sm text-ink-subtle">
                        {reason.quoteSource}
                      </footer>
                    )}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {card?.caution && <Note tone="warn">{card.caution}</Note>}

      <section className="flex flex-col">
        <AddressRow detail={detail} here={here} />
        <button
          type="button"
          aria-expanded={weekOpen}
          onClick={() => setWeekOpen(!weekOpen)}
          className="flex items-start gap-3 py-2.5 text-left"
        >
          <ClockIcon size="md" className="mt-0.5 text-ink-muted" />
          <span className="flex-1 text-body-md text-ink">
            오늘 {today ? hoursText(today) : "영업시간 정보 없음"}
          </span>
          {weekOpen ? (
            <ChevronUpIcon size="md" className="mt-0.5 text-ink-muted" />
          ) : (
            <ChevronDownIcon size="md" className="mt-0.5 text-ink-muted" />
          )}
        </button>
        {weekOpen && <WeekHours hours={detail.hours} className="pb-2 pl-8" />}
        <ContactRows detail={detail} />
        <TextButton onClick={onShowInfo} className="self-start">
          정보 더보기
        </TextButton>
      </section>

      {detail.menus.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader
            title="메뉴"
            count={detail.menus.length}
            action={
              <SectionHeaderAction onClick={onShowMenu}>
                전체 보기
              </SectionHeaderAction>
            }
          />
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4">
            {detail.menus.slice(0, MENU_PREVIEW_COUNT).map((menu) => (
              <MenuCard key={`${menu.category}-${menu.name}`} menu={menu} />
            ))}
          </div>
        </section>
      )}
      {reviews}
    </div>
  );
}

// 메뉴 탭(6-02). 카테고리별로 묶는다
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
    <div className="flex flex-col gap-6 px-4 py-6">
      {[...categories].map(([category, menus]) => (
        <section key={category} className="flex flex-col">
          <h2 className="text-title-md text-ink">{category}</h2>
          <ul className="divide-y divide-line">
            {menus.map((menu) => (
              <li key={menu.name}>
                <MenuRow menu={menu} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Note>정보가 실제와 다를 수 있어요</Note>
    </div>
  );
}

// 정보 탭(6-04). 위치 지도는 그리지 않는다
export function InfoTab({ detail, here }: TabProps) {
  return (
    <div className="flex flex-col gap-8 px-4 py-6">
      <section className="flex flex-col gap-3">
        <SectionHeader title="영업시간" />
        <WeekHours hours={detail.hours} detailed />
        {detail.closedDayNote && (
          <p className="text-body-sm text-ink-muted">{detail.closedDayNote}</p>
        )}
      </section>
      <section className="flex flex-col gap-1">
        <SectionHeader title="위치" />
        <AddressRow detail={detail} here={here} />
      </section>
      {(detail.phone || detail.website) && (
        <section className="flex flex-col gap-1">
          <SectionHeader title="연락처" />
          <ContactRows detail={detail} />
        </section>
      )}
      {detail.facilities.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader title="시설" />
          <div className="flex flex-wrap gap-1">
            {detail.facilities.map((facility) => (
              <Tag key={facility}>{FACILITY_LABELS[facility]}</Tag>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AddressRow({ detail, here }: TabProps) {
  return (
    <InfoRow
      icon={<PinIcon size="md" />}
      title={detail.address}
      description={
        here &&
        `내 위치에서 ${formatDistance(distanceMeters(here, detail.place))}`
      }
    />
  );
}

function ContactRows({ detail }: { detail: PlaceDetail }) {
  return (
    <>
      {detail.phone && (
        <InfoRow
          icon={<PhoneIcon size="md" />}
          title={detail.phone}
          href={`tel:${detail.phone}`}
        />
      )}
      {detail.website && (
        <InfoRow
          icon={<GlobeIcon size="md" />}
          title={detail.website}
          href={detail.website}
          target="_blank"
          rel="noreferrer"
        />
      )}
    </>
  );
}

// 요일별 영업시간. detailed면 브레이크타임과 라스트오더까지 보인다
function WeekHours({
  hours,
  detailed,
  className,
}: {
  hours: Hours[];
  detailed?: boolean;
  className?: string;
}) {
  return (
    <dl className={className}>
      {hours.map((day) => (
        <div key={day.dayOfWeek} className="flex gap-4 py-1 text-body-sm">
          <dt className="w-4 shrink-0 text-ink-muted">
            {DAY_LABELS[day.dayOfWeek]}
          </dt>
          <dd className="flex flex-col text-ink">
            <span>{hoursText(day)}</span>
            {detailed && !day.closed && day.breakStart && day.breakEnd && (
              <span className="text-caption-md text-ink-muted">
                브레이크타임 {day.breakStart} - {day.breakEnd}
              </span>
            )}
            {detailed && !day.closed && day.lastOrders.length > 0 && (
              <span className="text-caption-md text-ink-muted">
                라스트오더 {day.lastOrders.join(", ")}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
