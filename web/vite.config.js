import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const REPLACEMENTS = [
  [
    "import './debug-center.css';",
    "import { sendLiveDiagnostics } from './live-telemetry.js';\nimport './debug-center.css';",
  ],
  [
    "{ id: 'camera', title: '카메라 연결', instruction: '카메라를 허용하고 기타와 오른손이 화면에 보이도록 휴대폰을 세워 주세요.' }",
    "{ id: 'camera', title: '전면카메라 연결', instruction: '전면카메라를 허용하고 화면을 보면서 기타와 양손이 가능한 범위에서 보이도록 세워 주세요. 기타는 중앙에 맞출 필요가 없습니다.' }",
  ],
  [
    "{ id: 'hand', title: '오른손 21관절', instruction: '오른손 전체와 손가락 끝이 잘리지 않게 화면에 3초간 보여 주세요.' }",
    "{ id: 'hand', title: '양손 관절 인식', instruction: '왼손과 오른손을 동시에 추적합니다. 스트럼 손은 줄 영역에 가까운 손으로 자동 선택합니다.' }",
  ],
  [
    "{ id: 'guitar', title: '기타 인식', instruction: '기타 몸통과 브리지, 오른손이 함께 보이게 각도를 맞춰 주세요.' }",
    "{ id: 'guitar', title: '기타 인식', instruction: '기타가 중앙·아래쪽·사선에 있어도 됩니다. 몸통 일부와 줄, 연주 손이 함께 보이게 해 주세요.' }",
  ],
  [
    "{ id: 'strings', title: '기타 줄 인식', instruction: '기타 줄 4개 이상이 선명하게 보이도록 브리지 쪽에 초점을 맞춰 주세요.' }",
    "{ id: 'strings', title: '기타 줄 인식', instruction: '수평뿐 아니라 기울어진 줄도 찾습니다. 줄 4개 이상과 연주 손이 함께 보이게 해 주세요.' }",
  ],
  ["runningMode: 'VIDEO', numHands: 1,", "runningMode: 'VIDEO', numHands: 2,"],
  ["const [facing, setFacing] = useState('environment');", "const [facing] = useState('user');"],
  [
    "const [sessionCode] = useState(() => localStorage.getItem('gc-debug-session') || makeCode());",
    "const [sessionCode] = useState(() => localStorage.getItem('gc-debug-session') || makeCode());\n  const [remoteSessionCode, setRemoteSessionCode] = useState('');\n  const [remoteLogStatus, setRemoteLogStatus] = useState('테스트 시작 후 연결');",
  ],
  [
    "const visionRef = useRef({ handConfidence: 0, handLandmarks: [], pickPoint: null, guitarModelScore: 0, guitarLabel: '', guitarConfidence: 0, stringCount: 0, stringConfidence: 0, stringRows: [], stringBand: null });",
    "const visionRef = useRef({ hands: [], handedness: 'Unknown', handConfidence: 0, handLandmarks: [], pickPoint: null, guitarModelScore: 0, guitarLabel: '', guitarConfidence: 0, guitarAngle: 0, guitarCenter: null, stringCount: 0, stringConfidence: 0, stringRows: [], stringLines: [], stringAngle: 0, stringBand: null });",
  ],
  [
    "visionRef.current = { handConfidence: 0, handLandmarks: [], pickPoint: null, guitarModelScore: 0, guitarLabel: '', guitarConfidence: 0, stringCount: 0, stringConfidence: 0, stringRows: [], stringBand: null };",
    "visionRef.current = { hands: [], handedness: 'Unknown', handConfidence: 0, handLandmarks: [], pickPoint: null, guitarModelScore: 0, guitarLabel: '', guitarConfidence: 0, guitarAngle: 0, guitarCenter: null, stringCount: 0, stringConfidence: 0, stringRows: [], stringLines: [], stringAngle: 0, stringBand: null };",
  ],
  [
    "  const drawOverlay = (landmarks, rows, width, height) => {\n    const canvas = overlayRef.current;\n    if (!canvas || !width || !height) return;\n    canvas.width = width;\n    canvas.height = height;\n    const context = canvas.getContext('2d');\n    context.clearRect(0, 0, width, height);\n    context.lineWidth = Math.max(2, width / 420);\n    context.strokeStyle = '#34d399';\n    context.fillStyle = '#34d399';\n    if (landmarks?.length === 21) {\n      for (const [start, end] of HAND_CONNECTIONS) {\n        context.beginPath();\n        context.moveTo(landmarks[start].x * width, landmarks[start].y * height);\n        context.lineTo(landmarks[end].x * width, landmarks[end].y * height);\n        context.stroke();\n      }\n      for (const point of landmarks) {\n        context.beginPath();\n        context.arc(point.x * width, point.y * height, Math.max(3, width / 220), 0, Math.PI * 2);\n        context.fill();\n      }\n    }\n    context.strokeStyle = '#fbbf24';\n    for (const row of rows || []) {\n      context.beginPath();\n      context.moveTo(width * 0.08, (row / 180) * height);\n      context.lineTo(width * 0.92, (row / 180) * height);\n      context.stroke();\n    }\n  };",
    "  const drawOverlay = (hands, lines, width, height) => {\n    const canvas = overlayRef.current;\n    if (!canvas || !width || !height) return;\n    canvas.width = width;\n    canvas.height = height;\n    const context = canvas.getContext('2d');\n    context.clearRect(0, 0, width, height);\n    context.lineWidth = Math.max(2, width / 420);\n    for (const [handIndex, hand] of (hands || []).entries()) {\n      const landmarks = hand?.landmarks || [];\n      if (landmarks.length !== 21) continue;\n      context.strokeStyle = handIndex === 0 ? '#34d399' : '#60a5fa';\n      context.fillStyle = handIndex === 0 ? '#34d399' : '#60a5fa';\n      for (const [start, end] of HAND_CONNECTIONS) {\n        context.beginPath();\n        context.moveTo(landmarks[start].x * width, landmarks[start].y * height);\n        context.lineTo(landmarks[end].x * width, landmarks[end].y * height);\n        context.stroke();\n      }\n      for (const point of landmarks) {\n        context.beginPath();\n        context.arc(point.x * width, point.y * height, Math.max(3, width / 220), 0, Math.PI * 2);\n        context.fill();\n      }\n    }\n    context.strokeStyle = '#fbbf24';\n    for (const line of lines || []) {\n      context.beginPath();\n      context.moveTo(line.start.x * width, line.start.y * height);\n      context.lineTo(line.end.x * width, line.end.y * height);\n      context.stroke();\n    }\n  };",
  ],
  [
    "  const processHand = (video, timestamp) => {\n    const handModel = modelRef.current.hand;\n    if (!handModel || handBusyRef.current || video.readyState < 2) return;\n    handBusyRef.current = true;\n    try {\n      const result = handModel.detectForVideo(video, timestamp);\n      const landmarks = result.landmarks?.[0] || [];\n      const category = result.handednesses?.[0]?.[0];\n      const confidence = landmarks.length === 21 ? Number(category?.score || 0.75) : 0;\n      const pickPoint = landmarks.length === 21 ? {\n        x: (landmarks[4].x + landmarks[8].x) / 2,\n        y: (landmarks[4].y + landmarks[8].y) / 2,\n      } : null;\n      visionRef.current.handLandmarks = landmarks;\n      visionRef.current.handConfidence = confidence;\n      visionRef.current.pickPoint = pickPoint;\n    } catch (error) {\n      setModelStatus((status) => ({ ...status, hand: '실행 오류', error: String(error?.message || error) }));\n    } finally {\n      handBusyRef.current = false;\n    }\n  };",
    "  const processHand = (video, timestamp) => {\n    const handModel = modelRef.current.hand;\n    if (!handModel || handBusyRef.current || video.readyState < 2) return;\n    handBusyRef.current = true;\n    try {\n      const result = handModel.detectForVideo(video, timestamp);\n      const detectedHands = (result.landmarks || []).slice(0, 2).map((landmarks, index) => {\n        const category = result.handednesses?.[index]?.[0];\n        const confidence = landmarks.length === 21 ? Number(category?.score || 0.75) : 0;\n        const pickPoint = landmarks.length === 21 ? {\n          x: (landmarks[4].x + landmarks[8].x) / 2,\n          y: (landmarks[4].y + landmarks[8].y) / 2,\n        } : null;\n        return { handedness: category?.categoryName || category?.displayName || 'Unknown', confidence, landmarks, wrist: landmarks[0] || null, pickPoint };\n      });\n      const band = visionRef.current.stringBand;\n      const projectionDistance = (hand) => {\n        if (!hand.pickPoint || !band) return hand.handedness === 'Right' ? 0.5 : 1;\n        const projection = (band.normalX || 0) * hand.pickPoint.x + (band.normalY ?? 1) * hand.pickPoint.y;\n        return Math.abs(projection - band.center);\n      };\n      const selectedHand = [...detectedHands].sort((left, right) => projectionDistance(left) - projectionDistance(right))[0] || null;\n      visionRef.current.hands = detectedHands;\n      visionRef.current.handedness = selectedHand?.handedness || 'Unknown';\n      visionRef.current.handLandmarks = selectedHand?.landmarks || [];\n      visionRef.current.handConfidence = selectedHand?.confidence || 0;\n      visionRef.current.pickPoint = selectedHand?.pickPoint || null;\n    } catch (error) {\n      setModelStatus((status) => ({ ...status, hand: '실행 오류', error: String(error?.message || error) }));\n    } finally {\n      handBusyRef.current = false;\n    }\n  };",
  ],
  [
    "      visionRef.current.stringRows = stringResult.rows;\n      visionRef.current.stringBand = stringResult.band;",
    "      visionRef.current.stringRows = stringResult.rows;\n      visionRef.current.stringLines = stringResult.lines || [];\n      visionRef.current.stringAngle = stringResult.angle || 0;\n      visionRef.current.stringBand = stringResult.band;\n      visionRef.current.guitarAngle = stringResult.angle || 0;\n      const linePoints = (stringResult.lines || []).flatMap((line) => [line.start, line.end]);\n      visionRef.current.guitarCenter = linePoints.length ? { x: linePoints.reduce((sum, point) => sum + point.x, 0) / linePoints.length, y: linePoints.reduce((sum, point) => sum + point.y, 0) / linePoints.length } : null;",
  ],
  [
    "        handConfidence: visionRef.current.handConfidence,\n      });",
    "        handConfidence: visionRef.current.handConfidence,\n        handPoint: visionRef.current.pickPoint,\n        band: stringResult.band,\n      });",
  ],
  [
    "      drawOverlay(visionRef.current.handLandmarks, stringResult.rows, video.videoWidth, video.videoHeight);",
    "      drawOverlay(visionRef.current.hands, stringResult.lines, video.videoWidth, video.videoHeight);",
  ],
  [
    "      const direction = trackerRef.current.sample({ timestamp, pointY: evidence.pickPoint?.y, band: evidence.stringBand, ready });",
    "      const direction = trackerRef.current.sample({ timestamp, point: evidence.pickPoint, band: evidence.stringBand, ready });",
  ],
  [
    "    stats, modelStatus, vision: {\n      handLandmarks: vision.handLandmarks?.length || 0,\n      handConfidence: vision.handConfidence,\n      guitarModelScore: vision.guitarModelScore,\n      guitarLabel: vision.guitarLabel,\n      guitarConfidence: vision.guitarConfidence,\n      stringCount: vision.stringCount,\n      stringConfidence: vision.stringConfidence,\n    }, strokeCounts, results, logs,",
    "    stats, modelStatus, vision: {\n      handCount: vision.hands?.length || 0,\n      hands: vision.hands || [],\n      handedness: vision.handedness || 'Unknown',\n      handLandmarks: vision.handLandmarks || [],\n      handConfidence: vision.handConfidence,\n      pickPoint: vision.pickPoint,\n      guitarModelScore: vision.guitarModelScore,\n      guitarLabel: vision.guitarLabel,\n      guitarConfidence: vision.guitarConfidence,\n      guitarAngle: vision.guitarAngle || 0,\n      guitarCenter: vision.guitarCenter || null,\n      stringCount: vision.stringCount,\n      stringConfidence: vision.stringConfidence,\n      stringAngle: vision.stringAngle || 0,\n      stringBand: vision.stringBand || null,\n    }, strokeCounts, results, logs,",
  ],
  [
    "  const downloadReport = () => {",
    "  useEffect(() => {\n    if (!running) return;\n    void sendLiveDiagnostics({\n      report,\n      currentTest: currentId,\n      vision,\n      strokeCounts,\n      modelStatus,\n      evidenceReady: canCountStrum(vision),\n      lastDirection: trackerRef.current.lastDirection || 'none',\n    }).then((session) => {\n      if (!session) return;\n      setRemoteSessionCode(session.code);\n      setRemoteLogStatus('실시간 연결됨');\n    }).catch((error) => {\n      setRemoteLogStatus(`연결 오류: ${error?.message || error}`);\n    });\n  }, [running, report, currentId, vision, strokeCounts, modelStatus]);\n\n  const downloadReport = () => {",
  ],
  [
    "<div className=\"debug-session-box\"><span>세션 코드</span><strong>{sessionCode}</strong><small>원본 영상 전송 꺼짐</small></div>",
    "<div className=\"debug-session-box\"><span>원격 로그 코드</span><strong>{remoteSessionCode || '연결 중'}</strong><small>{remoteLogStatus} · 영상 전송 없음</small></div>",
  ],
  [
    "            <EvidencePill ok={vision.handLandmarks?.length === 21 && vision.handConfidence >= 0.55} label=\"손 21관절\" value={`${vision.handLandmarks?.length || 0} · ${percent(vision.handConfidence)}`} />",
    "            <EvidencePill ok={vision.handLandmarks?.length === 21 && vision.handConfidence >= 0.45} label=\"손 추적\" value={`${vision.hands?.length || 0}손 · 선택 ${vision.handedness || '미정'} · ${percent(vision.handConfidence)}`} />",
  ],
  [
    "            <EvidencePill ok={vision.guitarConfidence >= 0.35} label=\"기타\" value={percent(vision.guitarConfidence)} />",
    "            <EvidencePill ok={vision.guitarConfidence >= 0.3} label=\"기타\" value={`${percent(vision.guitarConfidence)} · ${Math.round(vision.guitarAngle || 0)}°`} />",
  ],
  [
    "            <EvidencePill ok={vision.stringCount >= 4 && vision.stringConfidence >= 0.42} label=\"줄\" value={`${vision.stringCount}개 · ${percent(vision.stringConfidence)}`} />",
    "            <EvidencePill ok={vision.stringCount >= 4 && vision.stringConfidence >= 0.32} label=\"줄\" value={`${vision.stringCount}개 · ${percent(vision.stringConfidence)} · ${Math.round(vision.stringAngle || 0)}°`} />",
  ],
  [
    "          {(currentId === 'down' || currentId === 'up') ? <><div className=\"debug-count\">",
    "          <div className=\"debug-button-row\" style={{ flexWrap: 'wrap', marginTop: 12 }}><button className=\"debug-secondary\" onClick={() => { trackerRef.current.reset(); countsRef.current.down = 0; setStrokeCounts({ ...countsRef.current }); activate('down'); }}>다운 바로 점검</button><button className=\"debug-secondary\" onClick={() => { trackerRef.current.reset(); countsRef.current.up = 0; setStrokeCounts({ ...countsRef.current }); activate('up'); }}>업 바로 점검</button><button className=\"debug-secondary\" onClick={() => activate('strings')}>기타·줄 바로 점검</button></div>\n          {(currentId === 'down' || currentId === 'up') ? <><div className=\"debug-count\">",
  ],
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

function applyWebCompatibility() {
  return {
    name: 'guitar-coach-web-compatibility',
    enforce: 'pre',
    transform(source, id) {
      if (!id.endsWith('/src/DebugCenter.jsx')) return null;

      let transformed = source;
      for (const [before, after] of REPLACEMENTS) {
        if (!transformed.includes(before)) {
          throw new Error(`Web compatibility transform target is missing: ${before.slice(0, 120)}`);
        }
        transformed = transformed.replace(before, after);
      }

      return { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [applyWebCompatibility(), react()],
  base: '/guitar-coach-app/',
});
