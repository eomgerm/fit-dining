import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";

// 현재 칸은 가로로 긴 알약, 나머지는 원. 색이 아니라 모양으로도 현재 칸을 구분한다.
// 모션 메모상 폭은 애니메이션하지 않고(transition에 width가 없다) 색·투명도만 바뀐다
const dotVariants = cva("shrink-0 rounded-full transition duration-200", {
  variants: {
    // Figma 'Photo dots'의 Tone. photo: 사진 위, surface: 흰 바탕 위(회원가입 묻기 슬라이드)
    tone: { photo: "bg-ink", surface: "" },
    active: { true: "", false: "" },
  },
  compoundVariants: [
    { tone: "photo", active: true, class: "h-1.5 w-4" },
    { tone: "photo", active: false, class: "size-1.5 opacity-25" },
    { tone: "surface", active: true, class: "h-2 w-5 bg-primary" },
    { tone: "surface", active: false, class: "size-2 bg-line-strong" },
  ],
  defaultVariants: { tone: "photo" },
});

type CarouselDotsProps = Pick<VariantProps<typeof dotVariants>, "tone"> & {
  count: number;
  // Carousel의 onIndexChange로 받은 현재 칸
  index: number;
  className?: string;
};

// 점은 누르기에 너무 작아 장식으로 둔다(위치는 Carousel 칸 라벨이 알린다)
export function CarouselDots({
  count,
  index,
  tone,
  className,
}: CarouselDotsProps) {
  return (
    <div aria-hidden className={cn("flex items-center gap-1.5", className)}>
      {Array.from({ length: count }, (_, dotIndex) => (
        <span
          key={dotIndex}
          className={dotVariants({ tone, active: dotIndex === index })}
        />
      ))}
    </div>
  );
}
