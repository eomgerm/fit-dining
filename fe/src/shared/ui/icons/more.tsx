import { Icon, type IconProps } from "@/shared/ui/icon";

export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12H5.01M12 12H12.01M19 12H19.01" strokeWidth={3} />
    </Icon>
  );
}
