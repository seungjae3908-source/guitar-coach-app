# PR #17 device-test readiness

## HTTPS preview status

There is no repository-provided HTTPS URL for pull request #17. The only configured Pages URL is the main/production site, and `.github/workflows/publish-links.yml` intentionally skips every pull-request build. This guard must remain in place because the same workflow also builds an APK.

## Safe manual preview

Without changing Pages or deploying production, a reviewer can build and serve the checked-out PR locally and expose that local port through an ephemeral HTTPS tunnel:

1. Check out `codex/strum-coach-rebuild-v1` on a trusted computer.
2. Run `npm install` and `npm run build` in `web`.
3. Run `npm run preview -- --host 127.0.0.1 --port 4173` in `web`.
4. Start a trusted ephemeral HTTPS tunnel to `http://127.0.0.1:4173` (for example, `cloudflared tunnel --url http://127.0.0.1:4173`).
5. Open the temporary `https://...` URL followed by `/guitar-coach-app/` on the Samsung phone.
6. Stop both the tunnel and preview server immediately after testing.

This is a manual reviewer action. The repository does not install a tunnel client, create a public endpoint, or deploy automatically. The temporary URL should be treated as public unless the selected tunnel provider adds access control.

## Runtime boundary

- Display/source coordinate conversion accounts for cover cropping and front-camera mirroring.
- Calibration defines the six-string edge, so six-to-one is down and one-to-six is up.
- Short hand dropouts are retained for three inference frames. A long loss does not move the guitar coordinate system automatically; it asks for one-tap recalibration.
- GPU initialization falls back to CPU. Both paths still require the MediaPipe CDN assets.
