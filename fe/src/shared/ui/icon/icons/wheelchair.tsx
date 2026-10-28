import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function WheelchairIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 4.5C13 5.32843 12.3284 6 11.5 6C10.6716 6 10 5.32843 10 4.5C10 3.67157 10.6716 3 11.5 3C12.3284 3 13 3.67157 13 4.5Z" />
      <path d="M11.5 8.5V14H16.5L18.5 19.5H20" />
      <path d="M11.5 11H16" />
      <path d="M8.5 11C6.43 11.8 5 13.75 5 16C5 18.7614 7.23858 21 10 21C12.1 21 13.9 19.7 14.65 17.85" />
    </Icon>
  );
}
