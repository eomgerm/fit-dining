import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function CopyRoundedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5H16C17.6569 5 19 6.34315 19 8V16C19 17.6569 17.6569 19 16 19H8C6.34315 19 5 17.6569 5 16V8C5 6.34315 6.34315 5 8 5Z" />
      <path d="M9 2H20C20.5304 2 21.0391 2.21071 21.4142 2.58579C21.7893 2.96086 22 3.46957 22 4V15" />
    </Icon>
  );
}
