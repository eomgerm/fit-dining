// 고른 사진을 올릴 JPEG 두 벌(1,600px 사진, 썸네일)로 다시 만든다(PRD FR-10, D-9, D-45).
// JPEG로 다시 그리면 EXIF(촬영 위치 포함)가 빠진다. 방향은 그리기 전에 반영한다.
// 상한은 PRD OQ-07 제안값이고 BE 설정(review.photo)과 같다. 용량이 넘으면 거부하지 않고 품질을 낮추고,
// 그래도 크면 긴 변을 줄인다. 작은 사진은 키우지 않는다
export const PHOTO_TARGET = { longEdge: 1600, maxBytes: 1_048_576 };
export const THUMB_TARGET = { longEdge: 400, maxBytes: 102_400 };

export const QUALITIES = [0.85, 0.75, 0.65] as const;
const SHRINK = 0.8;
// 품질 하한에서 긴 변을 줄이는 횟수 상한. 실측 크기로는 여기까지 가지 않는다
const MAX_SHRINKS = 5;

// 브라우저가 그림으로 읽지 못하는 파일(HEIC를 지원하지 않는 브라우저, 깨진 파일 등). 7-E04로 안내한다
export class UnreadablePhotoError extends Error {
  constructor() {
    super("사진을 읽을 수 없어요");
    this.name = "UnreadablePhotoError";
  }
}

export type Target = { longEdge: number; maxBytes: number };

// 긴 변 longEdge, 품질 quality로 JPEG를 만든다
export type Encode = (longEdge: number, quality: number) => Promise<Blob>;

export async function fitJpeg(
  sourceLongEdge: number,
  target: Target,
  encode: Encode,
): Promise<Blob> {
  let edge = Math.min(target.longEdge, sourceLongEdge);
  for (let shrink = 0; shrink <= MAX_SHRINKS; shrink++) {
    const qualities = shrink === 0 ? QUALITIES : [QUALITIES.at(-1)!];
    for (const quality of qualities) {
      const blob = await encode(edge, quality);
      if (blob.size <= target.maxBytes) return blob;
    }
    edge = Math.max(1, Math.round(edge * SHRINK));
  }
  throw new UnreadablePhotoError();
}

// 그리거나 압축하다 실패해도(메모리 부족, 인코딩 실패 등) 올릴 수 없는 사진으로 본다
export async function compressPhoto(
  file: Blob,
): Promise<{ photo: Blob; thumb: Blob }> {
  const bitmap = await decode(file);
  try {
    const source = Math.max(bitmap.width, bitmap.height);
    const encode: Encode = (edge, quality) =>
      toJpeg(bitmap, edge / source, quality);
    return {
      photo: await fitJpeg(source, PHOTO_TARGET, encode),
      thumb: await fitJpeg(source, THUMB_TARGET, encode),
    };
  } catch {
    throw new UnreadablePhotoError();
  } finally {
    bitmap.close();
  }
}

// imageOrientation 값을 모르는 브라우저는 옵션에 TypeError를 던진다. 그때는 옵션 없이 다시 읽는다(지금 명세의 기본값이 from-image다)
async function decode(file: Blob) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (error) {
    if (!(error instanceof TypeError)) throw new UnreadablePhotoError();
  }
  try {
    return await createImageBitmap(file);
  } catch {
    throw new UnreadablePhotoError();
  }
}

async function toJpeg(
  bitmap: ImageBitmap,
  scale: number,
  quality: number,
): Promise<Blob> {
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new UnreadablePhotoError();
    // JPEG에는 투명이 없어 투명한 곳은 흰 바탕으로 둔다
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (blob.type !== "image/jpeg") throw new UnreadablePhotoError();
    return blob;
  } finally {
    // 모바일은 canvas 메모리 한도가 작아 다 쓴 canvas를 바로 비운다
    canvas.width = 0;
    canvas.height = 0;
  }
}
