# Focus AI v1

## Implemented

- Dedicated full-screen AI focus practice entry from the existing app.
- Five modes: chord changes, fingering, arpeggio, strumming, alternate picking.
- BPM control from 35 to 180.
- 30-second, 1-minute, 3-minute, and 5-minute sessions.
- Three-second countdown and visual/haptic metronome.
- Real microphone recording through expo-audio.
- Real-time metering and configurable input sensitivity.
- Peak detection with a refractory window to reduce double counting.
- Device-side scoring for timing accuracy, interval consistency, volume stability, and completion.
- One or two priority coaching messages per session.
- Korean text-to-speech result feedback.
- Local history persistence for the latest 30 sessions.

## Honest limitations

The label "AI" refers to a deterministic device-side coaching engine. This version does not identify notes, chords, hand pose, finger identity, pick angle, or musical intent. It does not upload recordings or send microphone data to a server.

## OTA update status

True JavaScript over-the-air updates require a configured Expo Updates service URL and runtime version. The repository currently has no EAS project ID or update URL, so OTA updates are intentionally not presented as active. A one-time Expo project connection is required before enabling it in a production APK.
