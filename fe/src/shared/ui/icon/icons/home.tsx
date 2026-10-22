import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 11L12 4L20 11V20H15V14H9V20H4V11Z" />
    </Icon>
  );
}
