import { Button as BaseButton } from "@base-ui/react/button";
import { cva } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";

// Figma 'Button'. variant가 색을, size가 높이·여백·라운드·글자를 정한다
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap transition select-none data-disabled:pointer-events-none motion-safe:active:scale-98",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-on-primary active:bg-primary-pressed data-disabled:bg-primary-disabled",
        outline: "border border-line-strong bg-surface text-ink",
        danger: "bg-danger text-on-primary",
      },
      size: {
        lg: "h-14 rounded-md px-6 text-button-lg",
        md: "h-12 rounded-md px-5 text-button-md",
        sm: "h-9 rounded-full px-3 text-button-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "lg" },
  },
);

// cva는 variant와 size를 따로따로 받으므로, Figma에 있는 조합만 쓰도록 타입으로 묶는다
type ButtonStyle =
  // primary sm은 홈 화면 추가 배너(4-01b)의 [추가하기]에만 쓴다
  | { variant?: "primary"; size?: "lg" | "md" | "sm" }
  | { variant: "outline"; size: "md" | "sm" }
  | { variant: "danger"; size: "md" };

type ButtonProps = Omit<BaseButton.Props, "className"> &
  ButtonStyle & {
    // 폭·바깥 여백 같은 배치용 클래스만 넘긴다. 모양은 variant와 size로 고른다
    className?: string;
  };

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return (
    <BaseButton
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
