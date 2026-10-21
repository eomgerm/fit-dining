import { Icon, type IconProps } from "@/shared/ui/icon";

export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4L21 20H3L12 4Z" />
      <path d="M12 10V14M12 17V17.01" />
    </Icon>
  );
}
