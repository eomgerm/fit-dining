import { cn } from "@/shared/lib/cn";

type CarouselDotsProps = {
  count: number;
  // Carousel의 onIndexChange로 받은 현재 칸
  index: number;
  className?: string;
};

// Figma 'Photo dots'. 6px 점은 누르기에 너무 작아 장식으로 둔다(위치는 Carousel 칸 라벨이 알린다)
export function CarouselDots({ count, index, className }: CarouselDotsProps) {
  return (
    <div aria-hidden className={cn("flex gap-1.5", className)}>
      {Array.from({ length: count }, (_, dotIndex) => (
        <span
          key={dotIndex}
          className={cn(
            "size-1.5 rounded-full bg-ink transition-opacity",
            dotIndex === index ? "opacity-100" : "opacity-25",
          )}
        />
      ))}
    </div>
  );
}
