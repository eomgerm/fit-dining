import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function RestroomIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 4.5C8.5 5.32843 7.82843 6 7 6C6.17157 6 5.5 5.32843 5.5 4.5C5.5 3.67157 6.17157 3 7 3C7.82843 3 8.5 3.67157 8.5 4.5Z" />
      <path d="M4.5 9H9.5M7 9V21" />
      <path d="M18.5 4.5C18.5 5.32843 17.8284 6 17 6C16.1716 6 15.5 5.32843 15.5 4.5C15.5 3.67157 16.1716 3 17 3C17.8284 3 18.5 3.67157 18.5 4.5Z" />
      <path d="M17 9L14.5 16H19.5L17 9ZM17 16V21" />
      <path d="M12 3V21" />
    </Icon>
  );
}
