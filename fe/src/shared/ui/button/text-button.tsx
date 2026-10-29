import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";

// Figma 'Button'의 Style=Text. 배경 없이 밑줄 친 글자이고, 높이는 터치 최소 크기(44px)로 고정한다
const textButtonVariants = cva(
  "inline-flex h-11 items-center justify-center px-1 whitespace-nowrap transition select-none data-disabled:pointer-events-none motion-safe:active:scale-98",
  {
    variants: {
      variant: {
        default: "text-ink underline",
        inverse: "text-on-secondary underline",
        // 로그인·검색 취소 같은 보조 링크. 밑줄 없는 회색 글자
        muted: "text-ink-muted",
      },
      size: {
        md: "rounded-md text-button-md font-normal",
        sm: "rounded-full text-button-sm",
      },
    },
    defaultVariants: { size: "sm", variant: "default" },
  },
);

type TextButtonProps = Omit<BaseButton.Props, "className"> &
  VariantProps<typeof textButtonVariants> & {
    className?: string;
  };

export function TextButton({
  size,
  variant,
  className,
  ...props
}: TextButtonProps) {
  return (
    <BaseButton
      className={cn(textButtonVariants({ size, variant }), className)}
      {...props}
    />
  );
}
