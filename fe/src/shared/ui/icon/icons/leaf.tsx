import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function LeafIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 19C5 11 10 5 20 4C20 14 14 19 6 19H5Z" />
      <path d="M5 19L13 11" />
    </Icon>
  );
}
