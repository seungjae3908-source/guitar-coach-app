# v28 recognition verification

- Branch: `agent/live-coach-compat-v055`
- PR: `#16` remains Draft and unmerged
- Hand presence no longer depends on handedness classification confidence
- Camera search cycles through wider zoom levels when a distant hand is not yet found
- Hand detection runs every frame while searching
- MediaPipe hand thresholds are relaxed for distant hands
- String tracking survives short misses and uses wider geometry and contact tolerances
- Automatic pick mode is no longer forced to green
- Strum hit speed, approach, contact, and quality thresholds are relaxed
- 850 ms strum lock remains unchanged
- Typecheck and executable tests passed
- Kotlin release compile and ARM64 APK build passed
- APK signature and ABI were verified
