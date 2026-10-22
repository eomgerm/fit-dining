import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";

// Figma 'Button'의 Style=Text. 배경 없이 밑줄 친 글자이고, 높이는 터치 최소 크기(44px)로 고정한다
const textButtonVariants = cva(
  "inline-flex h-11 items-center justify-center px-1 whitespace-nowrap text-ink underline transition select-none data-disabled:pointer-events-none motion-safe:active:scale-98",
  {
    variants: {
      size: {
        md: "rounded-md text-button-md font-normal",
        sm: "rounded-full text-button-sm",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

type TextButtonProps = Omit<BaseButton.Props, "className"> &
  VariantProps<typeof textButtonVariants> & {
    className?: string;
  };

export function TextButton({ size, className, ...props }: TextButtonProps) {
  return (
    <BaseButton
      className={cn(textButtonVariants({ size }), className)}
      {...props}
    />
  );
}
