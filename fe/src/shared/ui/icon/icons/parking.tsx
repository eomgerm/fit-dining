import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function ParkingIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3H18C19.6569 3 21 4.34315 21 6V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V6C3 4.34315 4.34315 3 6 3Z" />
      <path d="M9.5 17V7H13C14.6569 7 16 8.34315 16 10C16 11.6569 14.6569 13 13 13H9.5" />
    </Icon>
  );
}
