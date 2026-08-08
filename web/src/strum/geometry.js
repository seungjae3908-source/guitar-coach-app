const EPSILON = 1e-6;

export const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createCalibration({ soundhole, neck, sixStringEdge, bandEdge = sixStringEdge, mirrored = false }) {
  const axisLength = distance(soundhole, neck);
  if (axisLength < 0.12) throw new Error('NECK_POINT_TOO_CLOSE');
  const tangent = { x: (neck.x - soundhole.x) / axisLength, y: (neck.y - soundhole.y) / axisLength };
  const candidate = { x: -tangent.y, y: tangent.x };
  const edgeProjection = (bandEdge.x - soundhole.x) * candidate.x + (bandEdge.y - soundhole.y) * candidate.y;
  const normal = edgeProjection >= 0 ? candidate : { x: -candidate.x, y: -candidate.y };
  const bandOffset = (bandEdge.x - soundhole.x) * normal.x + (bandEdge.y - soundhole.y) * normal.y;
  if (Math.abs(bandOffset) < 0.025) throw new Error('STRING_BAND_TOO_NARROW');
  const halfWidth = clamp(Math.abs(bandOffset), 0.035, 0.18);
  return {
    origin: { ...soundhole }, tangent, normal, mirrored, axisLength,
    stringBand: { min: -halfWidth, max: halfWidth },
    strumZone: { alongMin: -axisLength * 0.28, alongMax: axisLength * 0.32, acrossMin: -halfWidth * 1.65, acrossMax: halfWidth * 1.65 },
    bodyRadius: axisLength * 0.72,
  };
}

export function toGuitarSpace(point, calibration) {
  const dx = point.x - calibration.origin.x;
  const dy = point.y - calibration.origin.y;
  return { along: dx * calibration.tangent.x + dy * calibration.tangent.y, across: dx * calibration.normal.x + dy * calibration.normal.y };
}

export function fromGuitarSpace(point, calibration) {
  return {
    x: calibration.origin.x + point.along * calibration.tangent.x + point.across * calibration.normal.x,
    y: calibration.origin.y + point.along * calibration.tangent.y + point.across * calibration.normal.y,
  };
}

export function strumPoint(landmarks) {
  const ids = [0, 2, 5, 9, 13, 17];
  const points = ids.map((id) => landmarks[id]).filter(Boolean);
  if (points.length < 4) return null;
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
}
