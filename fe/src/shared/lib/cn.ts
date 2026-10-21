import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// globals.css에서 이름을 새로 정한 토큰을 알려 준다. 모르는 text-* 이름은 글자색으로 보고 글자색과 함께 지워 버린다
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        (value: string) =>
          /^(headline|title|body|caption|label|button)-(lg|md|sm)$/.test(value),
      ],
      shadow: ["1", "2", "3", "pin"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
