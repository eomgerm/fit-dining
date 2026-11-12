import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { ChevronDownIcon } from "@/shared/ui/icon/icons/chevron-down";

// 접었다 펴는 목록. 처음에는 모두 접혀 있고 여럿을 함께 펼 수 있다. 머리글은 버튼이고 aria-expanded가 붙는다.
// <Accordion><AccordionItem><AccordionTrigger>머리글</AccordionTrigger><AccordionPanel>내용</AccordionPanel></AccordionItem></Accordion>
// 줄 사이는 구분선이다. 펼칠 수 없는 줄은 AccordionItem 대신 AccordionRow로 같은 목록에 넣는다
export function Accordion({
  className,
  ...props
}: Omit<BaseAccordion.Root.Props, "className" | "multiple"> & {
  className?: string;
}) {
  return (
    <BaseAccordion.Root
      multiple
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

const ROW = "border-b border-line last:border-b-0";

export function AccordionItem(
  props: Omit<BaseAccordion.Item.Props, "className">,
) {
  return <BaseAccordion.Item className={ROW} {...props} />;
}

// 펼칠 수 없는 줄. 버튼이 아니라 글자만 보인다
export function AccordionRow({ children }: { children: ReactNode }) {
  return <div className={cn(ROW, "py-3")}>{children}</div>;
}

// 머리글 버튼. 오른쪽 아래 화살표는 펼치면 200ms 동안 뒤집힌다. 움직임 줄이기에서는 바로 뒤집힌다
export function AccordionTrigger({ children }: { children: ReactNode }) {
  return (
    <BaseAccordion.Header>
      <BaseAccordion.Trigger className="group flex min-h-11 w-full items-start gap-3 py-3 text-left">
        <span className="min-w-0 flex-1">{children}</span>
        <ChevronDownIcon
          size="md"
          aria-hidden
          className="mt-0.5 shrink-0 text-ink-muted transition-transform duration-200 group-data-panel-open:rotate-180 motion-reduce:transition-none"
        />
      </BaseAccordion.Trigger>
    </BaseAccordion.Header>
  );
}

// 높이가 200ms 동안 바뀐다. 움직임 줄이기에서는 높이 애니메이션 없이 열린다
export function AccordionPanel({
  className,
  ...props
}: Omit<BaseAccordion.Panel.Props, "className"> & { className?: string }) {
  return (
    <BaseAccordion.Panel
      className={cn(
        "h-(--accordion-panel-height) overflow-hidden transition-all duration-200 data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}
