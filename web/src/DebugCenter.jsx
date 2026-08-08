import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import * as mobilenet from '@tensorflow-models/mobilenet';
import * as tf from '@tensorflow/tfjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sendLiveDiagnostics } from './live-telemetry.js';
import './debug-center.css';
import {
  HandRoleResolver,
  canCountStrum,
  combinedGuitarConfidence,
  detectStringBand,
  guitarPredictionScore,
  projectPointToBand,
} from './vision-logic.js';

const TESTS = [
  { id: 'camera', title: '전면카메라 연결', instruction: '전면카메라를 허용하세요. 기타는 중앙에 맞출 필요가 없고 화면 아래나 사선이어도 됩니다.' },
  { id: 'feed', title: '실제 영상 확인', instruction: '렌즈를 가리지 말고 실제 영상이 보이는 상태를 잠시 유지하세요.' },
  { id: 'hand', title: '양손 관절 인식', instruction: '왼손과 오른손을 동시에 추적합니다. 한 손만 보여도 검사는 진행되고 두 손이 보이면 둘 다 표시됩니다.' },
  { id: 'guitar', title: '기타 인식', instruction: '기타 몸통 일부와 실제 줄, 연주 손이 함께 보이면 됩니다. 위치를 억지로 중앙에 맞추지 마세요.' },
  { id: 'strings', title: '사선 기타 줄 인식', instruction: '수평뿐 아니라 기울어진 줄을 실제로 보이는 구간 안에서만 찾습니다.' },
  { id: 'down', title: '다운 스트럼', instruction: '평소 자세 그대로 다운 스트럼을 하세요. 실제 줄 영역을 위에서 아래로 통과한 오른손만 계산합니다.' },
  { id: 'up', title: '업 스트럼', instruction: '평소 자세 그대로 업 스트럼을 하세요. 실제 줄 영역을 아래에서 위로 통과한 오른손만 계산합니다.' },
  { id: 'voice', title: '음성 안내', instruction: '음성 테스트를 눌러 안내가 들리는지 확인하세요.' },
  { id: 'complete', title: '진단 완료', instruction: '검사가 끝났습니다. 원격 로그와 JSON 결과를 확인할 수 있습니다.' },
];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const emptyVision = () => ({
  hands: [],
  selectedTrackId: null,
  selectedHandedness: '미선택',
  strumHandSelected: false,
  handConfidence: 0,
  handLandmarks: [],
  pickPoint: null,
  guitarModelScore: 0,
  guitarLabel: '',
  guitarConfidence: 0,
  guitarAngle: 0,
  guitarCenter: null,
  stringCount: 0,
  stringConfidence: 0,
  stringRows: [],
  stringLines: [],
  stringAngle: 0,
  stringBand: null,
  lastDirection: 'none',
  lockReason: '카메라 시작 전',
});

const initialResults = () => Object.fromEntries(TESTS.map((test) => [test.id, { status: 'pending', note: '' }]));
const nowLabel = () => new Date().toLocaleTimeString('ko-KR', { hour12: false });
const percent = (value) => `${Math.round((Number(value) || 0) * 100)}%`;

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
  const lastHandFrameRef = useRef(0);
  const lastImageFrameRef = useRef(0);
  const lastUiFrameRef = useRef(0);
  const frameTimesRef = useRef([]);
  const previousGrayRef = useRef(null);
  const stableRef = useRef({ feed: 0, hand: 0, guitar: 0, strings: 0 });
  const modelRef = useRef({ loading: null, hand: null, guitar: null, error: '' });
  const guitarBusyRef = useRef(false);
  const lastGuitarRunRef = useRef(0);
  const visionRef = useRef(emptyVision());
  const handRoleRef = useRef(new HandRoleResolver());
  const countsRef = useRef({ down: 0, up: 0 });
  const summaryRef = useRef({ maxHands: 0, maxGuitarConfidence: 0, maxStrings: 0, maxStringConfidence: 0, firstStrokeAt: 0, lastStrokeAt: 0 });
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(initialResults);
  const [currentId, setCurrentId] = useState('camera');
  const [banner, setBanner] = useState('테스트 시작을 누르면 전면카메라에서 실제 인식 결과로 단계가 진행됩니다.');
  const [logs, setLogs] = useState([]);
  const [voiceResult, setVoiceResult] = useState('');
  const [modelStatus, setModelStatus] = useState({ hand: '대기', guitar: '대기', error: '' });
  const [stats, setStats] = useState({ fps: 0, brightness: 0, motion: 0, width: 0, height: 0, healthy: false });
  const [vision, setVision] = useState(visionRef.current);
  const [strokeCounts, setStrokeCounts] = useState({ down: 0, up: 0 });
  const [remoteSessionCode, setRemoteSessionCode] = useState('');
  const [remoteLogStatus, setRemoteLogStatus] = useState('테스트 시작 후 연결');

  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);
  useEffect(() => () => stopCamera(), []);

  const addLog = (message, level = 'info') => setLogs((items) => [{ at: nowLabel(), message, level }, ...items].slice(0, 160));
  const updateResult = (id, status, note = '') => setResults((items) => ({ ...items, [id]: { status, note } }));

  const speak = (text) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.98;
    window.speechSynthesis.speak(utterance);
  };

  const activate = (id, { speakInstruction = true } = {}) => {
    const test = TESTS.find((item) => item.id === id);
    currentIdRef.current = id;
    setCurrentId(id);
    updateResult(id, 'active');
    if (test) {
      setBanner(test.instruction);
      if (speakInstruction) speak(test.instruction);
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
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.42,
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

  const drawOverlay = (hands, lines, width, height) => {
    const canvas = overlayRef.current;
    if (!canvas || !width || !height) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.lineWidth = Math.max(2, width / 420);

    for (const hand of hands || []) {
      const landmarks = hand?.landmarks || [];
      if (landmarks.length !== 21) continue;
      const selected = Boolean(hand.isStrumming);
      context.strokeStyle = selected ? '#f472b6' : '#34d399';
      context.fillStyle = selected ? '#f472b6' : '#34d399';
      for (const [start, end] of HAND_CONNECTIONS) {
        context.beginPath();
        context.moveTo(landmarks[start].x * width, landmarks[start].y * height);
        context.lineTo(landmarks[end].x * width, landmarks[end].y * height);
        context.stroke();
      }
      for (const point of landmarks) {
        context.beginPath();
        context.arc(point.x * width, point.y * height, Math.max(3, width / 230), 0, Math.PI * 2);
        context.fill();
      }
      if (selected && hand.pickPoint) {
        context.beginPath();
        context.lineWidth = Math.max(4, width / 260);
        context.arc(hand.pickPoint.x * width, hand.pickPoint.y * height, Math.max(8, width / 90), 0, Math.PI * 2);
        context.stroke();
      }
    }

    context.strokeStyle = '#fbbf24';
    context.lineWidth = Math.max(2, width / 360);
    for (const line of lines || []) {
      context.beginPath();
      context.moveTo(line.start.x * width, line.start.y * height);
      context.lineTo(line.end.x * width, line.end.y * height);
      context.stroke();
    }
  };

  const processGuitar = async (video, timestamp) => {
    const guitarModel = modelRef.current.guitar;
    if (!guitarModel || guitarBusyRef.current || timestamp - lastGuitarRunRef.current < 1200 || video.readyState < 2) return;
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

  const reasonForLock = (evidence) => {
    const reasons = [];
    if (!(evidence.hands?.length > 0)) reasons.push('손 없음');
    if (evidence.guitarConfidence < 0.3) reasons.push(`기타 ${percent(evidence.guitarConfidence)}`);
    if (evidence.stringCount < 4) reasons.push(`줄 ${evidence.stringCount}개`);
    if (evidence.stringConfidence < 0.32) reasons.push(`줄 신뢰도 ${percent(evidence.stringConfidence)}`);
    if ((evidence.stringBand?.supportLength || 0) < 0.2) reasons.push('실제 줄 구간 부족');
    if (!evidence.strumHandSelected) reasons.push('스트럼 손 미선택');
    return reasons.join(' · ') || '준비 완료';
  };

  const evaluateStage = (timestamp, roleEvent = null) => {
    const id = currentIdRef.current;
    const evidence = visionRef.current;
    if (id === 'hand') {
      const bestConfidence = Math.max(0, ...(evidence.hands || []).map((hand) => Number(hand.confidence || 0)));
      stableRef.current.hand = evidence.hands?.length >= 1 && bestConfidence >= 0.45 ? stableRef.current.hand + 1 : 0;
      if (stableRef.current.hand >= 12) passAndNext('hand', `${evidence.hands.length}손 관절 추적 · 최고 신뢰도 ${percent(bestConfidence)}`);
    } else if (id === 'guitar') {
      stableRef.current.guitar = evidence.guitarConfidence >= 0.3 ? stableRef.current.guitar + 1 : 0;
      if (stableRef.current.guitar >= 9) passAndNext('guitar', `기타·줄 결합 신뢰도 ${percent(evidence.guitarConfidence)}`);
    } else if (id === 'strings') {
      const localized = Number(evidence.stringBand?.supportLength || 0) >= 0.2;
      stableRef.current.strings = evidence.stringCount >= 4 && evidence.stringConfidence >= 0.32 && localized ? stableRef.current.strings + 1 : 0;
      if (stableRef.current.strings >= 9) passAndNext('strings', `${evidence.stringCount}개 줄 · ${evidence.stringAngle > 0 ? '+' : ''}${evidence.stringAngle}° · 실제 구간 ${Math.round((evidence.stringBand?.supportLength || 0) * 100)}%`);
    }

    if (id === 'down' || id === 'up') {
      const ready = canCountStrum(evidence);
      if (roleEvent && ready) {
        if (!summaryRef.current.firstStrokeAt) summaryRef.current.firstStrokeAt = Date.now();
        summaryRef.current.lastStrokeAt = Date.now();
        if (roleEvent === id) {
          countsRef.current[id] += 1;
          const nextCounts = { ...countsRef.current };
          setStrokeCounts(nextCounts);
          addLog(`${id === 'down' ? '다운' : '업'} 실제 교차 ${nextCounts[id]}/5 · 선택 손 ${evidence.selectedHandedness}`);
          if (nextCounts[id] >= 5) passAndNext(id, `${id === 'down' ? '위→아래' : '아래→위'} 실제 줄 구간 교차 5회`);
        } else {
          addLog(`${id === 'down' ? '다운' : '업'} 점검 중 반대 방향 ${roleEvent === 'down' ? '다운' : '업'} 감지`, 'warn');
        }
      }
      evidence.lockReason = ready ? '방향 감지 준비 완료' : reasonForLock(evidence);
      if (!ready) updateResult(id, 'active', evidence.lockReason);
    }
  };

  const processHands = (video, timestamp) => {
    const handModel = modelRef.current.hand;
    if (!handModel || video.readyState < 2) return;
    try {
      const result = handModel.detectForVideo(video, timestamp);
      const rawHands = (result.landmarks || []).slice(0, 2).map((landmarks, index) => {
        const category = result.handednesses?.[index]?.[0];
        const confidence = landmarks.length === 21 ? Number(category?.score || 0.75) : 0;
        const fingertips = [4, 8, 12, 16, 20].map((pointIndex) => landmarks[pointIndex]).filter(Boolean);
        const pickPoint = fingertips.length ? {
          x: fingertips.reduce((sum, point) => sum + point.x, 0) / fingertips.length,
          y: fingertips.reduce((sum, point) => sum + point.y, 0) / fingertips.length,
        } : null;
        return {
          handedness: category?.categoryName || category?.displayName || 'Unknown',
          confidence,
          landmarks,
          wrist: landmarks[0] || null,
          pickPoint,
        };
      });

      const role = handRoleRef.current.update({
        timestamp,
        hands: rawHands,
        band: visionRef.current.stringBand,
        ready: visionRef.current.stringCount >= 4 && visionRef.current.stringConfidence >= 0.28,
      });
      const selected = role.selectedHand;
      const fallback = [...role.hands].sort((left, right) => {
        const leftProjection = projectPointToBand(left.pickPoint, visionRef.current.stringBand);
        const rightProjection = projectPointToBand(right.pickPoint, visionRef.current.stringBand);
        const center = Number(visionRef.current.stringBand?.center || 0.5);
        return Math.abs((leftProjection ?? 99) - center) - Math.abs((rightProjection ?? 99) - center);
      })[0] || null;
      const activeHand = selected || fallback;
      const bestHandConfidence = Math.max(0, ...role.hands.map((hand) => Number(hand.confidence || 0)));

      visionRef.current.hands = role.hands;
      visionRef.current.selectedTrackId = role.selectedId;
      visionRef.current.selectedHandedness = selected?.handedness || '자동 선택 중';
      visionRef.current.strumHandSelected = Boolean(selected);
      visionRef.current.handLandmarks = activeHand?.landmarks || [];
      visionRef.current.handConfidence = activeHand?.confidence || bestHandConfidence;
      visionRef.current.pickPoint = activeHand?.pickPoint || null;
      visionRef.current.lastDirection = role.event || visionRef.current.lastDirection || 'none';
      summaryRef.current.maxHands = Math.max(summaryRef.current.maxHands, role.hands.length);
      evaluateStage(timestamp, role.event);
    } catch (error) {
      setModelStatus((status) => ({ ...status, hand: '실행 오류', error: String(error?.message || error) }));
    }
  };

  const analyzeImage = (video, timestamp) => {
    const canvas = analysisCanvasRef.current;
    if (!canvas || video.readyState < 2) return;
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
    const handPoint = visionRef.current.pickPoint;
    const handConfidence = Math.max(visionRef.current.handConfidence, ...visionRef.current.hands.map((hand) => Number(hand.confidence || 0)), 0);

    visionRef.current.stringCount = stringResult.count;
    visionRef.current.stringConfidence = stringResult.confidence;
    visionRef.current.stringRows = stringResult.rows;
    visionRef.current.stringLines = stringResult.lines || [];
    visionRef.current.stringAngle = stringResult.angle || 0;
    visionRef.current.stringBand = stringResult.band;
    visionRef.current.guitarAngle = stringResult.angle || 0;
    const linePoints = (stringResult.lines || []).flatMap((line) => [line.start, line.end]);
    visionRef.current.guitarCenter = linePoints.length ? {
      x: linePoints.reduce((sum, point) => sum + point.x, 0) / linePoints.length,
      y: linePoints.reduce((sum, point) => sum + point.y, 0) / linePoints.length,
    } : null;
    visionRef.current.guitarConfidence = combinedGuitarConfidence({
      modelScore: visionRef.current.guitarModelScore,
      stringConfidence: stringResult.confidence,
      stringCount: stringResult.count,
      handConfidence,
      handPoint,
      band: stringResult.band,
    });
    visionRef.current.lockReason = reasonForLock(visionRef.current);

    summaryRef.current.maxGuitarConfidence = Math.max(summaryRef.current.maxGuitarConfidence, visionRef.current.guitarConfidence);
    summaryRef.current.maxStrings = Math.max(summaryRef.current.maxStrings, stringResult.count);
    summaryRef.current.maxStringConfidence = Math.max(summaryRef.current.maxStringConfidence, stringResult.confidence);

    frameTimesRef.current.push(timestamp);
    frameTimesRef.current = frameTimesRef.current.filter((time) => timestamp - time <= 1000);
    const nextStats = {
      fps: frameTimesRef.current.length,
      brightness,
      motion,
      width: video.videoWidth,
      height: video.videoHeight,
      healthy: brightness >= 10 && video.videoWidth > 0,
    };
    setStats(nextStats);
    void processGuitar(video, timestamp);

    if (currentIdRef.current === 'camera' && video.videoWidth > 0) passAndNext('camera', `${video.videoWidth}×${video.videoHeight}`);
    if (currentIdRef.current === 'feed') {
      stableRef.current.feed = nextStats.healthy ? stableRef.current.feed + 1 : 0;
      if (stableRef.current.feed >= 8) passAndNext('feed', `밝기 ${brightness.toFixed(1)} · 분석 ${nextStats.fps} FPS`);
    }
  };

  const sampleFrame = (timestamp) => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    if (timestamp - lastHandFrameRef.current >= 50) {
      lastHandFrameRef.current = timestamp;
      processHands(video, timestamp);
    }
    if (timestamp - lastImageFrameRef.current >= 220) {
      lastImageFrameRef.current = timestamp;
      analyzeImage(video, timestamp);
    }
    if (timestamp - lastUiFrameRef.current >= 100) {
      lastUiFrameRef.current = timestamp;
      drawOverlay(visionRef.current.hands, visionRef.current.stringLines, video.videoWidth, video.videoHeight);
      setVision({ ...visionRef.current, hands: [...visionRef.current.hands], stringLines: [...visionRef.current.stringLines] });
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

  const startCamera = async () => {
    stopCamera();
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { exact: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        });
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      addLog('카메라 시작 · 전면 웹 고정');
      animationRef.current = requestAnimationFrame(sampleFrame);
    } catch (error) {
      updateResult('camera', 'fail', error?.message || '카메라 권한 실패');
      setBanner('카메라 권한이 차단됐습니다. 주소창의 카메라 권한을 허용하세요.');
      addLog(`카메라 오류 · ${error?.message || error}`, 'error');
    }
  };

  const begin = async () => {
    stopCamera();
    handRoleRef.current.reset();
    countsRef.current = { down: 0, up: 0 };
    stableRef.current = { feed: 0, hand: 0, guitar: 0, strings: 0 };
    summaryRef.current = { maxHands: 0, maxGuitarConfidence: 0, maxStrings: 0, maxStringConfidence: 0, firstStrokeAt: 0, lastStrokeAt: 0 };
    visionRef.current = emptyVision();
    setStrokeCounts({ down: 0, up: 0 });
    setResults({ ...initialResults(), camera: { status: 'active', note: '' } });
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

  const jumpToStroke = (direction) => {
    if (!running) return;
    handRoleRef.current.reset();
    countsRef.current[direction] = 0;
    setStrokeCounts({ ...countsRef.current });
    updateResult(direction, 'active', '스트럼 손 자동 선택 중');
    activate(direction);
    addLog(`${direction === 'down' ? '다운' : '업'} 스트럼 바로 점검 시작`);
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
      setBanner('미디어 음량과 무음 모드를 확인한 뒤 다시 테스트하세요.');
    }
  };

  const report = useMemo(() => ({
    version: 3,
    createdAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    stats,
    modelStatus,
    currentVision: vision,
    observedSummary: summaryRef.current,
    strokeCounts,
    results,
    logs,
  }), [stats, modelStatus, vision, strokeCounts, results, logs]);

  useEffect(() => {
    if (!running) return;
    void sendLiveDiagnostics({
      report,
      currentTest: currentId,
      vision,
      strokeCounts,
      modelStatus,
      evidenceReady: canCountStrum(vision),
      lastDirection: vision.lastDirection || 'none',
    }).then((session) => {
      if (!session) return;
      setRemoteSessionCode(session.code);
      setRemoteLogStatus('실시간 연결됨');
    }).catch((error) => {
      setRemoteLogStatus(`연결 오류: ${error?.message || error}`);
    });
  }, [running, report, currentId, vision, strokeCounts, modelStatus]);

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `guitar-coach-diagnostic-${remoteSessionCode || 'local'}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const completed = Object.values(results).filter((item) => item.status === 'pass').length;
  const current = TESTS.find((test) => test.id === currentId);
  const evidenceReady = canCountStrum(vision);

  return (
    <div className="debug-shell">
      <header className="debug-header">
        <div>
          <span className="debug-kicker">FRONT CAMERA · LOCALIZED STRINGS · LIVE LOG</span>
          <h1>기타 코치 실시간 진단센터</h1>
          <p>기타를 중앙에 맞추지 않아도 됩니다. 실제로 보이는 줄 구간과 스트럼 손의 교차만 계산합니다.</p>
        </div>
        <div className="debug-session-box">
          <span>원격 로그 코드</span>
          <strong>{remoteSessionCode || '연결 중'}</strong>
          <small>{remoteLogStatus} · 영상 전송 없음</small>
        </div>
      </header>
      <div className="debug-progress"><span style={{ width: `${(completed / TESTS.length) * 100}%` }} /></div>

      <main className="debug-grid">
        <section className="debug-camera-card">
          <div className="debug-video-wrap">
            <video ref={videoRef} playsInline muted style={{ transform: 'scaleX(-1)' }} />
            <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', transform: 'scaleX(-1)' }} />
            {!running ? <div className="debug-video-empty">전면카메라 대기</div> : null}
          </div>
          <canvas ref={analysisCanvasRef} hidden />
          <div className="debug-metrics">
            <div><span>카메라</span><strong>전면 고정</strong></div>
            <div><span>해상도</span><strong>{stats.width ? `${stats.width}×${stats.height}` : '-'}</strong></div>
            <div><span>분석 FPS</span><strong>{stats.fps || '-'}</strong></div>
            <div><span>줄 각도</span><strong>{vision.stringAngle > 0 ? '+' : ''}{vision.stringAngle || 0}°</strong></div>
          </div>
          <div className="debug-button-row" style={{ flexWrap: 'wrap' }}>
            <button className="debug-primary" onClick={() => void begin()}>{running ? '처음부터 다시 검사' : '테스트 시작'}</button>
            <button className="debug-secondary" disabled>전면카메라 고정</button>
            <button className="debug-secondary" onClick={() => jumpToStroke('down')} disabled={!running}>다운 바로 점검</button>
            <button className="debug-secondary" onClick={() => jumpToStroke('up')} disabled={!running}>업 바로 점검</button>
          </div>
        </section>

        <section className="debug-instruction-card">
          <span className="debug-kicker">현재 지시</span>
          <h2>{current?.title}</h2>
          <p className="debug-instruction">{banner}</p>
          <div className="debug-button-row" style={{ flexWrap: 'wrap' }}>
            <EvidencePill ok={vision.hands?.length >= 1} label="손" value={`${vision.hands?.length || 0}개`} />
            <EvidencePill ok={vision.strumHandSelected} label="스트럼 손" value={vision.selectedHandedness} />
            <EvidencePill ok={vision.guitarConfidence >= 0.3} label="기타" value={percent(vision.guitarConfidence)} />
            <EvidencePill ok={vision.stringCount >= 4 && vision.stringConfidence >= 0.32} label="실제 줄" value={`${vision.stringCount}개 · ${percent(vision.stringConfidence)}`} />
          </div>
          {(currentId === 'down' || currentId === 'up') ? (
            <>
              <div className="debug-count">{strokeCounts[currentId]}<span>/ 5회</span></div>
              <div className={evidenceReady ? 'debug-voice-result' : 'debug-error'}>{evidenceReady ? '방향 감지 준비 완료' : vision.lockReason}</div>
            </>
          ) : null}
          {currentId === 'voice' ? (
            <>
              <button className="debug-primary debug-wide" onClick={testVoice}>음성 테스트</button>
              <div className="debug-voice-result">{voiceResult || '아직 재생하지 않음'}</div>
              <div className="debug-button-row">
                <button className="debug-primary" onClick={() => confirmVoice(true)}>들림</button>
                <button className="debug-danger" onClick={() => confirmVoice(false)}>안 들림</button>
              </div>
            </>
          ) : null}
          {currentId === 'complete' ? <button className="debug-primary debug-wide" onClick={downloadReport}>검증 결과 저장</button> : null}
          <div className="debug-thresholds">
            <div><strong>손 모델</strong> {modelStatus.hand}</div>
            <div><strong>기타 모델</strong> {modelStatus.guitar}</div>
            <div><strong>실제 줄 구간</strong> {Math.round((vision.stringBand?.supportLength || 0) * 100)}%</div>
            {vision.guitarLabel ? <div><strong>분류 후보</strong> {vision.guitarLabel} · {percent(vision.guitarModelScore)}</div> : null}
            {modelStatus.error ? <div className="debug-error">{modelStatus.error}</div> : null}
          </div>
        </section>

        <section className="debug-checklist-card">
          <div className="debug-card-title">
            <div><span className="debug-kicker">REAL EVIDENCE</span><h2>실제 인식 검사</h2></div>
            <strong>{completed}/{TESTS.length}</strong>
          </div>
          <div className="debug-test-list">
            {TESTS.map((test) => (
              <div key={test.id} className={currentId === test.id ? 'active' : ''} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12 }}>
                <div><strong>{test.title}</strong><small style={{ display: 'block' }}>{results[test.id]?.note || test.instruction}</small></div>
                <StatusPill status={results[test.id]?.status || 'pending'} />
              </div>
            ))}
          </div>
        </section>

        <section className="debug-log-card">
          <div className="debug-card-title">
            <div><span className="debug-kicker">LIVE LOG</span><h2>진단 기록</h2></div>
            <button onClick={downloadReport}>JSON 저장</button>
          </div>
          <div className="debug-log-list">
            {logs.length ? logs.map((log, index) => <div key={`${log.at}-${index}`} className={log.level}><time>{log.at}</time><span>{log.message}</span></div>) : <p>아직 기록이 없습니다.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}

function AdminCenter() {
  return (
    <div className="debug-shell admin">
      <header className="debug-header">
        <div><span className="debug-kicker">REMOTE CONSOLE</span><h1>원격 진단 관리자</h1><p>사용자가 알려준 원격 로그 코드로 숫자·좌표·판정 이유만 확인합니다. 원본 영상은 전송하지 않습니다.</p></div>
      </header>
    </div>
  );
}

export default function DebugCenter() {
  return new URLSearchParams(window.location.search).get('admin') === '1' ? <AdminCenter /> : <DeviceCenter />;
}
