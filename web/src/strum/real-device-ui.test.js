import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const coach = await readFile(new URL('../StrumCoach.jsx', import.meta.url), 'utf8');

test('front camera mirrors video but does not double-mirror overlay canvas', () => {
  assert.match(styles, /\.camera-card video\{transform:scaleX\(-1\)\}/);
  assert.match(styles, /\.camera-card canvas\{transform:none/);
});

test('calibration requires explicit visual confirmation before practice', () => {
  assert.match(coach, /setPhase\("confirming"\)/);
  assert.match(coach, /보정 맞음/);
  assert.match(coach, /초록 박스가 실제 사운드홀 주변 스트럼 영역/);
});

test('device diagnostics remain opt-in behind debug=1', () => {
  assert.match(coach, /get\("debug"\) === "1"/);
  assert.match(coach, /REJECT COUNTS/);
  assert.match(coach, /DEVICE DEBUG/);
});
