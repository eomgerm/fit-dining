import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function CameraIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 7H19C20.1046 7 21 7.89543 21 9V18C21 19.1046 20.1046 20 19 20H5C3.89543 20 3 19.1046 3 18V9C3 7.89543 3.89543 7 5 7Z" />
      <path d="M8 7L10 4H14L16 7" />
      <path d="M15.5 13.5C15.5 15.433 13.933 17 12 17C10.067 17 8.5 15.433 8.5 13.5C8.5 11.567 10.067 10 12 10C13.933 10 15.5 11.567 15.5 13.5Z" />
    </Icon>
  );
}
