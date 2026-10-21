import { Icon, type IconProps } from "@/shared/ui/icon";

export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 5H19C20.1046 5 21 5.89543 21 7V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V7C3 5.89543 3.89543 5 5 5Z" />
      <path d="M3 10H21M8 3V7M16 3V7" />
    </Icon>
  );
}
