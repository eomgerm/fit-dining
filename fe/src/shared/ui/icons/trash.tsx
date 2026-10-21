import { Icon, type IconProps } from "@/shared/ui/icon";

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 7H19" />
      <path d="M10 11V17M14 11V17" />
      <path d="M7 7L8 19H16L17 7" />
      <path d="M9 7V4H15V7" />
    </Icon>
  );
}
