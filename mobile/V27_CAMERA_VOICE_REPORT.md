# v27 CameraX / Strum / Voice verification

- Branch: `agent/live-coach-compat-v055`
- PR: `#16` (Draft, unmerged)
- Android CameraX continuous-frame watchdog and rebind recovery added
- `PreviewView` explicitly measured and laid out inside the Expo native view
- Android fallback bypass removed; native continuous analysis and string analysis enabled
- Hand, string, contact, and hit thresholds relaxed without removing geometry checks
- Strum lock retained for 850 ms and extended by subsequent hits
- Accepted analysis frames and native strum hits drive the voice coach
- Startup voice and an in-camera voice test button added
- `npm run typecheck` passed, including executable quality tests
- Release Kotlin compilation passed
- ARM64-only release APK built, signed, and verified with `apksigner`
