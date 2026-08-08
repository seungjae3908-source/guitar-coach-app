import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  analyzeHandAsync,
  HandAnalysisResult,
  HandLandmarkName,
  HandLandmarkPoint,
  isDetailedHandCoachAvailable,
  PickColor,
} from './modules/guitar-coach-hand';
import {
  analyzePoseAsync,
  isLiveCoachNativeAvailable,
  PoseAnalysisResult,
  PoseLandmarkPoint,
} from './modules/guitar-coach-native';

type AnalysisFocus = '전신 자세' | '오른손·피크' | '왼손 운지';
type Technique = '아르페지오' | '스트럼' | '피킹' | '코드 전환';
type FeedbackTone = 'good' | 'warn' | 'info';

type FeedbackItem = {
  tone: FeedbackTone;
  title: string;
  detail: string;
};

type MetricCard = {
  label: string;
  value: string;
  detail: string;
};

type HandMetrics = {
  palmSize: number;
  pinchRatio: number;
  spreadRatio: number;
  palmAngle: number;
  thumbAngle: number;
  indexPip: number;
  middlePip: number;
  ringPip: number;
  pinkyPip: number;
  curlRange: number;
  centerX: number;
  centerY: number;
};

type HandHistorySample = HandMetrics & { timestamp: number };

const FOCUSES: AnalysisFocus[] = ['전신 자세', '오른손·피크', '왼손 운지'];
const TECHNIQUES: Technique[] = ['아르페지오', '스트럼', '피킹', '코드 전환'];
const PICK_COLORS: Array<{ value: PickColor; label: string }> = [
  { value: 'none', label: '피크 없음' },
  { value: 'auto', label: '자동' },
  { value: 'red', label: '빨강' },
  { value: 'orange', label: '주황' },
  { value: 'yellow', label: '노랑' },
  { value: 'green', label: '초록' },
  { value: 'blue', label: '파랑' },
  { value: 'purple', label: '보라' },
  { value: 'white', label: '흰색' },
  { value: 'black', label: '검정' },
];

const POSE_LINKS: Array<[PoseLandmarkPoint['name'], PoseLandmarkPoint['name']]> = [
  ['leftEye', 'rightEye'],
  ['leftEar', 'leftEye'],
  ['rightEar', 'rightEye'],
  ['nose', 'leftEye'],
  ['nose', 'rightEye'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['leftWrist', 'leftThumb'],
  ['leftWrist', 'leftIndex'],
  ['leftWrist', 'leftPinky'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['rightWrist', 'rightThumb'],
  ['rightWrist', 'rightIndex'],
  ['rightWrist', 'rightPinky'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
];

const HAND_LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleAt(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const denominator = Math.max(0.000001, Math.hypot(abx, aby) * Math.hypot(cbx, cby));
  const cosine = clamp((abx * cbx + aby * cby) / denominator, -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function poseMap(result: PoseAnalysisResult | null) {
  const map = new Map<PoseLandmarkPoint['name'], PoseLandmarkPoint>();
  result?.landmarks.forEach((point) => map.set(point.name, point));
  return map;
}

function handMap(result: HandAnalysisResult | null) {
  const map = new Map<HandLandmarkName, HandLandmarkPoint>();
  result?.landmarks.forEach((point) => map.set(point.name, point));
  return map;
}

function calculateHandMetrics(result: HandAnalysisResult | null): HandMetrics | null {
  if (!result?.hasHand || result.landmarks.length < 21) return null;
  const points = handMap(result);
  const required = [
    'wrist',
    'thumbCmc',
    'thumbMcp',
    'thumbIp',
    'thumbTip',
    'indexMcp',
    'indexPip',
    'indexDip',
    'indexTip',
    'middleMcp',
    'middlePip',
    'middleDip',
    'middleTip',
    'ringMcp',
    'ringPip',
    'ringDip',
    'ringTip',
    'pinkyMcp',
    'pinkyPip',
    'pinkyDip',
    'pinkyTip',
  ] as const;
  if (required.some((name) => !points.get(name))) return null;

  const p = (name: HandLandmarkName) => points.get(name)!;
  const palmSize = distance(p('wrist'), p('middleMcp'));
  const safePalm = Math.max(0.001, palmSize);
  const pipAngles = [
    angleAt(p('indexMcp'), p('indexPip'), p('indexDip')),
    angleAt(p('middleMcp'), p('middlePip'), p('middleDip')),
    angleAt(p('ringMcp'), p('ringPip'), p('ringDip')),
    angleAt(p('pinkyMcp'), p('pinkyPip'), p('pinkyDip')),
  ];
  const palmAngle = (Math.atan2(p('middleMcp').y - p('wrist').y, p('middleMcp').x - p('wrist').x) * 180) / Math.PI;

  return {
    palmSize,
    pinchRatio: distance(p('thumbTip'), p('indexTip')) / safePalm,
    spreadRatio: distance(p('indexTip'), p('pinkyTip')) / safePalm,
    palmAngle,
    thumbAngle: angleAt(p('thumbMcp'), p('thumbIp'), p('thumbTip')),
    indexPip: pipAngles[0],
    middlePip: pipAngles[1],
    ringPip: pipAngles[2],
    pinkyPip: pipAngles[3],
    curlRange: Math.max(...pipAngles) - Math.min(...pipAngles),
    centerX: (p('wrist').x + p('middleMcp').x) / 2,
    centerY: (p('wrist').y + p('middleMcp').y) / 2,
  };
}

function buildBodyFeedback(result: PoseAnalysisResult | null): FeedbackItem[] {
  if (!result?.hasPerson) {
    return [{ tone: 'info', title: '상체를 화면에 맞춰 주세요', detail: '얼굴·양쪽 어깨·팔꿈치·손목·골반이 보이도록 거리를 조절하세요.' }];
  }
  const points = poseMap(result);
  const leftShoulder = points.get('leftShoulder');
  const rightShoulder = points.get('rightShoulder');
  const leftHip = points.get('leftHip');
  const rightHip = points.get('rightHip');
  const nose = points.get('nose');
  if (!leftShoulder || !rightShoulder) {
    return [{ tone: 'info', title: '양쪽 어깨가 필요합니다', detail: '카메라가 기타와 상체를 정면에 가깝게 보도록 두세요.' }];
  }

  const items: FeedbackItem[] = [];
  const shoulderWidth = distance(leftShoulder, rightShoulder);
  const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y) / Math.max(0.01, shoulderWidth);
  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  if (shoulderWidth < 0.16) items.push({ tone: 'warn', title: '카메라가 너무 멉니다', detail: '양쪽 손목이 보이는 범위에서 휴대폰을 조금 가까이 두세요.' });
  if (shoulderWidth > 0.62) items.push({ tone: 'warn', title: '카메라가 너무 가깝습니다', detail: '팔꿈치와 골반까지 보이도록 조금 멀리 두세요.' });
  if (Math.abs(shoulderMidX - 0.5) > 0.13) items.push({ tone: 'warn', title: '몸 중심이 화면에서 벗어났습니다', detail: '어깨 중앙을 화면 가운데 세로선에 맞추세요.' });
  if (shoulderTilt > 0.13) items.push({ tone: 'warn', title: '한쪽 어깨가 올라가 있습니다', detail: '기타를 받치며 어깨가 올라가지 않도록 목과 어깨 힘을 빼세요.' });
  if (nose && Math.abs(nose.x - shoulderMidX) / Math.max(0.01, shoulderWidth) > 0.34) items.push({ tone: 'warn', title: '고개가 한쪽으로 기울었습니다', detail: '지판을 보더라도 턱과 머리를 어깨 중앙에 가깝게 유지하세요.' });
  if (leftHip && rightHip) {
    const hipMidX = (leftHip.x + rightHip.x) / 2;
    if (Math.abs(hipMidX - shoulderMidX) > 0.12) items.push({ tone: 'warn', title: '상체가 옆으로 접혀 있습니다', detail: '골반 위에 상체를 세우고 기타 쪽으로 몸 전체를 숙이지 마세요.' });
  }
  return items.length ? items.slice(0, 4) : [{ tone: 'good', title: '상체 자세가 안정적입니다', detail: '현재 중심을 유지하면서 어깨와 손목 힘을 빼고 연주하세요.' }];
}

function buildHandFeedback(
  focus: AnalysisFocus,
  metrics: HandMetrics | null,
  result: HandAnalysisResult | null,
  gripStability: number,
): FeedbackItem[] {
  if (!result?.hasHand || !metrics) {
    return [{ tone: 'info', title: '손을 근접 가이드 안에 넣어 주세요', detail: '손목부터 손가락 끝까지 화면의 절반 이상을 차지하게 하고 밝은 곳에서 촬영하세요.' }];
  }

  const items: FeedbackItem[] = [];
  if (metrics.palmSize < 0.17) items.push({ tone: 'warn', title: '손이 너무 작게 보입니다', detail: '손가락 관절을 정확히 보려면 휴대폰을 손 가까이에 두세요.' });
  if (metrics.palmSize > 0.58) items.push({ tone: 'warn', title: '손이 화면에 너무 가깝습니다', detail: '손목과 다섯 손가락 끝이 모두 들어오도록 조금 멀리 두세요.' });

  if (focus === '오른손·피크') {
    if (metrics.pinchRatio > 0.55) items.push({ tone: 'warn', title: '엄지와 검지 간격이 큽니다', detail: '피크를 쥔 위치가 보이도록 엄지 끝과 검지 측면을 조금 더 가깝게 유지해 보세요.' });
    if (metrics.pinchRatio < 0.07) items.push({ tone: 'warn', title: '엄지와 검지가 지나치게 겹칩니다', detail: '피크를 너무 깊게 숨기거나 강하게 누르는지 확인하세요.' });
    if (metrics.indexPip > 166) items.push({ tone: 'warn', title: '검지가 너무 펴져 있습니다', detail: '피크를 잡을 때 검지 첫마디를 살짝 굽혀 손끝의 불필요한 힘을 줄이세요.' });
    if (metrics.indexPip < 58) items.push({ tone: 'warn', title: '검지가 많이 말려 있습니다', detail: '주먹을 쥐듯 접기보다 검지 측면이 피크를 받치도록 풀어 주세요.' });
    if (gripStability < 58) items.push({ tone: 'warn', title: '피크 그립 간격이 계속 흔들립니다', detail: '속도를 낮추고 엄지–검지 간격을 일정하게 유지하는 연습을 하세요.' });
    if (result.pick.color !== 'none') {
      if (!result.pick.detected) items.push({ tone: 'info', title: '선택한 색상의 피크를 찾지 못했습니다', detail: '피크를 엄지·검지 사이에 보이게 하고 배경과 다른 색을 선택하세요.' });
      else {
        if (result.pick.exposure < 0.12) items.push({ tone: 'warn', title: '피크가 손가락 안에 너무 많이 숨었습니다', detail: '피크 끝이 조금 더 보이도록 노출량을 늘려 보세요.' });
        if (result.pick.exposure > 0.9) items.push({ tone: 'warn', title: '피크 노출량이 큽니다', detail: '줄에 깊게 걸릴 수 있으니 피크를 조금 더 안쪽으로 잡아 보세요.' });
      }
    }
  } else {
    const pipAngles = [metrics.indexPip, metrics.middlePip, metrics.ringPip, metrics.pinkyPip];
    if (metrics.curlRange > 48) items.push({ tone: 'warn', title: '손가락 굽힘 차이가 큽니다', detail: '특정 손가락만 접히거나 들리지 않도록 네 손가락의 관절 높이를 맞춰 보세요.' });
    if (pipAngles.some((value) => value < 48)) items.push({ tone: 'warn', title: '한 손가락이 과하게 접혀 있습니다', detail: '손끝으로 누르되 첫마디가 손바닥 안쪽으로 무너지지 않게 세워 주세요.' });
    if (metrics.spreadRatio > 2.5) items.push({ tone: 'warn', title: '손가락을 과도하게 벌리고 있습니다', detail: '필요한 프렛 거리만큼만 벌리고 손바닥과 엄지 힘을 줄이세요.' });
    if (gripStability < 55) items.push({ tone: 'warn', title: '운지 모양이 계속 흔들립니다', detail: '코드 모양을 만든 뒤 2초 정지하는 연습으로 손가락 위치를 고정하세요.' });
  }

  return items.length ? items.slice(0, 5) : [{ tone: 'good', title: focus === '오른손·피크' ? '현재 피크 그립이 안정적입니다' : '현재 손가락 굽힘이 비교적 균형적입니다', detail: '수치를 유지하면서 천천히 반복하고, 통증이나 과도한 힘이 느껴지면 즉시 힘을 빼세요.' }];
}

function ToggleButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.toggleButton, active && styles.toggleButtonActive, pressed && styles.pressed]}>
      <Text style={[styles.toggleButtonText, active && styles.toggleButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PoseOverlay({ result, width, height }: { result: PoseAnalysisResult | null; width: number; height: number }) {
  const points = useMemo(() => poseMap(result), [result]);
  if (!result?.hasPerson || width <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {POSE_LINKS.map(([fromName, toName]) => {
        const from = points.get(fromName);
        const to = points.get(toName);
        if (!from || !to || from.confidence < 0.3 || to.confidence < 0.3) return null;
        const x1 = from.x * width;
        const y1 = from.y * height;
        const x2 = to.x * width;
        const y2 = to.y * height;
        const length = Math.hypot(x2 - x1, y2 - y1);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        return <View key={`${fromName}-${toName}`} style={[styles.poseLine, { width: length, left: (x1 + x2) / 2 - length / 2, top: (y1 + y2) / 2 - 1.5, transform: [{ rotate: `${angle}rad` }] }]} />;
      })}
      {[...points.values()].map((point) => point.confidence >= 0.3 ? <View key={point.name} style={[styles.poseDot, { left: point.x * width - 4, top: point.y * height - 4, opacity: clamp(point.confidence, 0.35, 1) }]} /> : null)}
    </View>
  );
}

function HandOverlay({ result, width, height }: { result: HandAnalysisResult | null; width: number; height: number }) {
  if (!result?.hasHand || result.landmarks.length < 21 || width <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {HAND_LINKS.map(([fromIndex, toIndex]) => {
        const from = result.landmarks[fromIndex];
        const to = result.landmarks[toIndex];
        const x1 = from.x * width;
        const y1 = from.y * height;
        const x2 = to.x * width;
        const y2 = to.y * height;
        const length = Math.hypot(x2 - x1, y2 - y1);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        return <View key={`${fromIndex}-${toIndex}`} style={[styles.handLine, { width: length, left: (x1 + x2) / 2 - length / 2, top: (y1 + y2) / 2 - 1, transform: [{ rotate: `${angle}rad` }] }]} />;
      })}
      {result.landmarks.map((point) => <View key={point.index} style={[styles.handDot, { left: point.x * width - 4, top: point.y * height - 4 }]} />)}
      {result.pick.detected ? (
        <View style={[styles.pickMarker, { left: result.pick.centerX * width - 18, top: result.pick.centerY * height - 18, transform: [{ rotate: `${result.pick.angleDegrees}deg` }] }]}>
          <View style={styles.pickAxis} />
        </View>
      ) : null}
    </View>
  );
}

export default function LiveCoachDetailedAi() {
  const cameraRef = useRef<CameraView | null>(null);
  const historyRef = useRef<HandHistorySample[]>([]);
  const analysisBusyRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('front');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const [focus, setFocus] = useState<AnalysisFocus>('전신 자세');
  const [technique, setTechnique] = useState<Technique>('아르페지오');
  const [pickColor, setPickColor] = useState<PickColor>('none');
  const [poseResult, setPoseResult] = useState<PoseAnalysisResult | null>(null);
  const [handResult, setHandResult] = useState<HandAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [historyVersion, setHistoryVersion] = useState(0);

  const handMetrics = useMemo(() => calculateHandMetrics(handResult), [handResult]);
  const history = historyRef.current;
  const gripStability = useMemo(() => {
    if (history.length < 3) return 100;
    const pinchVariation = standardDeviation(history.map((sample) => sample.pinchRatio));
    const indexVariation = standardDeviation(history.map((sample) => sample.indexPip));
    const palmVariation = standardDeviation(history.map((sample) => sample.palmAngle));
    return clamp(Math.round(100 - pinchVariation * 170 - indexVariation * 0.7 - palmVariation * 0.45), 0, 100);
  }, [historyVersion]);

  const feedback = useMemo(
    () => focus === '전신 자세' ? buildBodyFeedback(poseResult) : buildHandFeedback(focus, handMetrics, handResult, gripStability),
    [focus, gripStability, handMetrics, handResult, poseResult],
  );

  const metricCards = useMemo<MetricCard[]>(() => {
    if (!handMetrics || focus === '전신 자세') return [];
    const common: MetricCard[] = [
      { label: '그립 안정도', value: `${gripStability}`, detail: '최근 측정의 엄지–검지 간격과 관절 각도 흔들림' },
      { label: '엄지–검지 간격', value: handMetrics.pinchRatio.toFixed(2), detail: '손바닥 길이에 대한 비율' },
      { label: '검지 PIP', value: `${Math.round(handMetrics.indexPip)}°`, detail: '검지 가운데 관절 굽힘각' },
      { label: '손바닥 방향', value: `${Math.round(handMetrics.palmAngle)}°`, detail: '화면 가로축 기준 손바닥 축' },
    ];
    if (focus === '오른손·피크') {
      common.push(
        { label: '피크 감지', value: handResult?.pick.detected ? `${Math.round((handResult.pick.confidence || 0) * 100)}%` : '미감지', detail: '선택한 색상 영역의 추정 신뢰도' },
        { label: '피크 영상각', value: handResult?.pick.detected ? `${Math.round(handResult.pick.angleDegrees)}°` : '-', detail: '화면 가로축 기준이며 줄을 수평으로 맞춰야 비교 가능' },
        { label: '피크 노출량', value: handResult?.pick.detected ? handResult.pick.exposure.toFixed(2) : '-', detail: '손바닥 길이에 대한 색상 영역 크기' },
      );
    } else {
      common.push(
        { label: '중지 PIP', value: `${Math.round(handMetrics.middlePip)}°`, detail: '중지 가운데 관절 굽힘각' },
        { label: '약지 PIP', value: `${Math.round(handMetrics.ringPip)}°`, detail: '약지 가운데 관절 굽힘각' },
        { label: '새끼 PIP', value: `${Math.round(handMetrics.pinkyPip)}°`, detail: '새끼손가락 가운데 관절 굽힘각' },
        { label: '굽힘 편차', value: `${Math.round(handMetrics.curlRange)}°`, detail: '네 손가락 중 가장 큰 굽힘 차이' },
        { label: '손가락 벌어짐', value: handMetrics.spreadRatio.toFixed(2), detail: '검지–새끼 끝 간격 / 손바닥 길이' },
      );
    }
    return common;
  }, [focus, gripStability, handMetrics, handResult]);

  useEffect(() => {
    historyRef.current = [];
    setHistoryVersion((value) => value + 1);
    setPoseResult(null);
    setHandResult(null);
    setAnalysisError('');
  }, [focus]);

  useEffect(() => {
    if (!analysisEnabled || !cameraReady || !permission?.granted) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(captureAndAnalyze, delay);
    };

    const captureAndAnalyze = async () => {
      if (cancelled || analysisBusyRef.current || !cameraRef.current) {
        schedule(180);
        return;
      }
      analysisBusyRef.current = true;
      const startedAt = Date.now();
      try {
        const closeUp = focus !== '전신 자세';
        const photo = await cameraRef.current.takePictureAsync({
          quality: closeUp ? 0.42 : 0.24,
          shutterSound: false,
          mirror: facing === 'front',
        });
        if (!photo?.uri || cancelled) return;
        if (focus === '전신 자세') {
          const result = await analyzePoseAsync(photo.uri);
          if (!cancelled) {
            setPoseResult(result);
            setHandResult(null);
          }
        } else {
          const result = await analyzeHandAsync(photo.uri, focus === '오른손·피크' ? pickColor : 'none');
          if (!cancelled) {
            setHandResult(result);
            setPoseResult(null);
            const metrics = calculateHandMetrics(result);
            if (metrics) {
              historyRef.current = [...historyRef.current, { ...metrics, timestamp: Date.now() }].slice(-12);
              setHistoryVersion((value) => value + 1);
            }
          }
        }
        if (!cancelled) setAnalysisError('');
      } catch (error) {
        if (!cancelled) setAnalysisError(error instanceof Error ? error.message : 'AI 분석 중 오류가 발생했습니다.');
      } finally {
        analysisBusyRef.current = false;
        const targetInterval = focus === '전신 자세' ? 950 : 430;
        schedule(Math.max(160, targetInterval - (Date.now() - startedAt)));
      }
    };

    schedule(120);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      analysisBusyRef.current = false;
    };
  }, [analysisEnabled, cameraReady, facing, focus, permission?.granted, pickColor]);

  const toggleAnalysis = () => {
    const available = focus === '전신 자세' ? isLiveCoachNativeAvailable : isDetailedHandCoachAvailable;
    if (!available) {
      Alert.alert('분석 모듈 없음', focus === '전신 자세' ? '전신 자세 모듈이 포함되지 않았습니다.' : '손가락 상세 분석 모듈이 포함되지 않았습니다.');
      return;
    }
    setAnalysisError('');
    setAnalysisEnabled((value) => !value);
  };

  const switchCamera = () => {
    setAnalysisEnabled(false);
    setPoseResult(null);
    setHandResult(null);
    setCameraReady(false);
    setFacing((value) => value === 'front' ? 'back' : 'front');
    setCameraKey((value) => value + 1);
  };

  const onPreviewLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setPreviewSize({ width, height });
  };

  if (!permission) {
    return <View style={styles.centered}><ActivityIndicator size="large" /><Text style={styles.mutedText}>카메라 권한 확인 중</Text></View>;
  }
  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionTitle}>카메라 권한이 필요합니다.</Text>
        <Text style={styles.permissionText}>영상은 서버로 보내지 않고 휴대폰 안에서 자세와 손 관절을 계산합니다.</Text>
        <Pressable onPress={() => void requestPermission()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>카메라 권한 허용</Text></Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>AI 분석 범위</Text>
      <View style={styles.wrapRow}>
        {FOCUSES.map((item) => <ToggleButton key={item} label={item} active={focus === item} onPress={() => { setAnalysisEnabled(false); setFocus(item); }} />)}
      </View>

      <Text style={styles.sectionTitle}>연습 종류</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalRow}>
        {TECHNIQUES.map((item) => <ToggleButton key={item} label={item} active={technique === item} onPress={() => setTechnique(item)} />)}
      </ScrollView>

      {focus === '오른손·피크' ? (
        <>
          <Text style={styles.sectionTitle}>피크 색상</Text>
          <View style={styles.wrapRow}>
            {PICK_COLORS.map((item) => <ToggleButton key={item.value} label={item.label} active={pickColor === item.value} onPress={() => setPickColor(item.value)} />)}
          </View>
          <Text style={styles.guideText}>피크와 배경 색을 다르게 하고, 기타 줄이 화면에서 수평에 가깝게 보이도록 맞추세요.</Text>
        </>
      ) : null}

      <View style={[styles.cameraFrame, focus !== '전신 자세' && styles.cameraFrameClose]} onLayout={onPreviewLayout}>
        <CameraView
          key={`${facing}-${cameraKey}`}
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          mirror={facing === 'front'}
          mode="picture"
          ratio="4:3"
          animateShutter={false}
          onCameraReady={() => setCameraReady(true)}
          onMountError={(event) => setAnalysisError(event.message)}
        />
        <View pointerEvents="none" style={focus === '전신 자세' ? styles.bodyGuide : styles.handGuide} />
        {focus === '오른손·피크' ? <View pointerEvents="none" style={styles.stringGuide} /> : null}
        <View pointerEvents="none" style={styles.cameraTopRow}>
          <Text style={styles.cameraBadge}>{facing === 'front' ? '전면' : '후면'}</Text>
          <Text style={[styles.cameraBadge, analysisEnabled && styles.cameraBadgeActive]}>{analysisEnabled ? 'AI 분석 중' : '분석 대기'}</Text>
        </View>
        {focus === '전신 자세' ? <PoseOverlay result={poseResult} width={previewSize.width} height={previewSize.height} /> : <HandOverlay result={handResult} width={previewSize.width} height={previewSize.height} />}
        {!cameraReady ? <View style={styles.cameraLoading}><ActivityIndicator /><Text style={styles.cameraLoadingText}>카메라 준비 중</Text></View> : null}
      </View>

      <View style={styles.actionRow}>
        <Pressable onPress={toggleAnalysis} style={[styles.primaryButton, analysisEnabled && styles.stopButton]}><Text style={styles.primaryButtonText}>{analysisEnabled ? 'AI 분석 중지' : 'AI 분석 시작'}</Text></Pressable>
        <Pressable onPress={switchCamera} style={styles.secondaryButton}><Text style={styles.primaryButtonText}>카메라 전환</Text></Pressable>
      </View>
      {analysisError ? <Text style={styles.errorText}>{analysisError}</Text> : null}

      <View style={styles.feedbackCard}>
        <View style={styles.feedbackHeader}>
          <View style={styles.feedbackTextWrap}>
            <Text style={styles.eyebrow}>상세 AI 피드백 · {technique}</Text>
            <Text style={styles.feedbackTitle}>{feedback[0].title}</Text>
          </View>
          {focus !== '전신 자세' ? <View style={[styles.scoreBadge, gripStability >= 75 && styles.scoreBadgeGood]}><Text style={styles.scoreText}>{gripStability}</Text></View> : null}
        </View>
        <Text style={styles.feedbackDetail}>{feedback[0].detail}</Text>
        {feedback.slice(1).map((item) => (
          <View key={item.title} style={styles.feedbackRow}>
            <Text style={styles.feedbackBullet}>•</Text>
            <View style={styles.feedbackTextWrap}><Text style={styles.feedbackItemTitle}>{item.title}</Text><Text style={styles.feedbackItemDetail}>{item.detail}</Text></View>
          </View>
        ))}
        {(handResult || poseResult) ? <Text style={styles.latency}>처리 {handResult?.latencyMs ?? poseResult?.latencyMs}ms · {focus === '전신 자세' ? '약 1초' : '약 0.4초'} 간격</Text> : null}
      </View>

      {metricCards.length ? (
        <View style={styles.metricsGrid}>
          {metricCards.map((card) => <View key={card.label} style={styles.metricCard}><Text style={styles.metricLabel}>{card.label}</Text><Text style={styles.metricValue}>{card.value}</Text><Text style={styles.metricDetail}>{card.detail}</Text></View>)}
        </View>
      ) : null}

      <View style={styles.limitCard}>
        <Text style={styles.limitTitle}>정확도 안내</Text>
        <Text style={styles.limitText}>손가락 모드는 손 하나가 화면의 절반 이상을 차지해야 정확도가 올라갑니다. 현재는 관절 위치와 선택한 피크 색상을 휴대폰 안에서 분석합니다.</Text>
        <Text style={styles.limitText}>피크의 실제 줄 접촉 깊이·줄 번호·프렛 번호·음정 정확도는 기타 줄과 지판 또는 마이크를 별도로 인식해야 하므로 이번 결과에 가짜 판정을 표시하지 않습니다.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 14, paddingBottom: 90 },
  centered: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 22 },
  mutedText: { color: '#8b949e', marginTop: 10 },
  permissionTitle: { color: '#f0f6fc', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  permissionText: { color: '#8b949e', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  sectionTitle: { color: '#f0f6fc', fontSize: 15, fontWeight: '900', marginTop: 8, marginBottom: 9 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  horizontalRow: { paddingBottom: 6, gap: 7 },
  toggleButton: { minHeight: 40, borderRadius: 13, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  toggleButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  toggleButtonText: { color: '#b1bac4', fontSize: 11, fontWeight: '900' },
  toggleButtonTextActive: { color: '#ffffff' },
  guideText: { color: '#f2cc60', fontSize: 10, lineHeight: 16, marginTop: 8, marginBottom: 4 },
  cameraFrame: { height: 500, borderRadius: 22, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d', marginTop: 12 },
  cameraFrameClose: { height: 540 },
  camera: { flex: 1 },
  bodyGuide: { position: 'absolute', left: '13%', right: '13%', top: '16%', bottom: '8%', borderWidth: 1.5, borderColor: 'rgba(126,231,135,0.72)', borderStyle: 'dashed', borderRadius: 90 },
  handGuide: { position: 'absolute', left: '8%', right: '8%', top: '12%', bottom: '12%', borderWidth: 1.5, borderColor: 'rgba(121,192,255,0.82)', borderStyle: 'dashed', borderRadius: 45 },
  stringGuide: { position: 'absolute', left: '8%', right: '8%', top: '50%', height: 1, backgroundColor: 'rgba(242,204,96,0.8)' },
  cameraTopRow: { position: 'absolute', left: 10, right: 10, top: 10, flexDirection: 'row', justifyContent: 'space-between' },
  cameraBadge: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.68)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6, fontSize: 10, fontWeight: '900' },
  cameraBadgeActive: { backgroundColor: 'rgba(35,134,54,0.9)' },
  cameraLoading: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.66)', alignItems: 'center', justifyContent: 'center' },
  cameraLoadingText: { color: '#ffffff', marginTop: 10, fontWeight: '800' },
  poseLine: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: '#58a6ff' },
  poseDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#7ee787', borderWidth: 1, borderColor: '#ffffff' },
  handLine: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: '#f2cc60' },
  handDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#79c0ff', borderWidth: 1, borderColor: '#ffffff' },
  pickMarker: { position: 'absolute', width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#ff7b72', alignItems: 'center', justifyContent: 'center' },
  pickAxis: { width: 30, height: 2, backgroundColor: '#ff7b72' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  primaryButton: { flex: 1, minHeight: 49, borderRadius: 14, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 10 },
  secondaryButton: { flex: 1, minHeight: 49, borderRadius: 14, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 10 },
  stopButton: { backgroundColor: '#da3633' },
  primaryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#ff7b72', fontSize: 11, lineHeight: 17, marginTop: 8 },
  feedbackCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, padding: 16, marginTop: 14 },
  feedbackHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  feedbackTextWrap: { flex: 1 },
  eyebrow: { color: '#7ee787', fontSize: 10, fontWeight: '900', letterSpacing: 0.7, marginBottom: 5 },
  feedbackTitle: { color: '#f0f6fc', fontSize: 17, fontWeight: '900' },
  feedbackDetail: { color: '#b1bac4', fontSize: 13, lineHeight: 20, marginTop: 8 },
  feedbackRow: { flexDirection: 'row', marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#30363d' },
  feedbackBullet: { color: '#f2cc60', fontSize: 19, marginRight: 8 },
  feedbackItemTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900' },
  feedbackItemDetail: { color: '#8b949e', fontSize: 11, lineHeight: 17, marginTop: 3 },
  scoreBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#9e6a03', alignItems: 'center', justifyContent: 'center' },
  scoreBadgeGood: { backgroundColor: '#238636' },
  scoreText: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  latency: { color: '#6e7681', fontSize: 9, marginTop: 12, textAlign: 'right' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  metricCard: { width: '48.5%', minHeight: 112, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 15, padding: 12 },
  metricLabel: { color: '#8b949e', fontSize: 10, fontWeight: '800' },
  metricValue: { color: '#79c0ff', fontSize: 23, fontWeight: '900', marginTop: 5 },
  metricDetail: { color: '#8b949e', fontSize: 9, lineHeight: 14, marginTop: 5 },
  limitCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 17, padding: 15, marginTop: 12 },
  limitTitle: { color: '#79c0ff', fontSize: 13, fontWeight: '900' },
  limitText: { color: '#b6d8ff', fontSize: 11, lineHeight: 18, marginTop: 7 },
  pressed: { opacity: 0.68 },
});
