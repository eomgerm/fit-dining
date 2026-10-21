import { Icon, type IconProps } from "@/shared/ui/icon";

export function MapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 4L3 6V20L9 18L15 20L21 18V4L15 6L9 4Z" />
      <path d="M9 4V18M15 6V20" />
    </Icon>
  );
}
