import { Icon, type IconProps } from "@/shared/ui/icon";

export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19V5M19 12L12 5L5 12" />
    </Icon>
  );
}
