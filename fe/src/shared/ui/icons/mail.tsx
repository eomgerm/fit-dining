import { Icon, type IconProps } from "@/shared/ui/icon";

export function MailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 5H19C20.1046 5 21 5.89543 21 7V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17V7C3 5.89543 3.89543 5 5 5Z" />
      <path d="M3 7L12 13L21 7" />
    </Icon>
  );
}
