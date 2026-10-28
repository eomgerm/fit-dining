import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function BabyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z" />
      <path d="M9 10.5H9.01M15 10.5H15.01" />
      <path d="M9.5 15C10.1 15.6 11 16 12 16C13 16 13.9 15.6 14.5 15" />
      <path d="M12 3C11 4.5 11.5 6 13 6" />
    </Icon>
  );
}
