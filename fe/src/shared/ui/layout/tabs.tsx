import { Tabs as BaseTabs } from "@base-ui/react/tabs";

import { cn } from "@/shared/lib/cn";

// fit.css '.fd-tabs'·'.fd-tab'의 모양. 탭 이름과 내용은 화면에서 넣는다.
// <Tabs defaultValue="home"><TabList><Tab value="home">홈</Tab>…</TabList><TabPanel value="home">…</TabPanel></Tabs>
export function Tabs(props: BaseTabs.Root.Props) {
  return <BaseTabs.Root {...props} />;
}

// 글자 폭만큼의 탭을 28px 간격으로 늘어놓는다. 폭을 똑같이 나누려면 화면에서 Tab에 flex-1을 준다.
// 주황 밑줄은 막대의 구분선 위에 겹치고, 탭을 바꾸면 200ms 동안 새 탭으로 미끄러진다.
// 움직임 줄이기에서는 바로 옮겨 가고 글자색만 바뀐다
export function TabList({
  className,
  children,
  ...props
}: Omit<BaseTabs.List.Props, "className"> & { className?: string }) {
  return (
    <BaseTabs.List
      className={cn("relative flex gap-7 border-b border-line px-5", className)}
      {...props}
    >
      {children}
      <BaseTabs.Indicator
        renderBeforeHydration
        className="absolute -bottom-px left-(--active-tab-left) h-0.5 w-(--active-tab-width) bg-primary transition-all duration-200 motion-reduce:transition-none"
      />
    </BaseTabs.List>
  );
}

// 선택되면 굵은 글자. 글자색은 120ms로 바뀐다
export function Tab(
  props: Omit<BaseTabs.Tab.Props, "className"> & { className?: string },
) {
  return (
    <BaseTabs.Tab
      {...props}
      className={cn(
        "flex min-h-11 items-center justify-center text-body-sm text-ink-muted transition-colors data-active:text-label-md data-active:text-ink",
        props.className,
      )}
    />
  );
}

export function TabPanel(props: BaseTabs.Panel.Props) {
  return <BaseTabs.Panel {...props} />;
}
