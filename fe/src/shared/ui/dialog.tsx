import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactElement, ReactNode } from "react";

// 아이콘 원의 바탕과 아이콘 색. 아이콘은 currentColor라 원의 글자색을 따른다
const iconCircleVariants = cva(
  "flex size-12 items-center justify-center self-center rounded-full",
  {
    variants: {
      tone: {
        primary: "bg-primary-soft text-primary",
        warn: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
      },
    },
    defaultVariants: { tone: "primary" },
  },
);

export type DialogContentProps = Omit<BaseAlertDialog.Root.Props, "children"> &
  VariantProps<typeof iconCircleVariants> & {
    // 24px 아이콘(기본 크기). 없으면 아이콘 원을 그리지 않는다
    icon?: ReactElement;
    title: ReactNode;
    description?: ReactNode;
  };

// AlertDialog·ConfirmDialog가 함께 쓰는 Figma 'Dialog' 틀. 화면에서는 두 컴포넌트를 쓴다.
// 답을 받아야 하는 창이라 Base UI AlertDialog로 만든다(바깥을 눌러도 닫히지 않는다).
// 모션 메모: 배경이 먼저 어두워지고, 창이 80ms 뒤 96%→100%로 240ms. 닫힐 때 220ms
export function DialogFrame({
  tone,
  icon,
  title,
  description,
  actions,
  ...props
}: DialogContentProps & { actions: ReactNode }) {
  return (
    <BaseAlertDialog.Root {...props}>
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop className="fixed inset-0 bg-scrim transition-opacity duration-240 ease-enter data-ending-style:opacity-0 data-ending-style:duration-220 data-ending-style:ease-exit data-starting-style:opacity-0" />
        <BaseAlertDialog.Popup className="fixed top-1/2 left-1/2 flex w-75 -translate-1/2 flex-col gap-3 rounded-xl bg-surface px-5 pt-6 pb-5 text-center shadow-3 transition delay-80 duration-240 ease-enter data-ending-style:scale-96 data-ending-style:opacity-0 data-ending-style:delay-0 data-ending-style:duration-220 data-ending-style:ease-exit data-starting-style:scale-96 data-starting-style:opacity-0 motion-reduce:scale-100 motion-reduce:transition-opacity motion-reduce:delay-0 motion-reduce:duration-120">
          {icon && <span className={iconCircleVariants({ tone })}>{icon}</span>}
          <BaseAlertDialog.Title className="text-title-sm text-ink">
            {title}
          </BaseAlertDialog.Title>
          {description && (
            <BaseAlertDialog.Description className="text-body-sm text-ink-muted">
              {description}
            </BaseAlertDialog.Description>
          )}
          <div className="flex gap-2 pt-2 *:flex-1">{actions}</div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
