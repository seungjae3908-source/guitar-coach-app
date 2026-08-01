import { decideHandPrecisionRegion, type HandPrecisionPoint } from '../services/hand-precision-region';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function hand(centerX: number, centerY: number, scale: number): HandPrecisionPoint[] {
  return Array.from({ length: 21 }, (_, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    return {
      x: centerX + (column - 2) * scale * 0.42,
      y: centerY + (row - 2) * scale * 0.38,
    };
  }).map((point, index) => index === 0
    ? { x: centerX, y: centerY + scale * 0.72 }
    : index === 9
      ? { x: centerX, y: centerY }
      : point);
}

{
  const decision = decideHandPrecisionRegion({ hasHand: true, landmarks: hand(0.52, 0.54, 0.14) });
  assert(decision.shouldRefine, '화면에서 작은 손은 ROI 재분석을 요청해야 합니다.');
  assert(Boolean(decision.region), 'ROI 재분석에는 유효한 영역이 있어야 합니다.');
  assert(decision.regionArea > 0.10 && decision.regionArea < 0.76, 'ROI는 확대 효과가 있으면서 너무 작지 않아야 합니다.');
}

{
  const landmarks = hand(0.08, 0.18, 0.12).map((point) => ({
    x: Math.max(0.002, point.x),
    y: Math.max(0.002, point.y),
  }));
  const decision = decideHandPrecisionRegion({ hasHand: true, landmarks });
  const region = decision.region!;
  assert(region.left >= 0.01 && region.top >= 0.01, '화면 가장자리 손 ROI는 원본 범위를 벗어나면 안 됩니다.');
  assert(region.right <= 0.99 && region.bottom <= 0.99, '화면 가장자리 손 ROI의 반대쪽 경계도 유효해야 합니다.');
  assert(region.left <= Math.max(0.01, Math.min(...landmarks.map((point) => point.x))), 'ROI는 안전 여백 안에서 보이는 손의 왼쪽을 포함해야 합니다.');
}

{
  const decision = decideHandPrecisionRegion({ hasHand: true, landmarks: hand(0.5, 0.5, 0.44) });
  assert(!decision.shouldRefine, '이미 화면에 크게 보이는 손을 다시 과도하게 확대하면 안 됩니다.');
}

{
  const decision = decideHandPrecisionRegion({ hasHand: true, landmarks: hand(0.5, 0.5, 0.12).slice(0, 10) });
  assert(!decision.shouldRefine && decision.reason === 'insufficient-landmarks', '관절점이 부족하면 정밀 결과를 꾸며내면 안 됩니다.');
}

console.log('hand-precision-region tests passed');
