import { Icon, type IconProps } from "@/shared/ui/icon/icon";

export function ClearIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M9 9L12 12M12 12L15 15M12 12L15 9M12 12L9 15"
        className="stroke-surface"
      />
    </Icon>
  );
}
