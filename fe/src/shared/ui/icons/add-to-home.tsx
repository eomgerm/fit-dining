import { Icon, type IconProps } from "@/shared/ui/icon";

export function AddToHomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 2.5H15.5C16.8807 2.5 18 3.61929 18 5V19C18 20.3807 16.8807 21.5 15.5 21.5H8.5C7.11929 21.5 6 20.3807 6 19V5C6 3.61929 7.11929 2.5 8.5 2.5Z" />
      <path d="M12 9V15" />
      <path d="M9 12H15" />
    </Icon>
  );
}
