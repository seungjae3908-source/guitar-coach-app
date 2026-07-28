# Focus AI v1 implementation report

- Branch: `agent/focus-ai-v1`
- Mobile version: `0.3.0`
- Android versionCode: `3`
- Analysis stays on the device.
- Microphone recordings are used only while a focus session is active.
- The current analysis engine uses metering peaks and timing grids; it is not a cloud model.
- Existing camera, video, tone, study, records, and settings screens remain in the legacy app under `App.tsx`.
- `AppShell.tsx` adds a dedicated `AI 집중` entry without replacing or destabilizing the verified camera flow.
- Physical-device validation is still required after CI creates the signed ARM64 APK.
