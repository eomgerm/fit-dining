import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5V12M12 12V19M12 12H5M12 12H19" />
    </Icon>
  );
}
