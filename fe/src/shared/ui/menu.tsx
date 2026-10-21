import { Menu as BaseMenu } from "@base-ui/react/menu";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactElement, ReactNode } from "react";

type MenuProps = {
  // 여는 버튼(예: <IconButton label="리뷰 메뉴"><MoreIcon size="md" /></IconButton>)
  trigger: ReactElement;
  children: ReactNode;
  // Figma는 트리거 오른쪽 끝에 맞춘다
  align?: "start" | "end";
};

// Figma 리뷰 ⋯ 메뉴(fd-menu). 열림은 메모에 없어 투명도만 120ms로 바꾼다
export function Menu({ trigger, children, align = "end" }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner align={align} sideOffset={4}>
          <BaseMenu.Popup className="w-40 rounded-md bg-surface py-1 shadow-3 transition-opacity duration-120 outline-none data-ending-style:opacity-0 data-starting-style:opacity-0">
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

const menuItemVariants = cva(
  // 강조 바탕은 Figma에 없지만 키보드로 옮길 때 위치가 보이도록 둔다
  "flex h-11 items-center px-4 text-body-md outline-none select-none data-disabled:pointer-events-none data-highlighted:bg-surface-sunken",
  {
    variants: {
      tone: {
        default: "text-ink",
        // 삭제·탈퇴처럼 되돌리기 어려운 항목
        danger: "text-danger",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

type MenuItemProps = Omit<BaseMenu.Item.Props, "className"> &
  VariantProps<typeof menuItemVariants>;

export function MenuItem({ tone, ...props }: MenuItemProps) {
  return <BaseMenu.Item className={menuItemVariants({ tone })} {...props} />;
}
