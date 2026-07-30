import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import {
  buildStringGuides,
  CalibrationDraft,
  createCameraCalibration,
  NormalizedPoint,
  validateCalibrationDraft,
} from '../services/camera-calibration';
import { saveCameraCalibration } from '../services/camera-calibration-store';

const STEPS: Array<{
  key: keyof CalibrationDraft;
  title: string;
  detail: string;
  optional?: boolean;
}> = [
  { key: 'handCenter', title: '① 오른손 중심', detail: '평소 피킹·스트럼할 때 손바닥 가운데를 누르세요.' },
  { key: 'sixthStringLeft', title: '② 6번 줄 왼쪽', detail: '화면 왼쪽에 보이는 가장 굵은 줄을 누르세요.' },
  { key: 'sixthStringRight', title: '③ 6번 줄 오른쪽', detail: '같은 6번 줄의 화면 오른쪽 지점을 누르세요.' },
  { key: 'firstStringLeft', title: '④ 1번 줄 왼쪽', detail: '화면 왼쪽에 보이는 가장 가는 줄을 누르세요.' },
  { key: 'firstStringRight', title: '⑤ 1번 줄 오른쪽', detail: '같은 1번 줄의 화면 오른쪽 지점을 누르세요.' },
  { key: 'bridgeTop', title: '⑥ 브리지 위쪽', detail: '브리지의 위쪽 경계 중앙을 누르세요.' },
  { key: 'bridgeBottom', title: '⑦ 브리지 아래쪽', detail: '브리지의 아래쪽 경계 중앙을 누르세요.' },
  { key: 'pickCenter', title: '⑧ 피크 중심', detail: '피크를 평소 그립으로 잡고 보이는 피크 가운데를 누르세요.', optional: true },
];

function pointForKey(draft: CalibrationDraft, key: keyof CalibrationDraft) {
  return draft[key];
}

export default function CameraCalibrationWizard({
  mode,
  onSaved,
  onClose,
}: {
  mode: GuitarModeId;
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<CalibrationDraft>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const step = STEPS[stepIndex];
  const stringGuides = useMemo(() => buildStringGuides(draft), [draft]);
  const validation = useMemo(() => validateCalibrationDraft(draft), [draft]);

  const onLayout = (event: LayoutChangeEvent) => {
    setPreviewSize({
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    });
  };

  const setPoint = (point: NormalizedPoint) => {
    if (!step) return;
    setDraft((current) => ({ ...current, [step.key]: point }));
    setMessage(`${step.title} 지정 완료`);
    if (stepIndex < STEPS.length - 1) setStepIndex((current) => current + 1);
  };

  const onPreviewPress = (event: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!cameraReady || previewSize.width <= 0 || previewSize.height <= 0) return;
    const point = {
      x: Math.min(1, Math.max(0, event.nativeEvent.locationX / previewSize.width)),
      y: Math.min(1, Math.max(0, event.nativeEvent.locationY / previewSize.height)),
    };
    setPoint(point);
  };

  const skipOptional = () => {
    if (!step?.optional) return;
    setDraft((current) => ({ ...current, [step.key]: undefined }));
    setStepIndex(Math.min(STEPS.length - 1, stepIndex + 1));
    setMessage('피크 중심은 생략했습니다. 색상 AI가 자동으로 찾습니다.');
  };

  const undo = () => {
    const targetIndex = Math.max(0, stepIndex - 1);
    const target = STEPS[targetIndex];
    setDraft((current) => ({ ...current, [target.key]: undefined }));
    setStepIndex(targetIndex);
    setMessage(`${target.title}부터 다시 지정합니다.`);
  };

  const reset = () => {
    setDraft({});
    setStepIndex(0);
    setMessage('보정을 처음부터 다시 시작합니다.');
  };

  const switchFacing = () => {
    setCameraReady(false);
    setMessage('카메라를 다시 연결하는 중입니다.');
    setFacing((current) => current === 'back' ? 'front' : 'back');
    setCameraKey((value) => value + 1);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage('보정값 저장 중…');
    try {
      const calibration = createCameraCalibration(draft, {
        guitarMode: mode,
        cameraFacing: facing,
        mirrored: facing === 'front',
      });
      await saveCameraCalibration(calibration);
      setMessage(`보정 저장 완료 · 신뢰도 ${calibration.confidencePercent}%`);
      onSaved?.();
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : '보정값을 저장하지 못했습니다.';
      setMessage(text);
      Alert.alert('촬영 보정', text);
    } finally {
      setSaving(false);
    }
  };

  if (!permission) {
    return <View style={styles.center}><Text style={styles.helpText}>카메라 권한 상태를 확인하는 중입니다.</Text></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>촬영 보정에 카메라 권한이 필요합니다</Text>
        <Text style={styles.helpText}>영상은 서버로 보내지 않고 휴대폰 안에서 줄과 브리지 위치만 저장합니다.</Text>
        <Pressable onPress={() => void requestPermission()} style={styles.primaryButton}>
          <Text style={styles.primaryText}>카메라 권한 허용</Text>
        </Pressable>
        {onClose ? <Pressable onPress={onClose} style={styles.secondaryButton}><Text style={styles.secondaryText}>닫기</Text></Pressable> : null}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>{mode === 'acoustic' ? '통기타' : '일렉기타'} · STRING CALIBRATION</Text>
          <Text style={styles.title}>줄·브리지 촬영 보정</Text>
          <Text style={styles.helpText}>휴대폰과 기타 위치를 고정한 뒤 화면의 지점을 순서대로 누르세요.</Text>
        </View>
        {onClose ? <Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>닫기</Text></Pressable> : null}
      </View>

      <View style={styles.stepCard}>
        <Text style={styles.stepCount}>{stepIndex + 1} / {STEPS.length}</Text>
        <Text style={styles.stepTitle}>{step?.title}</Text>
        <Text style={styles.stepDetail}>{step?.detail}</Text>
      </View>

      <Pressable onPress={onPreviewPress} onLayout={onLayout} style={styles.previewWrap}>
        <CameraView
          key={`${facing}-${cameraKey}`}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode="picture"
          ratio="4:3"
          animateShutter={false}
          onCameraReady={() => {
            setCameraReady(true);
            setMessage('카메라 준비 완료 · 안내 지점을 누르세요.');
          }}
          onMountError={(event) => {
            setCameraReady(false);
            setMessage(`카메라 연결 실패 · ${event.message}`);
          }}
        />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {stringGuides.map((guide) => {
            const x1 = guide.start.x * previewSize.width;
            const y1 = guide.start.y * previewSize.height;
            const x2 = guide.end.x * previewSize.width;
            const y2 = guide.end.y * previewSize.height;
            const length = Math.hypot(x2 - x1, y2 - y1);
            const angle = Math.atan2(y2 - y1, x2 - x1);
            return (
              <View
                key={guide.stringNumber}
                style={[
                  styles.stringLine,
                  {
                    width: length,
                    left: (x1 + x2) / 2 - length / 2,
                    top: (y1 + y2) / 2 - 1,
                    transform: [{ rotate: `${angle}rad` }],
                  },
                ]}
              >
                <Text style={styles.stringLabel}>{guide.stringNumber}</Text>
              </View>
            );
          })}
          {STEPS.map((item, index) => {
            const point = pointForKey(draft, item.key);
            if (!point) return null;
            return (
              <View
                key={item.key}
                style={[
                  styles.marker,
                  {
                    left: point.x * previewSize.width - 10,
                    top: point.y * previewSize.height - 10,
                  },
                  index === stepIndex && styles.markerCurrent,
                ]}
              >
                <Text style={styles.markerText}>{index + 1}</Text>
              </View>
            );
          })}
          <View style={styles.centerGuide} />
        </View>
        {!cameraReady ? <View pointerEvents="none" style={styles.cameraLoading}><Text style={styles.loadingText}>카메라 준비 중</Text></View> : null}
      </Pressable>

      <View style={styles.statusRow}>
        <Text style={[styles.statusText, validation.complete && styles.statusGood]}>{message || validation.message}</Text>
        <Pressable onPress={switchFacing} style={styles.smallButton}>
          <Text style={styles.smallText}>{facing === 'back' ? '후면' : '전면'}</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable onPress={undo} style={styles.secondaryButton}><Text style={styles.secondaryText}>이전 다시</Text></Pressable>
        {step?.optional ? <Pressable onPress={skipOptional} style={styles.secondaryButton}><Text style={styles.secondaryText}>피크 생략</Text></Pressable> : null}
        <Pressable onPress={reset} style={styles.secondaryButton}><Text style={styles.secondaryText}>초기화</Text></Pressable>
        <Pressable disabled={!validation.complete || saving} onPress={() => void save()} style={[styles.primaryButton, (!validation.complete || saving) && styles.disabled]}>
          <Text style={styles.primaryText}>{saving ? '저장 중' : '보정 저장'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 12, paddingBottom: 110 },
  center: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  headerTextWrap: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 19, fontWeight: '900', marginTop: 3 },
  helpText: { color: '#8b949e', fontSize: 10, lineHeight: 16, marginTop: 4, textAlign: 'center' },
  closeButton: { minWidth: 48, height: 38, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f0f6fc', fontSize: 10, fontWeight: '900' },
  stepCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 14, padding: 11, marginBottom: 9 },
  stepCount: { color: '#7ee787', fontSize: 9, fontWeight: '900' },
  stepTitle: { color: '#f0f6fc', fontSize: 14, fontWeight: '900', marginTop: 3 },
  stepDetail: { color: '#b1bac4', fontSize: 10, lineHeight: 15, marginTop: 3 },
  previewWrap: { height: 420, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d' },
  cameraLoading: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  stringLine: { position: 'absolute', height: 2, backgroundColor: '#7ee787' },
  stringLabel: { position: 'absolute', left: 2, top: -13, color: '#ffffff', fontSize: 8, fontWeight: '900', backgroundColor: '#238636', paddingHorizontal: 3, borderRadius: 4 },
  marker: { position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: '#1f6feb', borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  markerCurrent: { backgroundColor: '#da3633' },
  markerText: { color: '#ffffff', fontSize: 8, fontWeight: '900' },
  centerGuide: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.18)' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  statusText: { flex: 1, color: '#f2cc60', fontSize: 10, lineHeight: 15, paddingRight: 8 },
  statusGood: { color: '#7ee787' },
  smallButton: { minWidth: 52, height: 36, borderRadius: 10, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center' },
  smallText: { color: '#f0f6fc', fontSize: 10, fontWeight: '900' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  primaryButton: { minHeight: 42, borderRadius: 11, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 14 },
  primaryText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  secondaryButton: { minHeight: 42, borderRadius: 11, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11 },
  secondaryText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  disabled: { opacity: 0.42 },
});
