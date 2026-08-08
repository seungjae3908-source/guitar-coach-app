import { strict as assert } from 'node:assert';

import {
  audioFeedbackReady,
  MIN_AUDIO_EVIDENCE_ATTACKS,
  MIN_AUDIO_EVIDENCE_CYCLES,
  MIN_VISUAL_EVIDENCE_FRAMES,
  visualFeedbackReady,
} from '../services/feedback-evidence-gate';

assert.equal(visualFeedbackReady({ running: true, acceptedFrames: 0, sessionStartedAt: 1 }), false);
assert.equal(visualFeedbackReady({ running: true, acceptedFrames: MIN_VISUAL_EVIDENCE_FRAMES - 1, sessionStartedAt: 1 }), false);
assert.equal(visualFeedbackReady({ running: true, acceptedFrames: MIN_VISUAL_EVIDENCE_FRAMES, sessionStartedAt: 1 }), true);
assert.equal(visualFeedbackReady({ running: false, acceptedFrames: 99, sessionStartedAt: 1 }), false);

assert.equal(audioFeedbackReady({ microphoneActive: true, completedCycles: 0, acceptedAttacks: 99 }), false);
assert.equal(audioFeedbackReady({ microphoneActive: true, completedCycles: MIN_AUDIO_EVIDENCE_CYCLES, acceptedAttacks: MIN_AUDIO_EVIDENCE_ATTACKS - 1 }), false);
assert.equal(audioFeedbackReady({ microphoneActive: true, completedCycles: MIN_AUDIO_EVIDENCE_CYCLES, acceptedAttacks: MIN_AUDIO_EVIDENCE_ATTACKS }), true);
assert.equal(audioFeedbackReady({ microphoneActive: false, completedCycles: 99, acceptedAttacks: 99 }), false);

console.log('feedback evidence gate tests passed');
