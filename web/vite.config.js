import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const FRONT_CAMERA_REPLACEMENTS = [
  [
    "{ id: 'camera', title: '카메라 연결', instruction: '카메라를 허용하고 기타와 오른손이 화면에 보이도록 휴대폰을 세워 주세요.' }",
    "{ id: 'camera', title: '전면카메라 연결', instruction: '전면카메라를 허용하고 화면을 보면서 기타와 오른손이 함께 보이도록 휴대폰을 세워 주세요.' }",
  ],
  ["const [facing, setFacing] = useState('environment');", "const [facing] = useState('user');"],
  [
    "facingMode: { ideal: requestedFacing }",
    "facingMode: { exact: 'user' }",
  ],
  [
    "addLog(`카메라 시작 · ${requestedFacing === 'environment' ? '후면' : '전면'}`);",
    "addLog('카메라 시작 · 전면 웹 고정');",
  ],
  ["await startCamera();", "await startCamera('user');"],
  [
    "const switchFacing = async () => {\n    const next = facing === 'environment' ? 'user' : 'environment';\n    setFacing(next);\n    trackerRef.current.reset();\n    await startCamera(next);\n  };",
    "const switchFacing = async () => {\n    trackerRef.current.reset();\n    setBanner('이 웹 진단은 전면카메라로 고정되어 있습니다.');\n    addLog('전면카메라 고정 유지');\n    await startCamera('user');\n  };",
  ],
  [
    '<video ref={videoRef} playsInline muted />',
    '<video ref={videoRef} playsInline muted style={{ transform: \'scaleX(-1)\' }} />',
  ],
  [
    "<canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />",
    "<canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', transform: 'scaleX(-1)' }} />",
  ],
  [
    '<button className="debug-secondary" onClick={() => void switchFacing()} disabled={!running}>전후면 전환</button>',
    '<button className="debug-secondary" onClick={() => void switchFacing()} disabled={!running}>전면카메라 고정</button>',
  ],
  [
    '<div><span>FPS</span><strong>{stats.fps || \'-\'}</strong></div><div><span>해상도</span><strong>{stats.width ? `${stats.width}×${stats.height}` : \'-\'}</strong></div>',
    '<div><span>카메라</span><strong>전면 고정</strong></div><div><span>해상도</span><strong>{stats.width ? `${stats.width}×${stats.height}` : \'-\'}</strong></div>',
  ],
];

function forceFrontCameraForWeb() {
  return {
    name: 'guitar-coach-force-front-camera',
    enforce: 'pre',
    transform(source, id) {
      if (!id.endsWith('/src/DebugCenter.jsx')) return null;

      let transformed = source;
      for (const [before, after] of FRONT_CAMERA_REPLACEMENTS) {
        if (!transformed.includes(before)) {
          throw new Error(`Front-camera web transform target is missing: ${before.slice(0, 80)}`);
        }
        transformed = transformed.replace(before, after);
      }

      return { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [forceFrontCameraForWeb(), react()],
  base: '/guitar-coach-app/',
});
