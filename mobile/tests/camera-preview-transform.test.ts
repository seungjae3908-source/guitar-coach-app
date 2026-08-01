import {
  cameraCoverMetrics,
  imagePointToPreview,
  previewPointToImage,
  previewRegionToImage,
} from '../services/camera-preview-transform';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function close(actual: number, expected: number, tolerance = 0.000001) {
  return Math.abs(actual - expected) <= tolerance;
}

{
  const preview = { width: 360, height: 480 };
  const image = { width: 1080, height: 1440 };
  const point = { x: 0.23, y: 0.71 };
  const mapped = previewPointToImage(point, preview, image);
  assert(close(mapped.x, point.x) && close(mapped.y, point.y), '같은 화면비 좌표는 변하지 않아야 합니다.');
}

{
  const preview = { width: 360, height: 480 };
  const image = { width: 4032, height: 3024 };
  const metrics = cameraCoverMetrics(preview, image);
  assert(close(metrics.cropX, 140), '4:3 촬영 원본은 3:4 미리보기에서 좌우 140px씩 잘려야 합니다.');
  assert(close(metrics.cropY, 0), '세로 방향 크롭은 없어야 합니다.');

  const left = previewPointToImage({ x: 0, y: 0.5 }, preview, image);
  const right = previewPointToImage({ x: 1, y: 0.5 }, preview, image);
  assert(close(left.x, 0.21875), '미리보기 왼쪽은 촬영 원본의 보이는 왼쪽 경계로 변환되어야 합니다.');
  assert(close(right.x, 0.78125), '미리보기 오른쪽은 촬영 원본의 보이는 오른쪽 경계로 변환되어야 합니다.');
}

{
  const preview = { width: 360, height: 480 };
  const image = { width: 4032, height: 3024 };
  const points = [
    { x: 0.08, y: 0.12 },
    { x: 0.5, y: 0.5 },
    { x: 0.91, y: 0.86 },
  ];
  for (const point of points) {
    const imagePoint = previewPointToImage(point, preview, image);
    const restored = imagePointToPreview(imagePoint, preview, image);
    assert(close(restored.x, point.x) && close(restored.y, point.y), '미리보기와 촬영 원본 좌표는 왕복 복원되어야 합니다.');
  }
}

{
  const preview = { width: 360, height: 480 };
  const image = { width: 4032, height: 3024 };
  const mapped = previewRegionToImage(
    { left: 0.2, top: 0.3, right: 0.8, bottom: 0.85 },
    preview,
    image,
    0.025,
  );
  assert(mapped.left >= 0 && mapped.top >= 0 && mapped.right <= 1 && mapped.bottom <= 1, '변환 ROI는 정규화 범위를 벗어나면 안 됩니다.');
  assert(mapped.right > mapped.left && mapped.bottom > mapped.top, '변환 ROI의 방향과 크기가 유효해야 합니다.');
  assert(mapped.left < 0.33125 && mapped.right > 0.66875, '분석 여유 영역이 촬영 원본 ROI에 포함되어야 합니다.');
}

console.log('camera-preview-transform tests passed');
