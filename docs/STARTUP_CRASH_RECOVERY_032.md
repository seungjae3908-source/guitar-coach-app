# Android startup crash recovery 0.3.2

The 0.3.0 and 0.3.1 builds introduced expo-audio and expo-speech. The app continued to terminate on the target Android phone even after lazy-loading the AI screen. Version 0.3.2 removes those native modules and restores the previously phone-verified application entry path (`App`) so camera, recording, gallery save, separated screens, focus timer, records, tone settings, and local settings can run without the experimental AI audio stack.

AI microphone analysis is intentionally disabled in this recovery build. It will be reintroduced only after a separate compatibility build is validated without destabilizing the main app.
