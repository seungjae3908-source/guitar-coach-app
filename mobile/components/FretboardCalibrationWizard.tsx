import { CameraView, useCameraPermissions } from 'expo-camera';
import { useMemo, useState } from 'react';
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

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import type { FretboardCalibration, FretboardPoint } from '../services/fretboard-chord-engine';
import { validateFretboardCalibration } from '../services/fretboard-chord-engine';
import { saveFretboardCalibration } from '../services/fretboard-calibration-store';

type Draft = {
  nutSixth?: FretboardPoint;
  nutFirst?: FretboardPoint;
  referenceSixth?: FretboardPoint;
  referenceFirst?: FretboardPoint;
};

type DraftKey = keyof Draft;

const STEPS: Array<{ key: DraftKey; title: string; detail: string }> = [
  { key: 'nutSixth', title: '① 너트의 6번 줄 쪽', detail: '헤드 바로 아래 너트에서 가장 굵은 6번 줄 지점을 누르세요.' },
  { key: 'nutFirst', title: '② 너트의 1번 줄 쪽', detail: '같은 너트에서 가장 가는 1번 줄 지점을 누르세요.' },
  { key: 'referenceSixth', title: '③ 기준 프렛의 6번 줄 쪽', detail: '아래에서 선택한 기준 프렛 철심과 6번 줄이 만나는 지점을 누르세요.' },
  { key: 'referenceFirst', title: '④ 기준 프렛의 1번 줄 쪽', detail: '같은 기준 프렛 철심과 1번 줄이 만나는 지점을 누르세요.' },
];

function Segment({
  start,
  end,
  width,
  height,
  style,
}: {
  start: FretboardPoint;
  end: FretboardPoint;
  width: number;
  height: number;
  style: object;
}) {
  const x1 = start.x * width;
  const y1 = start.y * height;
  const x2 = end.x * width;
  const y2 = end.y * height;
  const length = Math.hypot(x2 - x1, y2 - y1);
  return (
    <View
      style={[
        style,
        {
          width: length,
          left: (x1 + x2 - length) / 2,
          top: (y1 + y2) / 2,
          transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
        },
      ]}
    />
  );
}

function pointFor(draft: Draft, key: DraftKey) {
  return draft[key];
}

export default function FretboardCalibrationWizard({
  mode,
  onSaved,
  onClose,
}: {
  mode: GuitarModeId;
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>({});
  const [referenceFret, setReferenceFret] = useState(5);
  const [maxVisibleFret, setMaxVisibleFret] = useState(12);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('휴대폰과 기타 넥을 움직이지 말고 네 지점을 순서대로 누르세요.');

  const step = STEPS[stepIndex];
  const candidate = useMemo<FretboardCalibration | null>(() => {
    if (!draft.nutSixth || !draft.nutFirst || !draft.referenceSixth || !draft.referenceFirst) return null;
    return {
      id: `fretboard-${Date.now()}`,
      guitarMode: mode,
      cameraFacing: 'back',
      mirrored: false,
      createdAt: new Date().toISOString(),
      nutSixth: draft.nutSixth,
      nutFirst: draft.nutFirst,
      referenceSixth: draft.referenceSixth,
      referenceFirst: draft.referenceFirst,
      referenceFret,
      maxVisibleFret: Math.max(referenceFret, maxVisibleFret),
      confidencePercent: 100,
    };
  }, [draft, maxVisibleFret, mode, referenceFret]);
  const validation = candidate ? validateFretboardCalibration(candidate) : null;

  const onLayout = (event: LayoutChangeEvent) => {
    setPreviewSize({
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    });
  };

  const onPreviewPress = (event: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!cameraReady || previewSize.width <= 0 || previewSize.height <= 0 || !step) return;
    const point = {
      x: Math.min(1, Math.max(0, event.nativeEvent.locationX / previewSize.width)),
      y: Math.min(1, Math.max(0, event.nativeEvent.locationY / previewSize.height)),
    };
    setDraft((current) => ({ ...current, [step.key]: point }));
    setMessage(`${step.title} 지정 완료`);
    if (stepIndex < STEPS.length - 1) setStepIndex((value) => value + 1);
  };

  const reset = () => {
    setDraft({});
    setStepIndex(0);
    setMessage('지판 보정을 처음부터 다시 시작합니다.');
  };

  const undo = () => {
    const target = Math.max(0, stepIndex - 1);
    const item = STEPS[target];
    setDraft((current) => ({ ...current, [item.key]: undefined }));
    setStepIndex(target);
    setMessage(`${item.title}부터 다시 지정합니다.`);
  };

  const retryCamera = () => {
    setCameraReady(false);
    setCameraError('');
    setMessage('후면 카메라를 다시 연결하는 중입니다.');
    setCameraKey((value) => value + 1);
  };

  const save = async () => {
    if (!candidate || !validation?.valid || saving) return;
    setSaving(true);
    try {
      await saveFretboardCalibration(candidate);
      setMessage('왼손 지판 보정 저장 완료');
      onSaved?.();
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : '지판 보정을 저장하지 못했습니다.';
      setMessage(text);
      Alert.alert('왼손 지판 보정', text);
    } finally {
      setSaving(false);
    }
  };

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator /><Text style={styles.help}>카메라 권한 상태 확인 중</Text></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>왼손 지판 보정에 카메라 권한이 필요합니다</Text>
        <Text style={styles.help}>영상은 서버로 보내지 않고 줄·프렛 좌표만 휴대폰에 저장합니다.</Text>
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
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>LEFT HAND · FRETBOARD CALIBRATION</Text>
          <Text style={styles.title}>코드 이름·줄·프렛 인식 보정</Text>
          <Text style={styles.help}>넥 전체가 대각선으로 보여도 됩니다. 너트와 기준 프렛의 양끝을 정확히 누르세요.</Text>
        </View>
        {onClose ? <Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>닫기</Text></Pressable> : null}
      </View>

      <View style={styles.stepCard}>
        <Text style={styles.stepCount}>{stepIndex + 1}/{STEPS.length}</Text>
        <Text style={styles.stepTitle}>{step?.title}</Text>
        <Text style={styles.stepDetail}>{step?.detail}</Text>
      </View>

      <View style={styles.numberRow}>
        <View style={styles.numberControl}>
          <Text style={styles.numberLabel}>기준 프렛</Text>
          <View style={styles.stepperRow}>
            <Pressable onPress={() => setReferenceFret((value) => Math.max(3, value - 1))} style={styles.stepper}><Text style={styles.stepperText}>−</Text></Pressable>
            <Text style={styles.numberValue}>{referenceFret}</Text>
            <Pressable onPress={() => setReferenceFret((value) => Math.min(12, value + 1))} style={styles.stepper}><Text style={styles.stepperText}>＋</Text></Pressable>
          </View>
        </View>
        <View style={styles.numberControl}>
          <Text style={styles.numberLabel}>화면 마지막 프렛</Text>
          <View style={styles.stepperRow}>
            <Pressable onPress={() => setMaxVisibleFret((value) => Math.max(referenceFret, value - 1))} style={styles.stepper}><Text style={styles.stepperText}>−</Text></Pressable>
            <Text style={styles.numberValue}>{maxVisibleFret}</Text>
            <Pressable onPress={() => setMaxVisibleFret((value) => Math.min(22, value + 1))} style={styles.stepper}><Text style={styles.stepperText}>＋</Text></Pressable>
          </View>
        </View>
      </View>

      <Pressable onPress={onPreviewPress} onLayout={onLayout} style={styles.preview}>
        <CameraView
          key={`fretboard-back-${cameraKey}`}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          ratio="4:3"
          animateShutter={false}
          onCameraReady={() => {
            setCameraReady(true);
            setCameraError('');
            setMessage('카메라 준비 완료 · 안내된 지판 지점을 누르세요.');
          }}
          onMountError={(event) => {
            setCameraReady(false);
            setCameraError(event.message);
            setMessage(`카메라 연결 실패 · ${event.message}`);
          }}
        />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {draft.nutSixth && draft.nutFirst ? <Segment start={draft.nutSixth} end={draft.nutFirst} width={previewSize.width} height={previewSize.height} style={styles.nutLine} /> : null}
          {draft.referenceSixth && draft.referenceFirst ? <Segment start={draft.referenceSixth} end={draft.referenceFirst} width={previewSize.width} height={previewSize.height} style={styles.referenceLine} /> : null}
          {draft.nutSixth && draft.referenceSixth ? <Segment start={draft.nutSixth} end={draft.referenceSixth} width={previewSize.width} height={previewSize.height} style={styles.neckEdge} /> : null}
          {draft.nutFirst && draft.referenceFirst ? <Segment start={draft.nutFirst} end={draft.referenceFirst} width={previewSize.width} height={previewSize.height} style={styles.neckEdge} /> : null}
          {STEPS.map((item, index) => {
            const point = pointFor(draft, item.key);
            if (!point) return null;
            return (
              <View
                key={item.key}
                style={[
                  styles.marker,
                  {
                    left: point.x * previewSize.width - 11,
                    top: point.y * previewSize.height - 11,
                  },
                ]}
              >
                <Text style={styles.markerText}>{index + 1}</Text>
              </View>
            );
          })}
        </View>
        {!cameraReady ? (
          <View style={styles.loading}>
            {cameraError ? (
              <>
                <Text style={styles.cameraErrorTitle}>후면 카메라 연결 실패</Text>
                <Text style={styles.cameraErrorText}>{cameraError}</Text>
                <Pressable onPress={retryCamera} style={styles.retryButton}>
                  <Text style={styles.retryText}>카메라 다시 연결</Text>
                </Pressable>
              </>
            ) : (
              <><ActivityIndicator /><Text style={styles.loadingText}>카메라 준비 중</Text></>
            )}
          </View>
        ) : null}
      </Pressable>

      <Text style={[styles.status, validation?.valid && styles.statusGood]}>{validation?.message ?? message}</Text>
      <View style={styles.actions}>
        <Pressable onPress={undo} style={styles.secondaryButton}><Text style={styles.secondaryText}>이전 다시</Text></Pressable>
        <Pressable onPress={reset} style={styles.secondaryButton}><Text style={styles.secondaryText}>초기화</Text></Pressable>
        <Pressable disabled={!validation?.valid || saving} onPress={() => void save()} style={[styles.primaryButton, (!validation?.valid || saving) && styles.disabled]}>
          <Text style={styles.primaryText}>{saving ? '저장 중' : '지판 보정 저장'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 12, paddingBottom: 110 },
  center: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 9 },
  headerText: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#f2cc60', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 18, fontWeight: '900', marginTop: 3 },
  help: { color: '#8b949e', fontSize: 9, lineHeight: 15, marginTop: 4 },
  closeButton: { minWidth: 50, height: 38, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  stepCard: { borderRadius: 14, borderWidth: 1, borderColor: '#9e6a03', backgroundColor: '#211c10', padding: 11, marginBottom: 8 },
  stepCount: { color: '#f2cc60', fontSize: 8, fontWeight: '900' },
  stepTitle: { color: '#ffffff', fontSize: 13, fontWeight: '900', marginTop: 3 },
  stepDetail: { color: '#d6c98c', fontSize: 9, lineHeight: 14, marginTop: 3 },
  numberRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  numberControl: { flex: 1, borderRadius: 12, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', padding: 8 },
  numberLabel: { color: '#8b949e', fontSize: 8, fontWeight: '900', textAlign: 'center' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 5 },
  stepper: { width: 34, height: 30, borderRadius: 9, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center' },
  stepperText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  numberValue: { minWidth: 30, color: '#7ee787', fontSize: 15, fontWeight: '900', textAlign: 'center' },
  preview: { height: 430, borderRadius: 17, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d' },
  nutLine: { position: 'absolute', height: 4, backgroundColor: '#ff7b72' },
  referenceLine: { position: 'absolute', height: 3, backgroundColor: '#f2cc60' },
  neckEdge: { position: 'absolute', height: 2, backgroundColor: '#79c0ff' },
  marker: { position: 'absolute', width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ffffff', backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center' },
  markerText: { color: '#ffffff', fontSize: 8, fontWeight: '900' },
  loading: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.76)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  loadingText: { color: '#ffffff', fontSize: 9, fontWeight: '900', marginTop: 6 },
  cameraErrorTitle: { color: '#ff7b72', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  cameraErrorText: { color: '#b1bac4', fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 6 },
  retryButton: { minHeight: 40, borderRadius: 11, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 12 },
  retryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  status: { color: '#f2cc60', fontSize: 9, lineHeight: 14, marginTop: 8, textAlign: 'center' },
  statusGood: { color: '#7ee787' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  primaryButton: { flexGrow: 1, minHeight: 42, borderRadius: 11, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13 },
  primaryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  secondaryButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryText: { color: '#b1bac4', fontSize: 9, fontWeight: '900' },
  disabled: { opacity: 0.38 },
});
