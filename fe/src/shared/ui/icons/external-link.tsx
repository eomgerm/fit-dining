import { Icon, type IconProps } from "@/shared/ui/icon";

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 5H19V10" />
      <path d="M19 5L11 13" />
      <path d="M17 14V19H5V7H10" />
    </Icon>
  );
}
