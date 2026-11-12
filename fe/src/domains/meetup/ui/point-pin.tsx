import { cn } from "@/shared/lib/cn";

// 지점 핀과 그 위의 위치 이름(화면 예시 모임장 4). 지도에서 고르기와 지도 보기가 함께 쓴다. 놓는 자리는 className으로 정한다
export function PointPin({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none flex flex-col items-center gap-1",
        className,
      )}
    >
      {name && (
        <span className="rounded-full bg-ink px-2.5 py-1 text-label-sm whitespace-nowrap text-on-primary">
          {name}
        </span>
      )}
      <svg
        aria-hidden="true"
        width="40"
        height="40"
        viewBox="0 0 24 24"
        className="fill-primary stroke-surface"
        strokeWidth="1.5"
      >
        <path d="M12 22C12 22 4.5 15 4.5 9C4.5 4.86 7.86 1.5 12 1.5C16.14 1.5 19.5 4.86 19.5 9C19.5 15 12 22 12 22Z" />
        <circle cx="12" cy="9" r="3" className="fill-surface stroke-none" />
      </svg>
    </div>
  );
}
