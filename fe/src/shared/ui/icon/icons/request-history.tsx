import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function RequestHistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5C8 6.10457 7.10457 7 6 7C4.89543 7 4 6.10457 4 5C4 3.89543 4.89543 3 6 3C7.10457 3 8 3.89543 8 5Z" />
      <path d="M8 19C8 20.1046 7.10457 21 6 21C4.89543 21 4 20.1046 4 19C4 17.8954 4.89543 17 6 17C7.10457 17 8 17.8954 8 19Z" />
      <path d="M6 7V17" />
      <path d="M11 5H20M11 12H20M11 19H20" />
    </Icon>
  );
}
