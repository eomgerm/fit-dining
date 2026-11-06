"use client";

import { useEffect, useRef, useState } from "react";

// Chrome 계열의 VirtualKeyboard API. TS DOM 타입에 아직 없다
type VirtualKeyboard = EventTarget & {
  overlaysContent: boolean;
  boundingRect: DOMRect;
};

// 손가락이 이만큼 넘게 움직였으면 탭이 아니다
const TAP_SLOP_PX = 10;

// 지난번에 잰 키보드 높이. 키보드 높이는 키보드가 움직이기 시작한 뒤에야 오므로,
// 초점이 가는 순간 이 높이로 미리 올려 키보드와 함께 움직이기 시작한다
const REMEMBERED_KEY = "fd.keyboard-inset.v1";
// 잰 적이 없을 때 어림하는 키보드 높이(레이아웃 높이 비율). 실제보다 작으면 입력창이 가려져
// 브라우저가 화면을 밀어 올리므로 조금 크게 잡는다(실측: 아이폰 46.5%, 갤럭시 삼성 키보드 42%)
const GUESS_RATIO = 0.47;
// 초점을 준 뒤 이 시간 동안은 키보드가 아직 안 올라와 0으로 재져도 미리 올린 높이를 지킨다.
// 끝나면 한 번 다시 재, 키보드가 뜨지 않았으면(하드웨어 키보드, 코드로 준 초점) 제자리로 내린다
const PREDICT_HOLD_MS = 1000;

function remembered() {
  try {
    return Number(localStorage.getItem(REMEMBERED_KEY)) || 0;
  } catch {
    return 0;
  }
}

function remember(height: number) {
  try {
    if (remembered() === Math.round(height)) return;
    localStorage.setItem(REMEMBERED_KEY, String(Math.round(height)));
  } catch {
    // 저장하지 못하면 다음에도 키보드를 뒤따라 올린다
  }
}

// 터치한 곳에서 스크롤할 수 있는 상자가 있는지(패널 목록, 가로 카드 줄)
function insideScroller(target: EventTarget | null) {
  for (
    let element = target instanceof Element ? target : null;
    element && element !== document.body;
    element = element.parentElement
  ) {
    const { overflowX, overflowY } = getComputedStyle(element);
    const scrollable = (overflow: string) =>
      overflow === "auto" || overflow === "scroll";
    if (
      (scrollable(overflowY) && element.scrollHeight > element.clientHeight) ||
      (scrollable(overflowX) && element.scrollWidth > element.clientWidth)
    ) {
      return true;
    }
  }
  return false;
}

// 키보드를 따라 움직이는 시간(KEYBOARD_MOTION의 가장 긴 시간)보다 조금 길게. 그동안 커서를 숨긴다
const MOVE_SETTLE_MS = 600;

// 키보드를 띄우는 입력칸
const TEXT_TYPES = [
  "text",
  "search",
  "email",
  "tel",
  "url",
  "password",
  "number",
];
const isTextField = (
  target: EventTarget | null,
): target is HTMLInputElement | HTMLTextAreaElement =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement && TEXT_TYPES.includes(target.type));

// 키보드가 오르내리는 시간과 곡선. 입력창이 키보드와 함께 움직이도록 OS 값을 그대로 쓴다(디자인 토큰이 아니다)
const KEYBOARD_MOTION = {
  // iOS: 키보드 알림의 곡선을 역추적한 값. 알림의 0.25초는 실제의 절반이라 0.5초로 쓴다
  // (developer.apple.com/forums/thread/48088, 실측 430~450ms: pub.dev/packages/keyboard_notification)
  ios: { duration: "500ms", ease: "cubic-bezier(0.38, 0.7, 0.125, 1)" },
  // Android: 앱이 키보드와 함께 움직일 때의 IME 애니메이션(AOSP InsetsController
  // ANIMATION_DURATION_SYNC_IME_MS, SYNC_IME_INTERPOLATOR). 열림·닫힘이 같다
  android: { duration: "285ms", ease: "cubic-bezier(0.2, 0, 0, 1)" },
};

// 화면 키보드가 화면 아래를 가린 높이(px). 지도 화면에서만 쓴다.
// 브라우저가 키보드를 띄우며 화면 전체를 밀어 올리지 않게 하고, 바닥에 붙은 입력창만 keyboardLift로 올린다.
// 브라우저가 입력칸을 보이게 올려 주는 동작을 문서 전체에서 끄므로, 이 화면에 입력칸을 더하면 그 칸도 keyboardLift로 올린다
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);

  // Safari의 커서는 CSS 이동을 따라오지 않고 먼저 최종 자리에 뜬다. 입력창이 움직이는 동안 숨긴다.
  // 화면에 들어올 때(첫 실행)는 움직이지 않으므로 건너뛴다
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      return;
    }
    const root = document.documentElement;
    root.setAttribute("data-keyboard-moving", "");
    const timer = setTimeout(
      () => root.removeAttribute("data-keyboard-moving"),
      MOVE_SETTLE_MS,
    );
    return () => {
      clearTimeout(timer);
      root.removeAttribute("data-keyboard-moving");
    };
  }, [inset]);

  useEffect(() => {
    const root = document.documentElement;
    const keyboard = (navigator as { virtualKeyboard?: VirtualKeyboard })
      .virtualKeyboard;
    const viewport = window.visualViewport;
    if (!keyboard && !viewport) return;

    // 초점이 오가는 순간 키보드보다 먼저 움직이기 시작한다. 실제 높이가 오면 그 값으로 맞춘다
    let predictedUntil = 0;
    const measured = (height: number) => {
      // 초점 직후 키보드보다 먼저 오는 이벤트가 미리 올린 높이를 지우지 않게 한다
      if (
        height === 0 &&
        isTextField(document.activeElement) &&
        performance.now() < predictedUntil
      ) {
        return;
      }
      if (height > 0) remember(height);
      setInset(height);
    };

    // https가 아니거나 삼성 인터넷처럼 VirtualKeyboard API가 없는 안드로이드 브라우저도 안드로이드 키보드다
    const android = !!keyboard || /Android/i.test(navigator.userAgent);
    const motion = KEYBOARD_MOTION[android ? "android" : "ios"];
    root.style.setProperty("--keyboard-duration", motion.duration);
    root.style.setProperty("--keyboard-ease", motion.ease);
    const watcher = keyboard
      ? watchVirtualKeyboard(keyboard, measured)
      : watchVisualViewport(viewport!, measured, android);
    // 화면이 숨었다 다시 보일 때 남아 있던 높이를 지금 값으로 맞춘다
    measured(watcher.read());

    // 화면 키보드가 뜨는 터치 기기에서만 미리 올린다
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const onFocusIn = (event: FocusEvent) => {
      if (
        !isTextField(event.target) ||
        !window.matchMedia("(pointer: coarse)").matches
      ) {
        return;
      }
      predictedUntil = performance.now() + PREDICT_HOLD_MS;
      setInset(remembered() || Math.round(root.clientHeight * GUESS_RATIO));
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => measured(watcher.read()), PREDICT_HOLD_MS);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!isTextField(event.relatedTarget)) setInset(0);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      watcher.stop();
      clearTimeout(holdTimer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      root.style.removeProperty("--keyboard-duration");
      root.style.removeProperty("--keyboard-ease");
    };
  }, []);

  return inset;
}

// Chrome 계열: 키보드를 화면 위에 겹쳐 띄우게 하고 그 크기를 받는다. 화면을 떠나면 되돌린다
function watchVirtualKeyboard(
  keyboard: VirtualKeyboard,
  measured: (height: number) => void,
) {
  const before = keyboard.overlaysContent;
  keyboard.overlaysContent = true;
  const read = () => keyboard.boundingRect.height;
  const update = () => measured(read());
  keyboard.addEventListener("geometrychange", update);
  const stop = () => {
    keyboard.removeEventListener("geometrychange", update);
    keyboard.overlaysContent = before;
  };
  return { read, stop };
}

// Safari와 VirtualKeyboard API가 없는 안드로이드 브라우저: 보이는 영역이 줄어든 만큼이 키보드다.
// Safari의 innerHeight는 보이는 영역을 따라 같이 줄어 레이아웃 높이(clientHeight)와 비교한다
function watchVisualViewport(
  viewport: VisualViewport,
  measured: (height: number) => void,
  android: boolean,
) {
  // 키보드가 올라오는 동안 iOS는 레이아웃 영역 높이를 잠깐 바꾸는데, 이때 스크롤 앵커링이 옛 값과 비교해
  // 화면을 키보드 높이만큼 튀게 한다(WebKit 267440). 이 화면에서는 문서의 스크롤 앵커링을 끈다
  const root = document.documentElement;
  const anchorBefore = [
    root.style.overflowAnchor,
    document.body.style.overflowAnchor,
  ];
  root.style.overflowAnchor = "none";
  document.body.style.overflowAnchor = "none";

  // 안드로이드 브라우저는 키보드가 다 올라온 뒤 입력창을 보이려고 보이는 영역을 위로 옮긴다(offsetTop).
  // 스크롤이 아니라 되돌릴 수 없어, 옮긴 만큼 페이지를 내려 화면을 제자리에 둔다.
  // 내린 페이지가 문서를 늘려 다시 옮겨지지 않게 문서 스크롤을 막는다
  const overflowBefore = root.style.overflow;
  if (android) root.style.overflow = "hidden";

  // 핀치로 확대하면 보이는 영역이 배율만큼 줄고 옮겨진다. 키보드가 아니므로 확대 중에는 재지 않는다
  const zoomed = () => viewport.scale > 1.01;
  const read = () =>
    zoomed() ? 0 : Math.max(0, root.clientHeight - viewport.height);
  const update = () => {
    // 그래도 밀어 올렸으면 되돌린다
    if (window.scrollY !== 0) window.scrollTo(0, 0);
    if (android) {
      const pan = zoomed() ? 0 : Math.round(viewport.offsetTop);
      document.body.style.translate = pan > 0 ? `0 ${pan}px` : "";
    }
    measured(read());
  };

  // Safari는 탭한 입력창이 키보드에 가리면 화면 전체를 밀어 올린다.
  // 탭으로 초점이 갈 때 대신 스크롤 없이 초점을 준다
  let start: { x: number; y: number } | undefined;
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
  };
  const onTouchEnd = (event: TouchEvent) => {
    const target = event.target;
    const touch = event.changedTouches[0];
    if (
      !start ||
      !isTextField(target) ||
      target.disabled ||
      target === document.activeElement ||
      !event.cancelable ||
      Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_SLOP_PX
    ) {
      return;
    }
    event.preventDefault();
    target.focus({ preventScroll: true });
  };

  // 키보드가 떠 있는 동안 Safari는 문서 전체를 키보드 높이만큼 스크롤할 수 있게 둔다(WebKit 191204).
  // 스크롤할 것이 없는 곳(지도 위, 검색창)에서 손가락이 움직이면 화면 전체가 끌려가므로 막는다
  const onTouchMove = (event: TouchEvent) => {
    if (
      event.cancelable &&
      isTextField(document.activeElement) &&
      !insideScroller(event.target)
    ) {
      event.preventDefault();
    }
  };

  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  window.addEventListener("scroll", update);
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchend", onTouchEnd, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  const stop = () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    window.removeEventListener("scroll", update);
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchmove", onTouchMove);
    [root.style.overflowAnchor, document.body.style.overflowAnchor] =
      anchorBefore;
    root.style.overflow = overflowBefore;
    document.body.style.translate = "";
  };
  return { read, stop };
}

// 바닥에 붙은 요소를 키보드 위로 올리는 translate 값.
// 아래 여백이 pb-safe-{spacing}이면 키보드 위에 같은 간격을 남긴다. 키보드가 없으면 0이다
export function keyboardLift(spacing: number) {
  const pad = `calc(var(--spacing) * ${spacing})`;
  return `0 min(0px, max(${pad}, env(safe-area-inset-bottom)) - ${pad} - var(--keyboard-inset, 0px))`;
}

// 키보드를 따라 오르내린다. 시간과 곡선은 OS 키보드 값(KEYBOARD_MOTION)이고 훅이 문서에 둔다.
// 움직이는 요소에 KEYBOARD_MOVE 클래스와 KEYBOARD_STYLE을 함께 준다. 감싸는 요소가 --keyboard-lift를 정한다
export const KEYBOARD_MOVE =
  "transition-transform motion-safe:in-data-keyboard-moving:caret-transparent motion-reduce:transition-none";
export const KEYBOARD_STYLE = {
  translate: "var(--keyboard-lift, none)",
  transitionDuration: "var(--keyboard-duration, 0ms)",
  transitionTimingFunction: "var(--keyboard-ease, ease)",
};
