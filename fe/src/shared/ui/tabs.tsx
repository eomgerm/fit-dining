import { Tabs as BaseTabs } from "@base-ui/react/tabs";

import { cn } from "@/shared/lib/cn";

// Figma 'Detail tabs'의 모양. 탭 이름과 내용은 화면에서 넣는다.
// <Tabs defaultValue="home"><TabList><Tab value="home">홈</Tab>…</TabList><TabPanel value="home">…</TabPanel></Tabs>
export function Tabs(props: BaseTabs.Root.Props) {
  return <BaseTabs.Root {...props} />;
}

// 48px 탭 막대. 탭들이 폭을 똑같이 나눈다
export function TabList({
  className,
  ...props
}: Omit<BaseTabs.List.Props, "className"> & { className?: string }) {
  return (
    <BaseTabs.List
      className={cn(
        "flex h-12 border-b border-line bg-surface-warm px-2",
        className,
      )}
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
        "-mb-px flex flex-1 items-center justify-center border-b-2 border-transparent text-body-md text-ink-muted data-active:border-primary data-active:font-semibold data-active:text-ink",
        props.className,
      )}
    />
  );
}

export function TabPanel(props: BaseTabs.Panel.Props) {
  return <BaseTabs.Panel {...props} />;
}
