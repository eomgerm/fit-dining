"use client";

import EmblaCarousel, {
  type EmblaCarouselType,
  type EmblaOptionsType,
} from "embla-carousel";
import {
  Children,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "@/shared/lib/cn";

type CarouselProps = {
  // 화면 낭독기용 이름(예: "장소 사진")
  label: string;
  // 칸들. 하나씩 감싸서 "2 / 5" 같은 위치를 붙인다
  children: ReactNode;
  // 현재 칸. 바깥에서 바꾸면 그 칸으로 이동한다(예: 지도 핀을 누를 때)
  index?: number;
  // 손가락이나 키보드로 넘겼을 때 알린다. CarouselDots·지도 핀을 이 번호로 맞춘다
  onIndexChange?: (index: number) => void;
  // 칸 폭·간격(예: "basis-full", "basis-78 pr-3")
  slideClassName?: string;
  // 처음 만들 때 한 번 읽는다
  options?: Pick<EmblaOptionsType, "align" | "loop" | "duration">;
  // 틀 안쪽 좌우 12px에 이웃 칸이 비친다. 칸 폭과 정렬은 이 여백 안쪽(basis-full = 틀 - 24px)을 기준으로 한다
  peek?: boolean;
  className?: string;
};

// Embla 기반 가로 넘기기. 장소 사진, 첫 화면 장소 카드에 쓴다
export function Carousel({
  label,
  children,
  index,
  onIndexChange,
  slideClassName,
  options,
  peek = false,
  className,
}: CarouselProps) {
  const viewportRef = useRef<HTMLElement>(null);
  const apiRef = useRef<EmblaCarouselType>(undefined);
  // 마지막으로 보이던 칸. 다시 만들 때 이 칸에서 미끄러지지 않고 바로 시작한다
  const position = useRef(index ?? 0);
  const slides = Children.toArray(children);

  // containScroll을 끄면 칸 하나가 스냅 하나가 되어 index가 칸 번호와 늘 같다
  const startOptions = useEffectEvent((): EmblaOptionsType => ({
    ...options,
    startIndex: index ?? position.current,
    containScroll: false,
  }));

  const handleSelect = useEffectEvent((api: EmblaCarouselType) => {
    position.current = api.selectedScrollSnap();
    onIndexChange?.(position.current);
  });

  const handlePointerUp = useEffectEvent((api: EmblaCarouselType) => {
    const duration = options?.duration;
    if (duration === undefined) return;
    // Embla 8.6.0 DragHandler는 options.duration 대신 힘에 따른 속도를 정한 뒤
    // pointerUp을 보낸다. 그 차이를 보존하려고 비공식 internalEngine을 사용한다.
    // ScrollBody.duration/useDuration 및 이벤트 순서는 Embla 업그레이드 시 재확인한다.
    const { scrollBody } = api.internalEngine();
    scrollBody.useDuration(scrollBody.duration() * (duration / 25));
  });

  // 그리기 전에 만든다. Next는 떠난 화면을 숨겨 두었다가 다시 보일 때 Effect를 다시 실행하므로,
  // 그린 뒤에 만들면 첫 칸이 잠깐 보였다가 보던 칸으로 넘어간다(place-search D-102)
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const api = EmblaCarousel(viewport, startOptions());
    api.on("select", () => handleSelect(api));
    api.on("pointerUp", () => handlePointerUp(api));
    apiRef.current = api;
    return () => {
      apiRef.current = undefined;
      api.destroy();
    };
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (api && index !== undefined && index !== api.selectedScrollSnap()) {
      api.scrollTo(index);
    }
  }, [index]);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft") apiRef.current?.scrollPrev();
    if (event.key === "ArrowRight") apiRef.current?.scrollNext();
  }

  return (
    <section
      ref={viewportRef}
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn("overflow-hidden", peek && "px-3", className)}
    >
      <div className="flex">
        {slides.map((slide, slideIndex) => (
          <div
            key={slideIndex}
            role="group"
            aria-roledescription="slide"
            aria-label={`${slideIndex + 1} / ${slides.length}`}
            className={cn("min-w-0 shrink-0", slideClassName)}
          >
            {slide}
          </div>
        ))}
      </div>
    </section>
  );
}
