import { InstallGuide } from "@/domains/install/ui/install-guide";

// 1-01c 갤럭시 Chrome. 설치 창(beforeinstallprompt)을 못 띄울 때 메뉴로 설치하는 길이다
export default function InstallAndroidPage() {
  return (
    <InstallGuide
      steps={[
        {
          text: (
            <>
              오른쪽 위 <strong className="font-bold">⋮</strong>를 눌러주세요
            </>
          ),
          image: { src: "/install/android-1.png", height: 79 },
        },
        {
          text: (
            <>
              <strong className="font-bold">설치 및 바로가기 만들기</strong>를
              눌러주세요
            </>
          ),
          image: { src: "/install/android-2.png", height: 110 },
        },
        {
          text: (
            <>
              <strong className="font-bold">설치</strong>를 눌러주세요
            </>
          ),
          image: { src: "/install/android-3.png", height: 192 },
        },
      ]}
    />
  );
}
