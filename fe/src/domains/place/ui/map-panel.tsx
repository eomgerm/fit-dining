"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

// 중간(5-04), 전체(5-05), 요청 기록 펼침(와이어프레임 RequestHistory)
export type PanelState = "middle" | "full" | "history";

// 중간 높이에서 패널 위 끝. 지도 영역 높이의 비율(%)
const MIDDLE_TOP_PERCENT = 40;

// 패널이 지금 어느 상태든, 중간 상태일 때 패널 위 끝의 화면 좌표(px). 패널 영역(지도 화면 전체) 기준이다.
// 지도와 겹친 높이를 잴 때 쓴다(place-search spec 65번)
export function middlePanelTop(area: { top: number; height: number }) {
  return area.top + (area.height * MIDDLE_TOP_PERCENT) / 100;
}

// 손잡이를 이만큼 끌면 상태를 바꾼다
const DRAG_THRESHOLD_PX = 30;

// 패널은 늘 지도 영역 높이이고, 상태마다 이만큼 아래로 내려 화면 밑으로 잘린다.
// 위 safe area 띠(홈 화면 추가 배너가 떠 있으면 그 높이 포함)만큼 덜 내려 본문 위 끝을 맞춘다. cqh는 바깥 감싸개 높이 기준이다
const PANEL_Y: Record<PanelState, string> = {
  full: "0px",
  middle: `calc(${MIDDLE_TOP_PERCENT}cqh - env(safe-area-inset-top) - var(--install-banner-height))`,
  // 지도 위 버튼(저장한 장소, 내 정보) 아래까지 펼친다
  history: "calc(var(--spacing) * 30)",
};

// 패널과 바닥 고정 영역이 같은 곡선으로 함께 움직인다(높이 전환 320ms, 제자리 변화).
// 끄는 동안(data-dragging)은 전환 없이 손가락을 따른다
const MOVE =
  "transition-transform duration-320 ease-standard motion-reduce:transition-none";
// 지금 위치. 끄는 동안은 --panel-drag(px)가 앞선다
const PANEL_TRANSLATE = "var(--panel-drag, var(--panel-y))";
const FADE =
  "transition-opacity duration-320 ease-standard motion-reduce:duration-120";

// 지도 위 하단 패널(결과, 과거 결과, 저장한 장소). 높이를 바꾸지 않고 위치(translate)만 옮겨
// 전환 중에 레이아웃을 다시 계산하지 않는다.
// 패널 안 스크롤 목록은 화면 밖으로 잘린 만큼(--panel-y) 아래 여백을 더한다(pb-panel-*).
// 목록 끝까지 내린 채 펼치면 줄어든 여백만큼 전환 시작에 목록이 한 번 끝 위치로 맞춰진다
export function MapPanel({
  state,
  label,
  edge,
  footer,
  onStateChange,
  children,
}: {
  // middle: 화면 60%, full: 화면 전체(상태바 아래부터 내용), history: 지도 위 버튼 아래까지
  state: PanelState;
  // 화면 낭독기가 읽는 패널 이름
  label: string;
  // 패널 위쪽 가장자리에 붙는 지도 버튼("내 위치"). 중간 높이에서만 보인다
  edge?: ReactNode;
  // 화면 바닥에 붙는 영역. 패널이 움직여도 제자리에 있다. 아래 끝 여백은 pb-safe-*로 맡는다
  footer?: ReactNode;
  // 있으면 손잡이로 중간과 전체를 오간다. 없으면 손잡이는 모양만 있다
  onStateChange?: (state: Exclude<PanelState, "history">) => void;
  children: ReactNode;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startY: number; from: number }>(
    undefined,
  );
  // 끌기였으면 뒤따르는 클릭을 한 번 무시한다
  const skipClick = useRef(false);
  const full = state === "full";
  const expanded = state !== "middle";

  function moveTo(y?: number) {
    const section = sectionRef.current;
    if (!section) return;
    if (y === undefined) {
      section.style.removeProperty("--panel-drag");
      section.removeAttribute("data-dragging");
    } else {
      section.style.setProperty("--panel-drag", `${y}px`);
      section.setAttribute("data-dragging", "");
    }
  }

  function endDrag(clientY?: number) {
    const start = drag.current?.startY;
    drag.current = undefined;
    moveTo();
    if (start === undefined || clientY === undefined || !onStateChange) return;
    const delta = clientY - start;
    if (Math.abs(delta) <= DRAG_THRESHOLD_PX) return;
    skipClick.current = true;
    onStateChange(delta < 0 ? "full" : "middle");
  }

  const handle = onStateChange ? (
    <button
      type="button"
      aria-label={expanded ? "패널 줄이기" : "패널 펼치기"}
      onClick={(event) => {
        // 키보드로 누른 클릭(detail 0)은 끌기와 상관없다
        if (skipClick.current && event.detail > 0) {
          skipClick.current = false;
          return;
        }
        onStateChange(expanded ? "middle" : "full");
      }}
      onPointerDown={(event) => {
        const section = sectionRef.current;
        const area = section?.parentElement;
        if (!section || !area || !event.isPrimary || event.button !== 0) {
          return;
        }
        skipClick.current = false;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        // 전환 중에 잡아도 지금 보이는 위치에서 이어 끈다
        drag.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          from:
            section.getBoundingClientRect().top -
            area.getBoundingClientRect().top,
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        const area = sectionRef.current?.parentElement;
        if (!current || current.pointerId !== event.pointerId || !area) return;
        // 전체 높이와 중간 높이 사이에서만 움직인다
        const middle =
          (area.clientHeight * MIDDLE_TOP_PERCENT) / 100 -
          (spacerRef.current?.offsetHeight ?? 0);
        const delta = event.clientY - current.startY;
        // 한 번이라도 멀리 끌었으면 제자리에서 놓아도 탭이 아니다
        if (Math.abs(delta) > DRAG_THRESHOLD_PX) skipClick.current = true;
        const y = current.from + delta;
        moveTo(Math.min(Math.max(y, 0), Math.max(middle, current.from)));
      }}
      onPointerUp={(event) => endDrag(event.clientY)}
      onPointerCancel={() => endDrag()}
      // 놓거나 취소하지 않고 캡처를 잃어도 끌기를 끝낸다
      onLostPointerCapture={() => endDrag()}
      className="flex h-6 shrink-0 touch-none items-center justify-center"
    >
      <span className="h-1 w-9 rounded-full bg-line-strong" />
    </button>
  ) : (
    <div aria-hidden className="flex h-6 shrink-0 items-center justify-center">
      <span className="h-1 w-9 rounded-full bg-line-strong" />
    </div>
  );

  return (
    // 지도 영역 전체를 덮지만 패널 바깥은 지도가 누름을 받는다. 패널 위치(cqh)의 기준이다
    <div className="@container-size pointer-events-none absolute inset-0 overflow-clip">
      <section
        ref={sectionRef}
        aria-label={label}
        style={
          {
            "--panel-y": PANEL_Y[state],
            translate: `0 ${PANEL_TRANSLATE}`,
          } as CSSProperties
        }
        className={cn(
          "flex h-full flex-col data-dragging:transition-none",
          MOVE,
        )}
      >
        {/* 전체 높이에서 상태바 뒤를 채운다. 그 밖에서는 투명해 둥근 위 모서리 위로 지도가 보인다 */}
        <div
          ref={spacerRef}
          aria-hidden
          className={cn(
            // 움직임 줄이기에서는 패널과 함께 바로 바뀐다. 늦게 사라지면 패널 위에 흰 띠가 떠 보인다
            "shrink-0 bg-surface pt-safe-0 transition-opacity duration-320 ease-standard motion-reduce:transition-none",
            full ? "pointer-events-auto" : "opacity-0",
          )}
        />
        <div
          // 여기서 바뀌는 것은 모서리와 그림자뿐이라 레이아웃은 다시 계산하지 않는다
          className={cn(
            "pointer-events-auto relative flex min-h-0 flex-1 flex-col bg-surface transition-all duration-320 ease-standard motion-reduce:transition-none",
            !full && "rounded-t-xl shadow-sheet",
          )}
        >
          {edge && (
            <div
              inert={state !== "middle"}
              className={cn(
                "absolute right-4 bottom-full mb-3",
                FADE,
                state !== "middle" && "opacity-0",
              )}
            >
              {edge}
            </div>
          )}
          {handle}
          {children}
          {footer && (
            // 패널이 내려간 만큼 거꾸로 올려 화면 바닥에 둔다
            <div
              style={{ translate: `0 calc(${PANEL_TRANSLATE} * -1)` }}
              className={cn(
                "shrink-0 bg-surface in-data-dragging:transition-none",
                MOVE,
              )}
            >
              {footer}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
