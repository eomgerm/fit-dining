"use client";

import {
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "@/shared/lib/cn";
import { Note } from "@/shared/ui/display/note";
import type { IconProps } from "@/shared/ui/icon/icon";
import { BabyIcon } from "@/shared/ui/icon/icons/baby";
import { CalendarIcon } from "@/shared/ui/icon/icons/calendar";
import { CheckIcon } from "@/shared/ui/icon/icons/check";
import { ChevronDownIcon } from "@/shared/ui/icon/icons/chevron-down";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { ClockIcon } from "@/shared/ui/icon/icons/clock";
import { CopyIcon } from "@/shared/ui/icon/icons/copy";
import { ExternalLinkIcon } from "@/shared/ui/icon/icons/external-link";
import { GlobeIcon } from "@/shared/ui/icon/icons/globe";
import { LeafIcon } from "@/shared/ui/icon/icons/leaf";
import { ParkingIcon } from "@/shared/ui/icon/icons/parking";
import { PawIcon } from "@/shared/ui/icon/icons/paw";
import { PhoneIcon } from "@/shared/ui/icon/icons/phone";
import { PinIcon } from "@/shared/ui/icon/icons/pin";
import { RestroomIcon } from "@/shared/ui/icon/icons/restroom";
import { ShoppingBagIcon } from "@/shared/ui/icon/icons/shopping-bag";
import { UsersIcon } from "@/shared/ui/icon/icons/users";
import { WheelchairIcon } from "@/shared/ui/icon/icons/wheelchair";
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
  facilityIconGroup,
  OPEN_STATUS_LABELS,
  type FacilityIconGroup,
} from "../model/place-labels";
import type {
  DayCode,
  Hours,
  LatLng,
  Menu,
  PlaceCard,
  PlaceDetail,
  PlaceFit,
} from "../model/place-types";
import { MenuCard, MenuRow } from "./menu-card";
import { OpenStatusText } from "./place-parts";
import { PlaceMap } from "./place-map";
import { GivenReasons, PlaceReasons } from "./place-reasons";

const MENU_PREVIEW_COUNT = 6;

type TabProps = {
  detail: PlaceDetail;
  here?: LatLng;
};

// 홈 탭(6-01, 와이어프레임 Detail). 섹션 사이는 두꺼운 띠로 나눈다.
// 추천 이유는 검색 카드가 있을 때만 보인다. 근거 부족 안내와 주의점은 두지 않는다(5단계 상세 추천 이유).
// 모임에서 열었으면 모임 결과가 준 추천 이유와 주의점을 그대로 보인다(모임 D-22)
export function HomeTab({
  detail,
  card,
  sentence,
  fit,
  here,
  now,
  onShowInfo,
  onShowMenu,
  reviews,
}: TabProps & {
  card?: PlaceCard;
  // 카드를 받은 검색의 요청 문장. 추천 이유 API에 보낸다
  sentence?: string;
  // 모임에서 연 상세면 모임 결과가 준 점수·추천 이유·주의점이다(모임 D-22)
  fit?: PlaceFit;
  now: Date;
  onShowInfo: () => void;
  onShowMenu: () => void;
  // 맨 아래 리뷰 미리보기. app이 리뷰 도메인으로 채운다
  reviews?: ReactNode;
}) {
  const [weekOpen, setWeekOpen] = useState(false);
  const today = todayHours(detail.hours, now);

  return (
    <div className="flex flex-col">
      {card && card.reasons.length > 0 && (
        <Section>
          <PlaceReasons
            placeId={detail.place.id}
            reasons={card.reasons}
            sentence={sentence}
          />
        </Section>
      )}
      {fit && (fit.reasons.length > 0 || fit.caution) && (
        <Section>
          <GivenReasons fit={fit} />
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
          <span className="flex-1 text-body-md leading-5.5 text-ink">
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
            className="mb-3 flex min-h-11 items-center gap-0.5 self-start text-title-lg text-ink"
          >
            메뉴
            <span className="ml-1.5 font-semibold text-ink-muted">
              {detail.menus.length}
            </span>
            <ChevronRightIcon size="md" />
          </button>
          <div
            role="list"
            aria-label="대표 메뉴"
            className="-mx-5 flex gap-3 overflow-x-auto px-5"
          >
            {previewMenus(detail.menus).map((menu) => (
              <MenuCard key={`${menu.category}-${menu.name}`} menu={menu} />
            ))}
          </div>
        </Section>
      )}
      {reviews && <Section>{reviews}</Section>}
    </div>
  );
}

// 홈 탭 메뉴 미리보기. 대표 메뉴를 먼저, 나머지는 원래 순서로 채운다(6-01)
function previewMenus(menus: Menu[]) {
  return [
    ...menus.filter((menu) => menu.representative),
    ...menus.filter((menu) => !menu.representative),
  ].slice(0, MENU_PREVIEW_COUNT);
}

// 메뉴 탭(6-02, 와이어프레임 DetailMenu). 원래 순서대로 보이고, 이어지는 같은 카테고리마다 머리글을 붙인다.
// 카테고리 없는 메뉴는 머리글 없이 그 자리에 보인다. 메뉴 이름은 한 장소 안에서도 겹칠 수 있어 순번을 key로 쓴다
export function MenuTab({ detail }: TabProps) {
  const groups: { category?: string; menus: Menu[] }[] = [];
  for (const menu of detail.menus) {
    const last = groups[groups.length - 1];
    if (last && last.category === menu.category) {
      last.menus.push(menu);
    } else {
      groups.push({ category: menu.category, menus: [menu] });
    }
  }
  return (
    <div className="flex flex-col px-5 pt-2 pb-7">
      {groups.map((group, index) => (
        <section key={index} className="flex flex-col">
          {group.category && (
            <h2 className="mt-6 text-label-md text-ink-muted">
              {group.category}
            </h2>
          )}
          <ul className="divide-y divide-line border-b border-line">
            {group.menus.map((menu, menuIndex) => (
              <li key={menuIndex}>
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

// 시설 칩의 아이콘. 묶음에 없는 시설은 기본 아이콘(체크)이다
const FACILITY_ICONS: Record<FacilityIconGroup, ComponentType<IconProps>> = {
  parking: ParkingIcon,
  wifi: WifiIcon,
  group: UsersIcon,
  reservation: CalendarIcon,
  takeout: ShoppingBagIcon,
  restroom: RestroomIcon,
  kids: BabyIcon,
  wheelchair: WheelchairIcon,
  pet: PawIcon,
  menu: LeafIcon,
};

function FacilityIcon({ name }: { name: string }) {
  const group = facilityIconGroup(name);
  const Icon = group ? FACILITY_ICONS[group] : CheckIcon;
  return <Icon size="md" data-icon={group ?? "default"} />;
}

// 노선이 숫자면 "2호선", 아니면 끝에 "선"을 붙인다("신분당" → "신분당선")
function subwayLine(line: string) {
  if (/^\d+$/.test(line)) return `${line}호선`;
  return line.endsWith("선") ? line : `${line}선`;
}

function dotted(parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" · ");
}

function yesNo(value: boolean | undefined, yes: string, no: string) {
  if (value === undefined) return undefined;
  return value ? yes : no;
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="break-all text-primary-strong underline"
    >
      {children}
    </a>
  );
}

// 정보 탭의 "제목 · 내용" 줄. 이 순서가 화면 순서이고, 내용이 없는 항목은 줄째 뺀다
function infoLines(detail: PlaceDetail): [string, ReactNode[]][] {
  const { parking, pet, corkage } = detail;
  const lines: [string, (ReactNode | false | undefined)[]][] = [
    [
      "지하철",
      detail.subways.map((subway) =>
        dotted([
          subway.station,
          subway.line && subwayLine(subway.line),
          subway.exit && `${subway.exit}번 출구`,
          subway.walkMinutes !== undefined && `도보 ${subway.walkMinutes}분`,
        ]),
      ),
    ],
    ["찾아오는 길", [detail.directions]],
    [
      "주차",
      [
        parking &&
          dotted([
            yesNo(parking.free, "무료", "유료"),
            parking.valet && "발렛",
            parking.note,
          ]),
      ],
    ],
    [
      "예약",
      [
        detail.bookingUrl && (
          <ExternalLink href={detail.bookingUrl}>네이버 예약</ExternalLink>
        ),
      ],
    ],
    [
      "반려동물",
      [pet && dotted([yesNo(pet.allowed, "동반 가능", "동반 불가"), pet.note])],
    ],
    ["노키즈존", [detail.noKidsZone && "운영"]],
    [
      "콜키지",
      [
        corkage &&
          dotted([yesNo(corkage.allowed, "가능", "불가"), corkage.note]),
      ],
    ],
    ["좌석", detail.seats.map((seat) => dotted([seat.name, seat.description]))],
    ["업체 소개", [detail.description]],
    [
      "결제 수단",
      [detail.paymentMethods.length > 0 && detail.paymentMethods.join(", ")],
    ],
    [
      "방송",
      detail.broadcasts.map((broadcast) =>
        dotted([
          broadcast.channel,
          broadcast.program,
          broadcast.episode && `${broadcast.episode}회`,
          broadcast.airedOn,
          broadcast.menu,
        ]),
      ),
    ],
    [
      "다른 링크",
      detail.extraLinks.map((url) => (
        <ExternalLink key={url} href={url}>
          {url}
        </ExternalLink>
      )),
    ],
  ];
  return lines
    .map(([title, values]): [string, ReactNode[]] => [
      title,
      values.filter((value) => !!value),
    ])
    .filter(([, values]) => values.length > 0);
}

// 정보 탭(6-04, 와이어프레임 DetailInfo). 기존 항목 아래, 안내 문구 위에 값이 있는 항목만 "제목 · 내용" 줄로 더한다
export function InfoTab({ detail, here, now }: TabProps & { now: Date }) {
  const { place } = detail;
  const lines = infoLines(detail);
  return (
    <div className="flex flex-col">
      {/* 정보 탭 첫 섹션은 위 여백이 16px이다(6-04) */}
      <Section className="pt-4">
        <SectionHeader title="영업시간" className="mb-3" />
        <OpenStatusText
          status={detail.openStatus}
          notice={todayNotice(detail.hours, detail.openStatus, now)}
          className="text-ink"
        />
        <WeekHours
          hours={detail.hours}
          today={todayHours(detail.hours, now)?.dayOfWeek}
          className="mt-1 leading-5.5"
        />
      </Section>
      <Section>
        <SectionHeader title="위치" className="mb-3" />
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
          <SectionHeader title="연락처" className="mb-3" />
          <ContactRows detail={detail} />
        </Section>
      )}
      <Section>
        {detail.facilities.length > 0 && (
          <>
            <SectionHeader title="시설" className="mb-3" />
            <ul className="flex flex-wrap gap-2">
              {detail.facilities.map((facility) => (
                <li
                  key={facility}
                  className="flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-body-sm text-ink"
                >
                  <FacilityIcon name={facility} />
                  {facility}
                </li>
              ))}
            </ul>
          </>
        )}
        {lines.length > 0 && (
          <dl
            className={cn(
              "flex flex-col gap-2.5 text-body-md",
              detail.facilities.length > 0 && "mt-5",
            )}
          >
            {lines.map(([title, values]) => (
              <div key={title} className="flex gap-1.5">
                <dt className="shrink-0 text-ink-muted">{title}</dt>
                <dd className="flex min-w-0 gap-1.5">
                  <span aria-hidden className="text-ink-muted">
                    ·
                  </span>
                  <span
                    data-info-value
                    className="flex min-w-0 flex-col gap-0.5 whitespace-pre-line text-ink"
                  >
                    {values.map((value, index) => (
                      <span key={index}>{value}</span>
                    ))}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <Note
          className={cn(
            (detail.facilities.length > 0 || lines.length > 0) && "mt-3.5",
          )}
        >
          정보가 실제와 다를 수 있어요
        </Note>
      </Section>
    </div>
  );
}

// 두꺼운 띠로 나뉘는 섹션(와이어프레임 sec). 탭 바로 아래 첫 섹션에는 띠가 없다
function Section({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col border-line px-5 py-7 not-first:border-t-8",
        className,
      )}
    >
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
  return (
    <OpenStatusText
      status={detail.openStatus}
      notice={notice}
      className="text-body-md leading-5.5 text-ink"
    />
  );
}

function AddressRow({
  detail,
  here,
  copyable,
}: TabProps & { copyable?: boolean }) {
  const toast = useToast();

  function copy() {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    (
      clipboard?.writeText(detail.address) ??
      Promise.reject(new Error("clipboard unavailable"))
    )
      .then(() => toast("주소를 복사했어요"))
      .catch(() => toast("주소를 복사하지 못했어요"));
  }

  return (
    <div className="flex items-start gap-3 py-2.5">
      <PinIcon size="md" className="mt-0.5 text-ink-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex items-center text-body-md leading-5.5 text-ink">
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

// 웹사이트 줄에는 도메인만 보인다("https://cafeondam.example/" → "cafeondam.example"). 주소가 아니면 원문이다
function siteName(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
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
          aria-label={`${siteName(detail.website)} 웹사이트 열기`}
          trailing={<ExternalLinkIcon size="md" />}
        >
          {siteName(detail.website)}
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
      <span className="min-w-0 flex-1 truncate text-body-md leading-5.5 text-ink">
        {children}
      </span>
      <span className="text-ink-muted">{trailing}</span>
    </a>
  );
}

// 요일별 영업시간 표. 오늘 줄은 굵게, 브레이크타임과 라스트오더는 줄마다 덧붙인다.
// 줄 아래 선(1px)이 높이를 차지하므로 아래 여백을 1px 줄여 시안(선이 높이를 차지하지 않는 줄 86px)과 맞춘다
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
                  "w-16 pt-2.5 pb-2.25 text-left",
                  isToday
                    ? "font-semibold text-ink"
                    : "font-normal text-ink-muted",
                )}
              >
                {DAY_LABELS[day.dayOfWeek]}
                {isToday && " · 오늘"}
              </th>
              <td
                className={cn("pt-2.5 pb-2.25", day.closed && "text-ink-muted")}
              >
                {/* 휴무 요일은 BE closedDayNote와 같은 정기휴무다(날짜가 붙은 휴무는 '정보 없음'). 표 안에 적는다 */}
                <span className="block">
                  {day.closed
                    ? `정기휴무 (매주 ${DAY_LABELS[day.dayOfWeek]}요일)`
                    : hoursText(day)}
                </span>
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
