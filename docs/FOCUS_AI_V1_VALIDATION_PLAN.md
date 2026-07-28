# Validation plan

CI must pass:

- npm dependency installation
- TypeScript type-check
- Expo Android export
- Android native prebuild
- compact ARM64 release APK build
- APK signing verification
- artifact upload

Physical-device validation remains separate and must confirm microphone metering, hit detection, result scoring, speech feedback, local history persistence, and regression-free camera recording.
