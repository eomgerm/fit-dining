"use client";

import useEmblaCarousel from "embla-carousel-react";
import {
  Children,
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "@/shared/lib/cn";

type EmblaOptions = NonNullable<Parameters<typeof useEmblaCarousel>[0]>;

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
  options?: Pick<EmblaOptions, "align" | "loop" | "duration">;
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
  className,
}: CarouselProps) {
  // 처음 칸은 미끄러지지 않고 바로 보이게 시작 위치로 넘긴다.
  // containScroll을 끄면 칸 하나가 스냅 하나가 되어 index가 칸 번호와 늘 같다
  const [startIndex] = useState(index ?? 0);
  const [viewportRef, api] = useEmblaCarousel({
    ...options,
    startIndex,
    containScroll: false,
  });
  const slides = Children.toArray(children);

  useEffect(() => {
    const duration = options?.duration;
    if (!api || duration === undefined) return;
    const handlePointerUp = () => {
      // Embla 8.6.0 DragHandler는 options.duration 대신 힘에 따른 속도를 정한 뒤
      // pointerUp을 보낸다. 그 차이를 보존하려고 비공식 internalEngine을 사용한다.
      // ScrollBody.duration/useDuration 및 이벤트 순서는 Embla 업그레이드 시 재확인한다.
      const { scrollBody } = api.internalEngine();
      scrollBody.useDuration(scrollBody.duration() * (duration / 25));
    };
    api.on("pointerUp", handlePointerUp);
    return () => {
      api.off("pointerUp", handlePointerUp);
    };
  }, [api, options?.duration]);

  useEffect(() => {
    if (!api || !onIndexChange) return;
    const handleSelect = () => onIndexChange(api.selectedScrollSnap());
    api.on("select", handleSelect);
    return () => {
      api.off("select", handleSelect);
    };
  }, [api, onIndexChange]);

  useEffect(() => {
    if (api && index !== undefined && index !== api.selectedScrollSnap()) {
      api.scrollTo(index);
    }
  }, [api, index]);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft") api?.scrollPrev();
    if (event.key === "ArrowRight") api?.scrollNext();
  }

  return (
    <section
      ref={viewportRef}
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn("overflow-hidden", className)}
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
