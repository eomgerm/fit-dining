// 상세 주소의 장소 id. 양의 정수이고 JavaScript의 안전한 정수 범위 안일 때만 요청한다
export function parsePlaceId(raw: string | null) {
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}
