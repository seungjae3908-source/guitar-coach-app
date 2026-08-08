# v29 camera feed and speech verification

- Branch: `agent/live-coach-compat-v055`
- PR: `#16` remains Draft and unmerged
- CameraX analysis changed from RGBA to YUV 420 888 for Samsung compatibility
- Preview stream state and sampled frame brightness are monitored
- Missing, idle, and black frames trigger automatic rebind
- PreviewView switches between compatible and performance modes during recovery
- The screen displays actual brightness, stream state, preview mode, and recovery count
- Android TTS requests audio focus and waits for the utterance completion callback
- TTS preparation and playback failures are visible instead of being ignored
- Typecheck, executable tests, Kotlin release compile, ABI, and APK signing passed
