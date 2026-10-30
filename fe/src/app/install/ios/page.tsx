import { InstallGuide } from "@/domains/install/ui/install-guide";

// 1-01d 아이폰 Safari. iOS는 설치 창을 띄우는 API가 없어 공유 메뉴 경로를 안내한다
export default function InstallIosPage() {
  return (
    <InstallGuide
      steps={[
        {
          text: (
            <>
              아래 <strong className="font-bold">공유</strong> 버튼을 눌러주세요
            </>
          ),
          image: { src: "/install/ios-1.png", height: 86 },
        },
        {
          text: (
            <>
              <strong className="font-bold">더 보기</strong>를 눌러주세요
            </>
          ),
          image: { src: "/install/ios-2.png", height: 164 },
        },
        {
          text: (
            <>
              <strong className="font-bold">홈 화면에 추가</strong>를 눌러주세요
            </>
          ),
          image: { src: "/install/ios-3.png", height: 81 },
        },
        {
          text: (
            <>
              <strong className="font-bold">웹 앱으로 열기</strong>를 키고{" "}
              <strong className="font-bold">추가</strong>를 눌러주세요
            </>
          ),
          image: { src: "/install/ios-4.png", height: 178 },
        },
      ]}
    />
  );
}
