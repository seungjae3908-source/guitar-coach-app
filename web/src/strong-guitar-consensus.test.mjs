import assert from 'node:assert/strict';
import test from 'node:test';
import { StrongGuitarConsensus, evaluateStrongInternalGuitarPose } from './strong-guitar-consensus.js';

const recordedPose = {
  mode: 'full',
  confidence: 0.8518572972991091,
  soundhole: {
    x: 0.5440555555555556,
    y: 0.6726979166666667,
    radius: 0.13,
    confidence: 0.7708102634012568,
    score: 0.7279023633087792,
  },
  neck: {
    angle: -50,
    confidence: 0.9133372065147862,
    score: 0.8410693004300547,
  },
  body: {
    center: { x: 0.49809624146296805, y: 0.7274700943496736 },
    radiusAlong: 0.5589999999999999,
    radiusAcross: 0.43550000000000005,
    confidence: 0.6320644159890305,
  },
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

function rejected(reason = '기타 줄 간격 과대 · 몸통 무늬 오인식') {
  return { mode: 'none', confidence: 0, guitarValidated: false, validationReason: reason };
}

test('recorded full guitar with coherent soundhole neck and six lines passes internal consensus', () => {
  const result = evaluateStrongInternalGuitarPose(recordedPose);
  assert.equal(result.valid, true);
  assert.ok(result.confidence >= 0.68);
  assert.equal(result.lineCheck.count, 6);
  assert.ok(result.soundholeDistance < 0.01);
});

test('three stable recorded frames recover from oversized wood-grain string conflict', () => {
  const consensus = new StrongGuitarConsensus();
  let output;
  for (let index = 0; index < 3; index += 1) {
    output = consensus.update({
      pose: recordedPose,
      strictPose: rejected(),
      timestamp: 1000 + index * 180,
    });
  }
  assert.equal(output.guitarValidated, true);
  assert.equal(output.partialValidation, true);
  assert.equal(output.recoverySource, 'internal-pose-consensus');
  assert.equal(output.stringBand.source, 'internal-pose-consensus');
});

test('strict independent validation always wins immediately', () => {
  const consensus = new StrongGuitarConsensus();
  const strict = { ...recordedPose, guitarValidated: true, partialValidation: false };
  const output = consensus.update({ pose: recordedPose, strictPose: strict, timestamp: 1000 });
  assert.equal(output, strict);
});

test('does not override unrelated strict rejection reason', () => {
  const consensus = new StrongGuitarConsensus();
  let output;
  for (let index = 0; index < 6; index += 1) {
    output = consensus.update({
      pose: recordedPose,
      strictPose: rejected('기타 형태 미확인'),
      timestamp: 1000 + index * 180,
    });
  }
  assert.equal(output.guitarValidated, false);
});

test('does not accept fewer than five coherent lines', () => {
  const result = evaluateStrongInternalGuitarPose({ ...recordedPose, lines: recordedPose.lines.slice(0, 4) });
  assert.equal(result.valid, false);
});

test('does not accept soundhole far from the six-line band', () => {
  const result = evaluateStrongInternalGuitarPose({
    ...recordedPose,
    soundhole: { ...recordedPose.soundhole, x: 0.1, y: 0.1 },
  });
  assert.equal(result.valid, false);
});

test('does not accept incoherent line angles', () => {
  const badLines = recordedPose.lines.map((line, index) => index === 5
    ? { start: { x: 0.2, y: 0.2 }, end: { x: 0.8, y: 0.2 } }
    : line);
  const result = evaluateStrongInternalGuitarPose({ ...recordedPose, lines: badLines });
  assert.equal(result.valid, false);
});

test('retains a recovered guitar briefly through fast-hand blur', () => {
  const consensus = new StrongGuitarConsensus({ holdMs: 1400 });
  let ready;
  for (let index = 0; index < 3; index += 1) {
    ready = consensus.update({ pose: recordedPose, strictPose: rejected(), timestamp: 1000 + index * 180 });
  }
  const held = consensus.update({ pose: null, strictPose: rejected('실제 기타 줄 미확인'), previous: ready, timestamp: 1850 });
  assert.equal(held.guitarValidated, true);
  assert.equal(held.mode, 'tracking');
  const expired = consensus.update({ pose: null, strictPose: rejected('실제 기타 줄 미확인'), previous: held, timestamp: 3500 });
  assert.equal(expired.guitarValidated, false);
});
