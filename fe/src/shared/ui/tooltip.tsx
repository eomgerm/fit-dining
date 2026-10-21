import { Popover } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";

type TooltipProps = {
  // 말풍선 글
  content: ReactNode;
  // 누르는 대상. 화면 낭독기용 이름을 붙인다(예: <button aria-label="핏 점수 설명"><InfoIcon size="sm" /></button>)
  children: ReactElement;
  side?: "top" | "bottom";
  // Figma는 트리거 오른쪽 끝에 맞춘다
  align?: "start" | "center" | "end";
};

// Figma 'Tooltip'. 휴대폰에서는 마우스를 올릴 수 없어 Base UI Popover로 눌러서 연다
export function Tooltip({
  content,
  children,
  side = "bottom",
  align = "end",
}: TooltipProps) {
  return (
    <Popover.Root>
      <Popover.Trigger render={children} />
      <Popover.Portal>
        <Popover.Positioner
          side={side}
          align={align}
          sideOffset={8}
          alignOffset={-12}
        >
          <Popover.Popup className="w-58 rounded-md bg-ink px-3.5 py-3 text-caption-md leading-5 text-surface transition-opacity duration-120 outline-none data-ending-style:opacity-0 data-starting-style:opacity-0">
            <Popover.Arrow className="size-3 rotate-45 bg-ink data-[side=bottom]:-top-1.5 data-[side=top]:-bottom-1.5" />
            {content}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
