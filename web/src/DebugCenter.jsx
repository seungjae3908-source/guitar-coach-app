import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import * as mobilenet from '@tensorflow-models/mobilenet';
import * as tf from '@tensorflow/tfjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import './debug-center.css';
import {
  DirectionalStrumTracker,
  canCountStrum,
  combinedGuitarConfidence,
  detectStringBand,
  guitarPredictionScore,
} from './vision-logic.js';

const TESTS = [
  { id: 'camera', title: '카메라 연결', instruction: '카메라를 허용하고 기타와 오른손이 화면에 보이도록 휴대폰을 세워 주세요.' },
  { id: 'feed', title: '실제 영상 확인', instruction: '렌즈를 가리지 말고 실제 영상이 보이는 상태를 3초간 유지해 주세요.' },
  { id: 'hand', title: '오른손 21관절', instruction: '오른손 전체와 손가락 끝이 잘리지 않게 화면에 3초간 보여 주세요.' },
  { id: 'guitar', title: '기타 인식', instruction: '기타 몸통과 브리지, 오른손이 함께 보이게 각도를 맞춰 주세요.' },
  { id: 'strings', title: '기타 줄 인식', instruction: '기타 줄 4개 이상이 선명하게 보이도록 브리지 쪽에 초점을 맞춰 주세요.' },
  { id: 'down', title: '다운 스트럼', instruction: '손·기타·줄 표시가 모두 초록색일 때 줄을 위에서 아래로 5번 가로질러 주세요.' },
  { id: 'up', title: '업 스트럼', instruction: '손·기타·줄 표시가 모두 초록색일 때 줄을 아래에서 위로 5번 가로질러 주세요.' },
  { id: 'voice', title: '음성 안내', instruction: '음성 테스트를 누르고 실제로 들리는지 선택해 주세요.' },
  { id: 'complete', title: '진단 완료', instruction: '모든 실제 인식 검사가 통과했습니다. 진단 결과를 저장할 수 있습니다.' },
];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const initialResults = Object.fromEntries(TESTS.map((test) => [test.id, { status: 'pending', note: '' }]));
const nowLabel = () => new Date().toLocaleTimeString('ko-KR', { hour12: false });
const makeCode = () => `${Math.random().toString(36).slice(2, 5)}-${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const percent = (value) => `${Math.round((Number(value) || 0) * 100)}%`;

async function digest(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function LoginGate({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const stored = localStorage.getItem('gc-debug-pin-hash');
  const setup = !stored;

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!/^\d{4,8}$/.test(pin)) return setError('숫자 4~8자리로 입력해 주세요.');
    const hashed = await digest(pin);
    if (setup) {
      if (pin !== confirmPin) return setError('두 비밀번호가 다릅니다.');
      localStorage.setItem('gc-debug-pin-hash', hashed);
    } else if (hashed !== stored) return setError('비밀번호가 맞지 않습니다.');
    sessionStorage.setItem('gc-debug-unlocked', '1');
    onUnlock();
  };

  return (
    <div className="debug-login-shell">
      <form className="debug-login-card" onSubmit={submit}>
        <div className="debug-logo">GC</div>
        <span className="debug-kicker">GUITAR COACH VISION TEST</span>
        <h1>{setup ? '진단센터 비밀번호 만들기' : '진단센터 로그인'}</h1>
        <p>영상은 기기 안에서 분석합니다. 원본 영상 전송은 기본적으로 꺼져 있습니다.</p>
        <label>비밀번호<input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password" autoFocus /></label>
        {setup ? <label>비밀번호 확인<input value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password" /></label> : null}
        {error ? <div className="debug-error">{error}</div> : null}
        <button className="debug-primary" type="submit">{setup ? '저장하고 시작' : '로그인'}</button>
      </form>
    </div>
  );
}

function StatusPill({ status }) {
  const labels = { pending: '대기', active: '검사 중', pass: '통과', fail: '판정 불가' };
  return <span className={`debug-pill ${status}`}>{labels[status] || status}</span>;
}

function EvidencePill({ ok, label, value }) {
  return <div className={`debug-feed-badge ${ok ? 'good' : 'bad'}`} style={{ position: 'static' }}>{label} {value}</div>;
}

function DeviceCenter() {
  const videoRef = useRef(null);
  const analysisCanvasRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const animationRef = useRef(0);
  const currentIdRef = useRef('camera');
  const lastFrameAtRef = useRef(0);
  const frameTimesRef = useRef([]);
  const previousGrayRef = useRef(null);
  const stableRef = useRef({ feed: 0, hand: 0, guitar: 0, strings: 0 });
  const modelRef = useRef({ loading: null, hand: null, guitar: null, error: '' });
  const handBusyRef = useRef(false);
  const guitarBusyRef = useRef(false);
  const lastGuitarRunRef = useRef(0);
  const visionRef = useRef({ handConfidence: 0, handLandmarks: [], pickPoint: null, guitarModelScore: 0, guitarLabel: '', guitarConfidence: 0, stringCount: 0, stringConfidence: 0, stringRows: [], stringBand: null });
  const trackerRef = useRef(new DirectionalStrumTracker());
  const countsRef = useRef({ down: 0, up: 0 });
  const [sessionCode] = useState(() => localStorage.getItem('gc-debug-session') || makeCode());
  const [running, setRunning] = useState(false);
  const [facing, setFacing] = useState('environment');
  const [results, setResults] = useState(initialResults);
  const [currentId, setCurrentId] = useState('camera');
  const [banner, setBanner] = useState('테스트 시작을 누르면 실제 AI 인식 결과로만 단계가 진행됩니다.');
  const [logs, setLogs] = useState([]);
  const [voiceResult, setVoiceResult] = useState('');
  const [modelStatus, setModelStatus] = useState({ hand: '대기', guitar: '대기', error: '' });
  const [stats, setStats] = useState({ fps: 0, brightness: 0, motion: 0, width: 0, height: 0, healthy: false });
  const [vision, setVision] = useState(visionRef.current);
  const [strokeCounts, setStrokeCounts] = useState({ down: 0, up: 0 });

  useEffect(() => { localStorage.setItem('gc-debug-session', sessionCode); }, [sessionCode]);
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);
  useEffect(() => () => stopCamera(), []);

  const addLog = (message, level = 'info') => setLogs((items) => [{ at: nowLabel(), message, level }, ...items].slice(0, 100));
  const updateResult = (id, status, note = '') => setResults((items) => ({ ...items, [id]: { status, note } }));

  const speak = (text) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.98;
    window.speechSynthesis.speak(utterance);
  };

  const activate = (id) => {
    const test = TESTS.find((item) => item.id === id);
    currentIdRef.current = id;
    setCurrentId(id);
    updateResult(id, 'active');
    if (test) {
      setBanner(test.instruction);
      speak(test.instruction);
    }
  };

  const passAndNext = (id, note) => {
    if (currentIdRef.current !== id) return;
    updateResult(id, 'pass', note);
    addLog(`${TESTS.find((test) => test.id === id)?.title} 통과 · ${note}`);
    const next = TESTS[TESTS.findIndex((test) => test.id === id) + 1];
    if (next) activate(next.id);
  };

  const ensureModels = async () => {
    if (modelRef.current.hand && modelRef.current.guitar) return;
    if (modelRef.current.loading) return modelRef.current.loading;
    modelRef.current.loading = (async () => {
      setModelStatus({ hand: '로딩 중', guitar: '로딩 중', error: '' });
      try {
        const visionFiles = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm');
        modelRef.current.hand = await HandLandmarker.createFromOptions(visionFiles, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO', numHands: 1,
          minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.5,
        });
        setModelStatus((status) => ({ ...status, hand: '준비 완료' }));
      } catch (error) {
        modelRef.current.error = `손 모델: ${error?.message || error}`;
        setModelStatus((status) => ({ ...status, hand: '실패', error: modelRef.current.error }));
      }
      try {
        await tf.setBackend('webgl').catch(() => tf.setBackend('cpu'));
        await tf.ready();
        modelRef.current.guitar = await mobilenet.load({ version: 2, alpha: 0.5 });
        setModelStatus((status) => ({ ...status, guitar: '준비 완료' }));
      } catch (error) {
        modelRef.current.error = `${modelRef.current.error} 기타 모델: ${error?.message || error}`.trim();
        setModelStatus((status) => ({ ...status, guitar: '실패', error: modelRef.current.error }));
      }
    })().finally(() => { modelRef.current.loading = null; });
    return modelRef.current.loading;
  };

  const drawOverlay = (landmarks, rows, width, height) => {
    const canvas = overlayRef.current;
    if (!canvas || !width || !height) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.lineWidth = Math.max(2, width / 420);
    context.strokeStyle = '#34d399';
    context.fillStyle = '#34d399';
    if (landmarks?.length === 21) {
      for (const [start, end] of HAND_CONNECTIONS) {
        context.beginPath();
        context.moveTo(landmarks[start].x * width, landmarks[start].y * height);
        context.lineTo(landmarks[end].x * width, landmarks[end].y * height);
        context.stroke();
      }
      for (const point of landmarks) {
        context.beginPath();
        context.arc(point.x * width, point.y * height, Math.max(3, width / 220), 0, Math.PI * 2);
        context.fill();
      }
    }
    context.strokeStyle = '#fbbf24';
    for (const row of rows || []) {
      context.beginPath();
      context.moveTo(width * 0.08, (row / 180) * height);
      context.lineTo(width * 0.92, (row / 180) * height);
      context.stroke();
    }
  };

  const processHand = (video, timestamp) => {
    const handModel = modelRef.current.hand;
    if (!handModel || handBusyRef.current || video.readyState < 2) return;
    handBusyRef.current = true;
    try {
      const result = handModel.detectForVideo(video, timestamp);
      const landmarks = result.landmarks?.[0] || [];
      const category = result.handednesses?.[0]?.[0];
      const confidence = landmarks.length === 21 ? Number(category?.score || 0.75) : 0;
      const pickPoint = landmarks.length === 21 ? {
        x: (landmarks[4].x + landmarks[8].x) / 2,
        y: (landmarks[4].y + landmarks[8].y) / 2,
      } : null;
      visionRef.current.handLandmarks = landmarks;
      visionRef.current.handConfidence = confidence;
      visionRef.current.pickPoint = pickPoint;
    } catch (error) {
      setModelStatus((status) => ({ ...status, hand: '실행 오류', error: String(error?.message || error) }));
    } finally {
      handBusyRef.current = false;
    }
  };

  const processGuitar = async (video, timestamp) => {
    const guitarModel = modelRef.current.guitar;
    if (!guitarModel || guitarBusyRef.current || timestamp - lastGuitarRunRef.current < 1300 || video.readyState < 2) return;
    guitarBusyRef.current = true;
    lastGuitarRunRef.current = timestamp;
    try {
      const predictions = await guitarModel.classify(video, 8);
      const score = guitarPredictionScore(predictions);
      const matched = predictions.find((prediction) => guitarPredictionScore([prediction]) > 0);
      visionRef.current.guitarModelScore = score;
      visionRef.current.guitarLabel = matched?.className || predictions[0]?.className || '';
    } catch (error) {
      setModelStatus((status) => ({ ...status, guitar: '실행 오류', error: String(error?.message || error) }));
    } finally {
      guitarBusyRef.current = false;
    }
  };

  const evaluateStage = (timestamp) => {
    const id = currentIdRef.current;
    const evidence = visionRef.current;
    if (id === 'hand') {
      stableRef.current.hand = evidence.handLandmarks.length === 21 && evidence.handConfidence >= 0.55 ? stableRef.current.hand + 1 : 0;
      if (stableRef.current.hand >= 18) passAndNext('hand', `21관절 연속 검출 · 신뢰도 ${percent(evidence.handConfidence)}`);
    } else if (id === 'guitar') {
      stableRef.current.guitar = evidence.guitarConfidence >= 0.35 ? stableRef.current.guitar + 1 : 0;
      if (stableRef.current.guitar >= 14) passAndNext('guitar', `기타 증거 신뢰도 ${percent(evidence.guitarConfidence)}`);
    } else if (id === 'strings') {
      stableRef.current.strings = evidence.stringCount >= 4 && evidence.stringConfidence >= 0.42 ? stableRef.current.strings + 1 : 0;
      if (stableRef.current.strings >= 14) passAndNext('strings', `${evidence.stringCount}개 평행 줄 · 신뢰도 ${percent(evidence.stringConfidence)}`);
    }

    if (id === 'down' || id === 'up') {
      const ready = canCountStrum(evidence);
      const direction = trackerRef.current.sample({ timestamp, pointY: evidence.pickPoint?.y, band: evidence.stringBand, ready });
      if (direction === id) {
        countsRef.current[id] += 1;
        const nextCounts = { ...countsRef.current };
        setStrokeCounts(nextCounts);
        addLog(`${id === 'down' ? '다운' : '업'} 방향 실제 교차 ${nextCounts[id]}/5`);
        if (nextCounts[id] >= 5) passAndNext(id, `${id === 'down' ? '위→아래' : '아래→위'} 줄 영역 교차 5회`);
      }
      if (!ready) updateResult(id, 'active', '손·기타·줄이 모두 인식될 때만 카운트합니다.');
    }
  };

  const sampleFrame = (timestamp) => {
    const video = videoRef.current;
    const canvas = analysisCanvasRef.current;
    if (!video || !canvas || !streamRef.current) return;
    frameTimesRef.current.push(timestamp);
    frameTimesRef.current = frameTimesRef.current.filter((time) => timestamp - time <= 1000);

    if (timestamp - lastFrameAtRef.current >= 100 && video.readyState >= 2) {
      lastFrameAtRef.current = timestamp;
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(video, 0, 0, 320, 180);
      const imageData = context.getImageData(0, 0, 320, 180);
      let total = 0;
      let motionTotal = 0;
      const gray = new Uint8Array(320 * 180);
      for (let pixel = 0, index = 0; pixel < imageData.data.length; pixel += 4, index += 1) {
        const value = Math.round(imageData.data[pixel] * 0.299 + imageData.data[pixel + 1] * 0.587 + imageData.data[pixel + 2] * 0.114);
        gray[index] = value;
        total += value;
        if (previousGrayRef.current) motionTotal += Math.abs(value - previousGrayRef.current[index]);
      }
      previousGrayRef.current = gray;
      const brightness = total / gray.length;
      const motion = motionTotal / gray.length;
      const stringResult = detectStringBand(imageData, 320, 180);
      visionRef.current.stringCount = stringResult.count;
      visionRef.current.stringConfidence = stringResult.confidence;
      visionRef.current.stringRows = stringResult.rows;
      visionRef.current.stringBand = stringResult.band;
      visionRef.current.guitarConfidence = combinedGuitarConfidence({
        modelScore: visionRef.current.guitarModelScore,
        stringConfidence: stringResult.confidence,
        stringCount: stringResult.count,
        handConfidence: visionRef.current.handConfidence,
      });
      const nextStats = {
        fps: frameTimesRef.current.length,
        brightness,
        motion,
        width: video.videoWidth,
        height: video.videoHeight,
        healthy: brightness >= 10 && video.videoWidth > 0,
      };
      setStats(nextStats);
      setVision({ ...visionRef.current });
      processHand(video, timestamp);
      void processGuitar(video, timestamp);
      drawOverlay(visionRef.current.handLandmarks, stringResult.rows, video.videoWidth, video.videoHeight);

      if (currentIdRef.current === 'camera' && video.videoWidth > 0) passAndNext('camera', `${video.videoWidth}×${video.videoHeight}`);
      if (currentIdRef.current === 'feed') {
        stableRef.current.feed = nextStats.healthy ? stableRef.current.feed + 1 : 0;
        if (stableRef.current.feed >= 20) passAndNext('feed', `실제 프레임 밝기 ${brightness.toFixed(1)} · ${nextStats.fps} FPS`);
      }
      evaluateStage(timestamp);
    }
    animationRef.current = requestAnimationFrame(sampleFrame);
  };

  function stopCamera() {
    cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    previousGrayRef.current = null;
    frameTimesRef.current = [];
    const context = overlayRef.current?.getContext('2d');
    if (context && overlayRef.current) context.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
  }

  const startCamera = async (requestedFacing = facing) => {
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: requestedFacing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      addLog(`카메라 시작 · ${requestedFacing === 'environment' ? '후면' : '전면'}`);
      animationRef.current = requestAnimationFrame(sampleFrame);
    } catch (error) {
      updateResult('camera', 'fail', error?.message || '카메라 권한 실패');
      setBanner('카메라 권한이 차단됐습니다. 주소창의 카메라 권한을 허용해 주세요.');
      addLog(`카메라 오류 · ${error?.message || error}`, 'error');
    }
  };

  const begin = async () => {
    stopCamera();
    trackerRef.current.reset();
    countsRef.current = { down: 0, up: 0 };
    stableRef.current = { feed: 0, hand: 0, guitar: 0, strings: 0 };
    visionRef.current = { handConfidence: 0, handLandmarks: [], pickPoint: null, guitarModelScore: 0, guitarLabel: '', guitarConfidence: 0, stringCount: 0, stringConfidence: 0, stringRows: [], stringBand: null };
    setStrokeCounts({ down: 0, up: 0 });
    setResults({ ...initialResults, camera: { status: 'active', note: '' } });
    setCurrentId('camera');
    currentIdRef.current = 'camera';
    setRunning(true);
    setLogs([]);
    setVoiceResult('');
    setBanner(TESTS[0].instruction);
    speak(TESTS[0].instruction);
    void ensureModels();
    await startCamera();
  };

  const switchFacing = async () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    trackerRef.current.reset();
    await startCamera(next);
  };

  const testVoice = () => {
    if (!('speechSynthesis' in window)) {
      setVoiceResult('브라우저에서 음성을 지원하지 않음');
      updateResult('voice', 'fail', '음성 합성 미지원');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance('음성 테스트입니다. 이 문장이 들리면 들림 버튼을 눌러 주세요.');
    utterance.lang = 'ko-KR';
    utterance.onend = () => setVoiceResult('재생 완료');
    utterance.onerror = () => { setVoiceResult('재생 실패'); updateResult('voice', 'fail', '음성 재생 실패'); };
    window.speechSynthesis.speak(utterance);
  };

  const confirmVoice = (heard) => {
    if (currentIdRef.current !== 'voice') return;
    if (heard) passAndNext('voice', '사용자가 실제 들림 확인');
    else {
      updateResult('voice', 'fail', '소리가 들리지 않음');
      setBanner('미디어 음량과 무음 모드를 확인한 뒤 음성 테스트를 다시 눌러 주세요.');
    }
  };

  const report = useMemo(() => ({
    version: 2, sessionCode, createdAt: new Date().toISOString(), userAgent: navigator.userAgent,
    stats, modelStatus, vision: {
      handLandmarks: vision.handLandmarks?.length || 0,
      handConfidence: vision.handConfidence,
      guitarModelScore: vision.guitarModelScore,
      guitarLabel: vision.guitarLabel,
      guitarConfidence: vision.guitarConfidence,
      stringCount: vision.stringCount,
      stringConfidence: vision.stringConfidence,
    }, strokeCounts, results, logs,
  }), [sessionCode, stats, modelStatus, vision, strokeCounts, results, logs]);

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `guitar-coach-diagnostic-${sessionCode}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const completed = Object.values(results).filter((item) => item.status === 'pass').length;
  const current = TESTS.find((test) => test.id === currentId);
  const evidenceReady = canCountStrum(vision);

  return (
    <div className="debug-shell">
      <header className="debug-header">
        <div><span className="debug-kicker">REAL VISION TEST SESSION</span><h1>기타 코치 실시간 진단센터</h1><p>단순 움직임이 아니라 손 관절·기타·줄·방향 증거가 모두 있을 때만 통과합니다.</p></div>
        <div className="debug-session-box"><span>세션 코드</span><strong>{sessionCode}</strong><small>원본 영상 전송 꺼짐</small></div>
      </header>
      <div className="debug-progress"><span style={{ width: `${(completed / TESTS.length) * 100}%` }} /></div>

      <main className="debug-grid">
        <section className="debug-camera-card">
          <div className="debug-video-wrap">
            <video ref={videoRef} playsInline muted />
            <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
            {!streamRef.current ? <div className="debug-video-empty">카메라 대기</div> : null}
          </div>
          <canvas ref={analysisCanvasRef} hidden />
          <div className="debug-metrics">
            <div><span>FPS</span><strong>{stats.fps || '-'}</strong></div><div><span>해상도</span><strong>{stats.width ? `${stats.width}×${stats.height}` : '-'}</strong></div>
            <div><span>밝기</span><strong>{stats.brightness.toFixed(1)}</strong></div><div><span>전체 움직임</span><strong>{stats.motion.toFixed(1)}<small style={{ display: 'block' }}>판정 미사용</small></strong></div>
          </div>
          <div className="debug-button-row"><button className="debug-primary" onClick={() => void begin()}>{running ? '처음부터 다시 검사' : '테스트 시작'}</button><button className="debug-secondary" onClick={() => void switchFacing()} disabled={!running}>전후면 전환</button></div>
        </section>

        <section className="debug-instruction-card">
          <span className="debug-kicker">현재 지시</span><h2>{current?.title}</h2><p className="debug-instruction">{banner}</p>
          <div className="debug-button-row" style={{ flexWrap: 'wrap' }}>
            <EvidencePill ok={vision.handLandmarks?.length === 21 && vision.handConfidence >= 0.55} label="손 21관절" value={`${vision.handLandmarks?.length || 0} · ${percent(vision.handConfidence)}`} />
            <EvidencePill ok={vision.guitarConfidence >= 0.35} label="기타" value={percent(vision.guitarConfidence)} />
            <EvidencePill ok={vision.stringCount >= 4 && vision.stringConfidence >= 0.42} label="줄" value={`${vision.stringCount}개 · ${percent(vision.stringConfidence)}`} />
          </div>
          {(currentId === 'down' || currentId === 'up') ? <><div className="debug-count">{strokeCounts[currentId]}<span>/ 5회</span></div><div className={evidenceReady ? 'debug-voice-result' : 'debug-error'}>{evidenceReady ? '방향 감지 준비 완료' : '손·기타·줄 증거가 부족해 카운트를 잠갔습니다.'}</div></> : null}
          {currentId === 'voice' ? <><button className="debug-primary debug-wide" onClick={testVoice}>음성 테스트</button><div className="debug-voice-result">{voiceResult || '아직 재생하지 않음'}</div><div className="debug-button-row"><button className="debug-primary" onClick={() => confirmVoice(true)}>들림</button><button className="debug-danger" onClick={() => confirmVoice(false)}>안 들림</button></div></> : null}
          {currentId === 'complete' ? <button className="debug-primary debug-wide" onClick={downloadReport}>검증 결과 저장</button> : null}
          <div className="debug-thresholds">
            <div><strong>손 모델</strong> {modelStatus.hand}</div><div><strong>기타 모델</strong> {modelStatus.guitar}</div>
            {vision.guitarLabel ? <div><strong>분류 후보</strong> {vision.guitarLabel} · {percent(vision.guitarModelScore)}</div> : null}
            {modelStatus.error ? <div className="debug-error">{modelStatus.error}</div> : null}
          </div>
        </section>

        <section className="debug-checklist-card">
          <div className="debug-card-title"><div><span className="debug-kicker">EVIDENCE GATED</span><h2>실제 인식 검사</h2></div><strong>{completed}/{TESTS.length}</strong></div>
          <div className="debug-test-list">{TESTS.map((test) => <div key={test.id} className={currentId === test.id ? 'active' : ''} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12 }}><div><strong>{test.title}</strong><small style={{ display: 'block' }}>{results[test.id]?.note || test.instruction}</small></div><StatusPill status={results[test.id]?.status || 'pending'} /></div>)}</div>
        </section>

        <section className="debug-log-card">
          <div className="debug-card-title"><div><span className="debug-kicker">LIVE LOG</span><h2>진단 기록</h2></div><button onClick={downloadReport}>JSON 저장</button></div>
          <div className="debug-log-list">{logs.length ? logs.map((log, index) => <div key={`${log.at}-${index}`} className={log.level}><time>{log.at}</time><span>{log.message}</span></div>) : <p>아직 기록이 없습니다.</p>}</div>
        </section>
      </main>
    </div>
  );
}

function AdminCenter() {
  return <div className="debug-shell admin"><header className="debug-header"><div><span className="debug-kicker">REMOTE CONSOLE</span><h1>원격 진단 관리자</h1><p>현재 휴대폰 진단은 기기 내 실제 AI 모델로 판정합니다. 서버 세션 연결 기능은 인증된 세션만 표시합니다.</p></div></header><main className="debug-admin-grid"><section className="debug-instruction-card"><h2>보안 세션 대기</h2><p className="debug-instruction">관리자 토큰과 기기 토큰이 발급된 세션만 연결할 수 있습니다. 인증되지 않은 수동 상태 변경은 허용하지 않습니다.</p></section></main></div>;
}

export default function DebugCenter() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('gc-debug-unlocked') === '1');
  if (!unlocked) return <LoginGate onUnlock={() => setUnlocked(true)} />;
  return new URLSearchParams(window.location.search).get('admin') === '1' ? <AdminCenter /> : <DeviceCenter />;
}
