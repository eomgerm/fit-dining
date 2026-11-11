import { Icon, type IconProps } from "@/shared/ui/icon/icon";

// 모임장 배지의 왕관(모임 화면 예시 D-20). 아이콘 모음에 없어 새로 그렸다
export function CrownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 18H20" />
      <path d="M5 15L3.5 7.5L8.5 11L12 5L15.5 11L20.5 7.5L19 15H5Z" />
    </Icon>
  );
}
