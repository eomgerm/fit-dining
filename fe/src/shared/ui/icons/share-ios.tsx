import { Icon, type IconProps } from "@/shared/ui/icon";

export function ShareIosIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3V15" />
      <path d="M8 7L12 3L16 7" />
      <path d="M5 12V19C5 19.5304 5.21071 20.0391 5.58579 20.4142C5.96086 20.7893 6.46957 21 7 21H17C17.5304 21 18.0391 20.7893 18.4142 20.4142C18.7893 20.0391 19 19.5304 19 19V12" />
    </Icon>
  );
}
