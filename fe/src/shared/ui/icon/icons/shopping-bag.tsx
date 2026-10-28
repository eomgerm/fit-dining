import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function ShoppingBagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 8H18.5L19.5 21H4.5L5.5 8Z" />
      <path d="M9 11V6.5C9 4.84315 10.3431 3.5 12 3.5C13.6569 3.5 15 4.84315 15 6.5V11" />
    </Icon>
  );
}
