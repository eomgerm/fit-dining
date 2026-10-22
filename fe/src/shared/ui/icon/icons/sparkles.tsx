import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function SparklesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 3L12.9 8.1L18 10L12.9 11.9L11 17L9.1 11.9L4 10L9.1 8.1L11 3Z" />
      <path d="M18.5 14.5L19.3 16.7L21.5 17.5L19.3 18.3L18.5 20.5L17.7 18.3L15.5 17.5L17.7 16.7L18.5 14.5Z" />
    </Icon>
  );
}
