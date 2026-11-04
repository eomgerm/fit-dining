import Link from "next/link";
import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button/button";
import { EmptyState } from "@/shared/ui/display/empty-state";

// not-found.tsx들이 함께 쓰는 404 화면. 문구와 아이콘만 경로마다 다르다
export function NotFoundView({
  icon,
  title,
  description,
}: {
  icon: ReactElement;
  title: string;
  description: string;
}) {
  return (
    <main className="flex flex-1 flex-col justify-center">
      <EmptyState
        icon={icon}
        title={title}
        description={description}
        action={
          <Button
            render={<Link href="/" />}
            nativeButton={false}
            variant="outline"
            size="md"
          >
            처음으로
          </Button>
        }
      />
    </main>
  );
}
