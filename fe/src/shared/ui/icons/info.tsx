import { Icon, type IconProps } from "@/shared/ui/icon";

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" />
      <path d="M12 11V16" />
      <path d="M12 8V8.01" />
    </Icon>
  );
}
