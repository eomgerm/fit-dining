import { Icon, type IconProps } from "@/shared/ui/icon";

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6L12 12M12 12L18 18M12 12L18 6M12 12L6 18" />
    </Icon>
  );
}
