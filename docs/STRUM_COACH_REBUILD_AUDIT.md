# Strum coach rebuild audit

## Baseline

- `main` HEAD at audit time: `46dc91bb9928eb8b79b180b8396c451b5c3bdb01`.
- Draft PR #16: open, draft, head `d7110c1a912ddc56d67d93627614677dc41e894c`; used only as reference.
- Public entry: `web/src/main.jsx` -> `AppSafe.jsx` -> desktop diagnostic prototype. It contained demo scores and disconnected feature panels.
- Web camera/hand/pose/guitar/string/manual-calibration pipeline: absent on `main`.
- Audio/metronome: microphone RMS attack detection existed only in the opt-in `FocusAnalyzer` route and was not fused with hand movement.
- Mobile: Expo camera recording and microphone practice utilities exist, but no reusable web hand-landmark stream was present.
- Tests/workflow: structure, mobile typecheck/export and web build; no strum algorithm tests.

## Rebuild architecture

The public root now follows: permission -> three-point calibration -> guitar-relative coordinate system -> MediaPipe hand landmarks -> strum-zone crossing state machine -> adaptive audio onset fusion -> stroke events -> BPM/timing/session metrics. Individual six-string detection and soundhole rediscovery are not gates.

The geometry, display/source coordinate conversion, per-hand identity tracking, beat timing, detection/fusion, model adapter and React UI are separate modules. The detector is deterministic and covered by Node tests. The UI never labels model loading or insufficient evidence as successful analysis. Microphone denial is explicitly shown as vision-only degraded mode.

## Deliberately not reused

- Demo scores, placeholder feature cards and diagnostic dashboard at the public root.
- Six-string `0/6` readiness gates.
- PR #16 implementation files or bootstrap workflow.

## Device-validation boundary

Automated tests validate math and state transitions, not Samsung camera exposure, MediaPipe model download, real hand landmark quality, acoustic onset thresholds, thermal throttling or end-to-end accuracy. Those remain device tests.
