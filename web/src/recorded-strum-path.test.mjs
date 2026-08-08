import assert from 'node:assert/strict';
import test from 'node:test';
import { AdaptiveLiveStrumEngine, deriveAdaptiveStringBand } from './adaptive-strum-live.js';
import { StrongGuitarConsensus } from './strong-guitar-consensus.js';

const pose = {
  mode: 'full',
  confidence: 0.8518572972991091,
  soundhole: { x: 0.5440555555555556, y: 0.6726979166666667, radius: 0.13, confidence: 0.7708102634012568 },
  neck: { angle: -50, confidence: 0.9133372065147862 },
  body: { center: { x: 0.49809624146296805, y: 0.7274700943496736 }, radiusAlong: 0.559, radiusAcross: 0.4355, confidence: 0.632 },
  lines: Array.from({ length: 6 }, (_, index) => ({
    start: { x: 1, y: 0.1353916812495174 - index * 0.00893174585101775 },
    end: { x: 0.39052018618407586 - index * 0.0106444402060889, y: 0.9172129296034222 - index * 0.00893174585101775 },
  })),
  stringBand: {
    top: -0.8970661230470058,
    bottom: -0.8109150780644876,
    center: -0.8539906005557467,
    normalX: -0.766044443118978,
    normalY: -0.6427876096865394,
    tangentX: -0.6427876096865394,
    tangentY: 0.766044443118978,
    angle: 130,
    supportMin: -0.5689908256880736,
    supportMax: 0.4516043308679755,
    supportLength: 1.0205951565560492,
  },
  axis: {
    tangent: { x: -0.6427876096865394, y: 0.766044443118978 },
    normal: { x: -0.766044443118978, y: -0.6427876096865394 },
  },
  zones: {
    strum: { center: { x: 0.506, y: 0.718 }, alongRadius: 0.312, acrossRadius: 0.2145 },
    fret: { center: { x: 0.755, y: 0.436 }, alongRadius: 0.224, acrossRadius: 0.121 },
  },
};

function rejected() {
  return { mode: 'none', confidence: 0, guitarValidated: false, validationReason: '기타 줄 간격 과대 · 몸통 무늬 오인식' };
}

function pointAtProjection(normalProjection) {
  const tangentProjection = 0.1656043308679755;
  return {
    x: tangentProjection * pose.axis.tangent.x + normalProjection * pose.axis.normal.x,
    y: tangentProjection * pose.axis.tangent.y + normalProjection * pose.axis.normal.y,
  };
}

function strumHand(trackId, normalProjection) {
  const point = pointAtProjection(normalProjection);
  const scale = 0.085;
  const landmarks = Array.from({ length: 21 }, () => ({ x: point.x, y: point.y }));
  landmarks[0] = { x: point.x, y: point.y + scale * 0.8 };
  landmarks[4] = { x: point.x - scale * 0.08, y: point.y };
  landmarks[8] = { x: point.x + scale * 0.08, y: point.y };
  landmarks[5] = { x: point.x - scale * 0.28, y: point.y + scale * 0.48 };
  landmarks[9] = { x: point.x, y: point.y + scale * 0.54 };
  landmarks[17] = { x: point.x + scale * 0.34, y: point.y + scale * 0.44 };
  return {
    trackId,
    role: 'strum',
    roleConfidence: 0.78,
    landmarks,
    strumDistance: 0.25,
    fretDistance: 1.8,
  };
}

test('recorded wood-grain conflict no longer returns guitar-pose-missing', () => {
  const consensus = new StrongGuitarConsensus();
  let recovered;
  for (let index = 0; index < 3; index += 1) {
    recovered = consensus.update({ pose, strictPose: rejected(), timestamp: 1000 + index * 180 });
  }
  const geometry = deriveAdaptiveStringBand(recovered);
  assert.equal(recovered.guitarValidated, true);
  assert.equal(geometry.valid, true);
  assert.notEqual(geometry.reason, 'guitar-pose-missing');
});

test('step-four down strum counts through one brief hand-blur frame', () => {
  const consensus = new StrongGuitarConsensus();
  let recovered;
  for (let index = 0; index < 3; index += 1) {
    recovered = consensus.update({ pose, strictPose: rejected(), timestamp: 1000 + index * 180 });
  }
  const engine = new AdaptiveLiveStrumEngine();
  const projections = [-0.93, -0.92, null, -0.88, -0.85, -0.82, -0.78, -0.77];
  const events = [];
  projections.forEach((projection, index) => {
    const result = engine.update({
      timestamp: 2000 + index * 72,
      roles: projection == null ? [] : [strumHand(2, projection)],
      pose: recovered,
    });
    if (result.event) events.push(result.event);
  });
  assert.deepEqual(events, ['down']);
});
