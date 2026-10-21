import { Icon, type IconProps } from "@/shared/ui/icon";

export function PinDotIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21C12 21 5 14.5 5 9C5 7.14348 5.7375 5.36301 7.05025 4.05025C8.36301 2.7375 10.1435 2 12 2C13.8565 2 15.637 2.7375 16.9497 4.05025C18.2625 5.36301 19 7.14348 19 9C19 14.5 12 21 12 21Z" />
      <path
        d="M12 11.5C13.3807 11.5 14.5 10.3807 14.5 9C14.5 7.61929 13.3807 6.5 12 6.5C10.6193 6.5 9.5 7.61929 9.5 9C9.5 10.3807 10.6193 11.5 12 11.5Z"
        fill="currentColor"
      />
    </Icon>
  );
}
