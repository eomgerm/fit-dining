import { Tabs as BaseTabs } from "@base-ui/react/tabs";

import { cn } from "@/shared/lib/cn";

// fit.css '.fd-tabs'·'.fd-tab'의 모양. 탭 이름과 내용은 화면에서 넣는다.
// <Tabs defaultValue="home"><TabList><Tab value="home">홈</Tab>…</TabList><TabPanel value="home">…</TabPanel></Tabs>
export function Tabs(props: BaseTabs.Root.Props) {
  return <BaseTabs.Root {...props} />;
}

// 글자 폭만큼의 탭을 28px 간격으로 늘어놓는다. 폭을 똑같이 나누려면 화면에서 Tab에 flex-1을 준다
export function TabList({
  className,
  ...props
}: Omit<BaseTabs.List.Props, "className"> & { className?: string }) {
  return (
    <BaseTabs.List
      className={cn("flex gap-7 border-b border-line px-5", className)}
      {...props}
    />
  );
}

// 선택되면 굵은 글자와 주황 밑줄. 밑줄은 막대의 구분선 위에 겹친다
export function Tab(
  props: Omit<BaseTabs.Tab.Props, "className"> & { className?: string },
) {
  return (
    <BaseTabs.Tab
      {...props}
      className={cn(
        "-mb-px flex min-h-11 items-center justify-center border-b-2 border-transparent text-body-sm text-ink-muted data-active:border-primary data-active:text-label-md data-active:text-ink",
        props.className,
      )}
    />
  );
}

export function TabPanel(props: BaseTabs.Panel.Props) {
  return <BaseTabs.Panel {...props} />;
}
