import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

const patch = readFileSync(resolve(process.cwd(), 'scripts/patch-strong-guitar-consensus.mjs'), 'utf8');

test('strong guitar recovery evaluates the raw candidate instead of a stale stabilized pose', () => {
  assert.match(patch, /pose: candidatePose,/);
  assert.doesNotMatch(patch, /pose: stabilized\.pose \|\| candidatePose,/);
});

test('the recovery badge identifies raw soundhole-neck-six-string consensus', () => {
  assert.match(patch, /사운드홀·넥·6줄 원본 합의/);
});
