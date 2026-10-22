import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 11C18 14.866 14.866 18 11 18C7.13401 18 4 14.866 4 11C4 7.13401 7.13401 4 11 4C14.866 4 18 7.13401 18 11Z" />
      <path d="M20 20L16.5 16.5" />
    </Icon>
  );
}
