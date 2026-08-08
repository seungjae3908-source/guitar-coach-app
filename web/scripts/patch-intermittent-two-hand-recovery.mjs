import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), 'src/backlit-guitar-recovery.js');
let source = readFileSync(target, 'utf8');

if (!source.includes('this.candidateGapMs = candidateGapMs')) {
  const replacements = [
    [
      'constructor({ holdMs = 900 } = {}) {\n    this.holdMs = holdMs;\n    this.reset();',
      'constructor({ holdMs = 900, candidateGapMs = 850 } = {}) {\n    this.holdMs = holdMs;\n    this.candidateGapMs = candidateGapMs;\n    this.reset();',
      'constructor gap setting',
    ],
    [
      'const stable = elapsed >= 0 && elapsed <= 700 && candidateStable(this.lastCandidate, candidate);',
      'const stable = elapsed >= 0 && elapsed <= this.candidateGapMs && candidateStable(this.lastCandidate, candidate);',
      'candidate stability window',
    ],
    [
      'const requiredSamples = candidate.bodyReady || candidate.explicitRoles ? 5 : 9;',
      'const requiredSamples = candidate.bodyReady || candidate.explicitRoles ? 5 : 7;',
      'low-fps sample requirement',
    ],
    [
      `    } else {
      this.lastCandidate = null;
      this.stableSamples = 0;
      this.lastCandidateAt = 0;
    }`,
      `    } else if (!this.lastCandidateAt || now - this.lastCandidateAt > this.candidateGapMs) {
      // A single blurred/empty hand frame must not erase several coherent
      // two-hand samples. Reset only after a real gap. Null frames never add
      // evidence; they merely preserve the last coherent candidate briefly.
      this.lastCandidate = null;
      this.stableSamples = 0;
      this.lastCandidateAt = 0;
    }`,
      'brief candidate gap retention',
    ],
  ];

  for (const [before, after, label] of replacements) {
    const first = source.indexOf(before);
    if (first < 0) throw new Error(`Intermittent two-hand recovery target missing: ${label}`);
    if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Intermittent two-hand recovery target ambiguous: ${label}`);
    source = source.slice(0, first) + after + source.slice(first + before.length);
  }

  writeFileSync(target, source);
}

console.log('Applied gap-tolerant two-hand guitar recovery for intermittent low-FPS hand frames.');
