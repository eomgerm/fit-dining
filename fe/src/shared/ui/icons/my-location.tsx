import { Icon, type IconProps } from "@/shared/ui/icon";

export function MyLocationIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12C19 15.866 15.866 19 12 19C8.13401 19 5 15.866 5 12C5 8.13401 8.13401 5 12 5C15.866 5 19 8.13401 19 12Z" />
      <path
        d="M12 14.5C13.3807 14.5 14.5 13.3807 14.5 12C14.5 10.6193 13.3807 9.5 12 9.5C10.6193 9.5 9.5 10.6193 9.5 12C9.5 13.3807 10.6193 14.5 12 14.5Z"
        fill="currentColor"
      />
      <path d="M12 2V5M12 19V22M2 12H5M19 12H22" />
    </Icon>
  );
}
