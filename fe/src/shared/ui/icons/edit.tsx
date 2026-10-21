import { Icon, type IconProps } from "@/shared/ui/icon";

export function EditIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20H8L19 9L15 5L4 16V20Z" />
      <path d="M13.5 6.5L17.5 10.5" />
    </Icon>
  );
}
