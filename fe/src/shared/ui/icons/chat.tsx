import { Icon, type IconProps } from "@/shared/ui/icon";

export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5H20V16H9L4 20V5Z" />
      <path d="M8 9H16M8 12H13" />
    </Icon>
  );
}
