import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CameraType } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import { getPracticePresetsForMode, type PracticePreset } from '../config/personal-practice-presets';
import {
  isAdvancedMetronomeAvailable,
  startAdvancedMetronomeAsync,
  stopAdvancedMetronomeAsync,
  updateAdvancedMetronomeAsync,
} from '../modules/guitar-coach-metronome';
import { clearLatestLiveAnalysisFrames } from '../services/analysis-stream';
import {
  canShowFocusV8Coaching,
  FOCUS_V8_MIN_EVIDENCE_FRAMES,
  focusV8CameraSize,
  focusV8WaitingMessage,
} from '../services/focus-v8-contract';
import {
  categoryMatchesFocusMode,
  FOCUS_MODE_OPTIONS,
  focusModeForCategory,
  type FocusPracticeMode,
} from '../services/focus-practice-mode';
import { clearLiveCoachFeedback } from '../services/live-coach-feedback';
import { clearLivePracticeContext, setLivePracticeContext } from '../services/practice-session-context';
import { savePracticeSession, type PracticeSessionRecord, type SessionIssue } from '../services/practice-session-store';
import {
  TrajectorySpeedCoach,
  type MotionSample,
  type TrajectoryCoachResult,
} from '../services/trajectory-speed-engine';
import FocusCoachCameraV7, {
  clearFocusV7RightHandRegion,
  loadFocusV7RightHandRegion,
  RightHandCalibrationV7,
} from './FocusCoachCameraV7';

const V8_CALIBRATION_RESET_KEY = 'guitar-coach:focus-v8:calibration-reset:v1';

function formatTime(seconds: number) {
  const minute = Math.floor(seconds / 60);
  const second = seconds % 60;
  return `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function subjectLabel(focus: PracticePreset['cameraFocus']) {
  if (focus === 'right-hand') return '오른손';
  if (focus === 'left-hand') return '왼손';
  if (focus === 'full-body') return '상체';
  return '동작';
}

function trajectoryIssues(result: TrajectoryCoachResult | null): SessionIssue[] {
  if (!result || result.state !== 'broken') return [];
  return [{
    id: 'trajectory-broken',
    title: result.title,
    count: Math.max(1, result.brokenCycles),
    severity: 'warn',
    confidencePercent: result.confidencePercent,
  }];
}

async function prepareFocusV8CalibrationStorage() {
  const alreadyReset = await AsyncStorage.getItem(V8_CALIBRATION_RESET_KEY);
  if (alreadyReset === 'done') return;
  await Promise.all([
    clearFocusV7RightHandRegion('back'),
    clearFocusV7RightHandRegion('front'),
  ]);
  await AsyncStorage.setItem(V8_CALIBRATION_RESET_KEY, 'done');
}

function CalibrationSurfaceV8({
  initialFacing,
  onSaved,
  onCancel,
}: {
  initialFacing: CameraType;
  onSaved: (facing: CameraType) => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.calibrationRoot}>
      <RightHandCalibrationV7
        initialFacing={initialFacing}
        onCancel={onCancel}
        onSaved={(facing) => onSaved(facing)}
      />
      <View pointerEvents="none" style={styles.calibrationVersionPatch}>
        <Text style={styles.calibrationVersionText}>FOCUS V8 · v21 촬영 보정</Text>
      </View>
    </View>
  );
}

function feedbackTone(result: TrajectoryCoachResult | null) {
  if (!result) return styles.feedbackWaiting;
  if (result.state === 'stable' || result.state === 'baseline-ready') return styles.feedbackGood;
  if (result.state === 'broken') return styles.feedbackBad;
  return styles.feedbackWaiting;
}

export default function PracticeSessionRunnerV8({
  mode,
  voiceCoachEnabled,
  onClose,
}: {
  mode: GuitarModeId;
  voiceCoachEnabled: boolean;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const cameraSize = focusV8CameraSize(width, height);
  const presets = useMemo(() => getPracticePresetsForMode(mode), [mode]);
  const initialPreset = presets[0] ?? null;
  const [focusMode, setFocusMode] = useState<FocusPracticeMode>(focusModeForCategory(initialPreset?.category));
  const matchingPresets = useMemo(
    () => presets.filter((item) => categoryMatchesFocusMode(item.category, focusMode)),
    [focusMode, presets],
  );
  const [presetId, setPresetId] = useState(initialPreset?.id ?? '');
  const preset = useMemo(
    () => presets.find((item) => item.id === presetId) ?? matchingPresets[0] ?? initialPreset,
    [initialPreset, matchingPresets, presetId, presets],
  );

  const [running, setRunning] = useState(false);
  const [bpm, setBpm] = useState(initialPreset?.startBpm ?? 60);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [cameraStatus, setCameraStatus] = useState('카메라 연결 중');
  const [subjectLocked, setSubjectLocked] = useState(false);
  const [acceptedFrames, setAcceptedFrames] = useState(0);
  const [capturedFrames, setCapturedFrames] = useState(0);
  const [trajectory, setTrajectory] = useState<TrajectoryCoachResult | null>(null);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [calibrationChecked, setCalibrationChecked] = useState(false);
  const [calibrationReady, setCalibrationReady] = useState(false);
  const [calibrationVisible, setCalibrationVisible] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');

  const startedAtRef = useRef<number | null>(null);
  const bpmRef = useRef(bpm);
  const trajectoryRef = useRef<TrajectorySpeedCoach | null>(null);
  const finalTrajectoryRef = useRef<TrajectoryCoachResult | null>(null);
  const subjectLockedRef = useRef(false);

  useEffect(() => {
    const next = matchingPresets[0];
    if (!next || running) return;
    setPresetId(next.id);
  }, [focusMode, matchingPresets, running]);

  useEffect(() => {
    if (!preset || running) return;
    setBpm(preset.startBpm);
    bpmRef.current = preset.startBpm;
    setAcceptedFrames(0);
    setCapturedFrames(0);
    setSubjectLocked(false);
    subjectLockedRef.current = false;
    setTrajectory(null);
    setError('');
    setSavedMessage('');
  }, [preset?.id, running]);

  useEffect(() => {
    let cancelled = false;
    setCalibrationChecked(false);
    setCalibrationVisible(false);

    const check = async () => {
      if (!preset || preset.cameraFocus !== 'right-hand') {
        if (!cancelled) {
          setCalibrationReady(true);
          setCalibrationChecked(true);
        }
        return;
      }
      try {
        await prepareFocusV8CalibrationStorage();
        const stored = await loadFocusV7RightHandRegion(cameraFacing);
        if (cancelled) return;
        setCalibrationReady(Boolean(stored));
        setCalibrationVisible(!stored);
        setCalibrationChecked(true);
      } catch {
        if (cancelled) return;
        setCalibrationReady(false);
        setCalibrationVisible(true);
        setCalibrationChecked(true);
      }
    };

    void check();
    return () => { cancelled = true; };
  }, [cameraFacing, preset?.cameraFocus, preset?.id]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt) setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 250);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => () => {
    clearLivePracticeContext();
    clearLiveCoachFeedback();
    void stopAdvancedMetronomeAsync();
  }, []);

  const setPracticeContext = (nextBpm: number, startedAt: number) => {
    if (!preset) return;
    setLivePracticeContext({
      active: true,
      guitarMode: mode,
      presetId: preset.id,
      title: preset.title,
      goal: preset.goal,
      pattern: preset.pattern,
      category: preset.category,
      cameraFocus: preset.cameraFocus,
      bpm: nextBpm,
      targetBpm: preset.targetBpm,
      pulsesPerBeat: 2,
      microphoneEnabled: false,
      calibrationConfidencePercent: null,
      startedAt,
    });
  };

  const createTrajectoryCoach = (capturedAt: number) => {
    if (!preset) return null;
    const coach = new TrajectorySpeedCoach({
      startBpm: bpmRef.current,
      targetBpm: preset.targetBpm,
      pulsesPerBeat: 2,
      pattern: preset.pattern,
    });
    trajectoryRef.current = coach;
    const initial = coach.start(capturedAt);
    finalTrajectoryRef.current = initial;
    setTrajectory(initial);
    return coach;
  };

  const applyBpm = async (nextBpm: number) => {
    if (!preset) return;
    const safe = Math.min(preset.targetBpm, Math.max(35, Math.round(nextBpm)));
    bpmRef.current = safe;
    setBpm(safe);
    trajectoryRef.current?.updateBpm(safe, Date.now());
    const startedAt = startedAtRef.current;
    if (running && startedAt) setPracticeContext(safe, startedAt);
    if (running && isAdvancedMetronomeAvailable) {
      try {
        await updateAdvancedMetronomeAsync(safe, 4, 2, true, false, 0);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'BPM을 변경하지 못했습니다.');
      }
    }
  };

  const startLesson = async () => {
    if (!preset || running) return;
    if (preset.cameraFocus === 'right-hand' && !calibrationReady) {
      setCalibrationVisible(true);
      return;
    }
    setError('');
    setSavedMessage('');
    setAcceptedFrames(0);
    setCapturedFrames(0);
    setTrajectory(null);
    clearLatestLiveAnalysisFrames();
    clearLiveCoachFeedback();
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    setElapsedSeconds(0);
    createTrajectoryCoach(startedAt);
    setPracticeContext(bpmRef.current, startedAt);
    setRunning(true);
    try {
      if (isAdvancedMetronomeAvailable) {
        await startAdvancedMetronomeAsync(bpmRef.current, 4, 2, true, false, 0);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '메트로놈을 시작하지 못했습니다.');
    }
  };

  const stopLesson = async (closeAfter = false) => {
    if (!preset) {
      if (closeAfter) onClose();
      return;
    }
    const startedAt = startedAtRef.current;
    setRunning(false);
    clearLivePracticeContext();
    clearLiveCoachFeedback();
    await stopAdvancedMetronomeAsync();

    if (startedAt) {
      const endedAt = Date.now();
      const final = finalTrajectoryRef.current;
      const record: PracticeSessionRecord = {
        id: `${startedAt}-${preset.id}-focus-v8`,
        guitarMode: mode,
        category: preset.category,
        presetId: preset.id,
        title: preset.title,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        durationSeconds: Math.max(1, Math.floor((endedAt - startedAt) / 1_000)),
        bpmStart: preset.startBpm,
        bpmEnd: bpmRef.current,
        averageScore: null,
        bestScore: null,
        averageConfidencePercent: final?.confidencePercent ?? 0,
        manualMistakes: 0,
        aiMistakes: final?.brokenCycles ?? 0,
        stableSeconds: final?.stableCycles ? final.stableCycles * 2 : 0,
        issues: trajectoryIssues(final),
        nextAssignment: final?.reinforcement || `${subjectLabel(preset.cameraFocus)} 잠금이 유지되는 위치에서 느린 기준 궤적을 다시 수집하세요.`,
        cameraMode: preset.cameraFocus,
        microphoneUsed: false,
        metronomeUsed: isAdvancedMetronomeAvailable,
        notes: `FOCUS V8 · 캡처 ${capturedFrames} · 현재 세션 승인 ${acceptedFrames} · 음성 설정 ${voiceCoachEnabled ? '켜짐' : '꺼짐'} · 마이크 미사용`,
      };
      try {
        await savePracticeSession(record);
        setSavedMessage('세션 기록 저장 완료');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '세션 기록을 저장하지 못했습니다.');
      }
    }

    startedAtRef.current = null;
    trajectoryRef.current = null;
    if (closeAfter) onClose();
  };

  const handleMotionSample = (sample: MotionSample) => {
    if (!running) return;
    const next = trajectoryRef.current?.addSample(sample) ?? null;
    if (!next) return;
    finalTrajectoryRef.current = next;
    setTrajectory(next);
    if (next.shouldIncreaseBpm) void applyBpm(bpmRef.current + 5);
    else if (next.shouldReturnToStableBpm && next.lastStableBpm < bpmRef.current) void applyBpm(next.lastStableBpm);
  };

  const handleSubjectLock = (next: boolean) => {
    const previous = subjectLockedRef.current;
    subjectLockedRef.current = next;
    setSubjectLocked(next);
    if (previous && !next && running) {
      setAcceptedFrames(0);
      createTrajectoryCoach(Date.now());
      setCameraStatus(`${subjectLabel(preset?.cameraFocus ?? 'none')} 잠금이 끊겨 기준 궤적을 다시 수집합니다.`);
    }
  };

  const requestCalibration = async (facing: CameraType) => {
    if (running) await stopLesson(false);
    setCameraFacing(facing);
    setCalibrationReady(false);
    setCalibrationChecked(true);
    setCalibrationVisible(true);
  };

  const cycleRoutine = () => {
    if (running || matchingPresets.length < 2 || !preset) return;
    const currentIndex = matchingPresets.findIndex((item) => item.id === preset.id);
    const next = matchingPresets[(currentIndex + 1) % matchingPresets.length];
    if (next) setPresetId(next.id);
  };

  if (!preset) {
    return (
      <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
        <SafeAreaView style={styles.root}>
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>집중교정 루틴이 없습니다</Text>
            <Pressable onPress={onClose} style={styles.closeOnly}><Text style={styles.closeOnlyText}>닫기</Text></Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  const label = subjectLabel(preset.cameraFocus);
  const evidence = {
    lessonRunning: running,
    subjectLocked,
    acceptedFrames,
    calibrationReady,
  };
  const coachingAllowed = canShowFocusV8Coaching(evidence);
  const waitingMessage = focusV8WaitingMessage(evidence, label);

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => void stopLesson(true)}>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0d1117" translucent={false} />

        {!calibrationChecked ? (
          <View style={styles.loadingSurface}>
            <Text style={styles.loadingBuild}>FOCUS V8 · v21</Text>
            <Text style={styles.loadingText}>촬영 설정 확인 중</Text>
          </View>
        ) : calibrationVisible && preset.cameraFocus === 'right-hand' ? (
          <CalibrationSurfaceV8
            initialFacing={cameraFacing}
            onCancel={() => calibrationReady ? setCalibrationVisible(false) : onClose()}
            onSaved={(facing) => {
              setCameraFacing(facing);
              setCalibrationReady(true);
              setCalibrationVisible(false);
              setSubjectLocked(false);
              subjectLockedRef.current = false;
              setAcceptedFrames(0);
              setCameraStatus('촬영 보정 저장 완료 · 오른손을 초록 영역에 맞추세요');
            }}
          />
        ) : (
          <View style={styles.practiceRoot}>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.buildBadge}>FOCUS V8 · v21 · 마이크 OFF</Text>
                <Text style={styles.headerTitle}>집중교정</Text>
              </View>
              <Pressable onPress={() => void stopLesson(true)} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>닫기</Text>
              </Pressable>
            </View>

            <View style={styles.modeRow}>
              {FOCUS_MODE_OPTIONS.map((option) => (
                <Pressable
                  key={option.id}
                  disabled={running}
                  onPress={() => setFocusMode(option.id)}
                  style={[styles.modeButton, focusMode === option.id && styles.modeButtonActive, running && styles.disabled]}
                >
                  <Text style={[styles.modeButtonText, focusMode === option.id && styles.modeButtonTextActive]}>
                    {option.label.replace(' 모드', '').replace('왼손·코드', '왼손')}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.primaryControlRow}>
              <Pressable
                onPress={() => running ? void stopLesson(false) : void startLesson()}
                style={[styles.startButton, running && styles.stopButton]}
              >
                <Text style={styles.startButtonText}>{running ? `종료·저장 ${formatTime(elapsedSeconds)}` : '레슨 시작'}</Text>
                <Text style={styles.startButtonSub} numberOfLines={1}>
                  {running ? '메트로놈·궤적 비교 실행 중' : preset.title}
                </Text>
              </Pressable>
              <View style={styles.bpmBox}>
                <Pressable onPress={() => void applyBpm(bpm - 5)} style={styles.bpmAdjust}><Text style={styles.bpmAdjustText}>−</Text></Pressable>
                <View style={styles.bpmCopy}><Text style={styles.bpmNumber}>{bpm}</Text><Text style={styles.bpmUnit}>BPM</Text></View>
                <Pressable onPress={() => void applyBpm(bpm + 5)} style={styles.bpmAdjust}><Text style={styles.bpmAdjustText}>＋</Text></Pressable>
              </View>
            </View>

            <View style={styles.cameraStage}>
              <View style={[styles.cameraShell, { width: cameraSize.width, height: cameraSize.height }]}>
                <FocusCoachCameraV7
                  coachingActive={running}
                  category={preset.category}
                  cameraFocus={preset.cameraFocus}
                  initialFacing={cameraFacing}
                  onNeedCalibration={(facing) => void requestCalibration(facing)}
                  onMotionSample={handleMotionSample}
                  onAcceptedFrame={() => {
                    if (running) setAcceptedFrames((value) => value + 1);
                  }}
                  onFrameCount={setCapturedFrames}
                  onStatus={setCameraStatus}
                  onHandLockChange={handleSubjectLock}
                />
              </View>
            </View>

            <View style={styles.recognitionStrip}>
              <View style={[styles.statusDot, subjectLocked && styles.statusDotReady]} />
              <View style={styles.recognitionCopy}>
                <Text style={styles.recognitionTitle}>{subjectLocked ? `${label} 인식 완료` : `${label} 인식 대기`}</Text>
                <Text style={styles.recognitionDetail} numberOfLines={2}>{cameraStatus}</Text>
              </View>
              <Text style={styles.frameCount}>{acceptedFrames}/{FOCUS_V8_MIN_EVIDENCE_FRAMES}</Text>
            </View>

            <ScrollView
              style={styles.feedbackScroll}
              contentContainerStyle={styles.feedbackContent}
              showsVerticalScrollIndicator
            >
              {!coachingAllowed ? (
                <View style={[styles.feedbackPanel, styles.feedbackWaiting]}>
                  <Text style={styles.feedbackEyebrow}>판정 대기</Text>
                  <Text style={styles.feedbackTitle}>{waitingMessage}</Text>
                  <Text style={styles.feedbackBody}>현재 화면과 현재 세션에서 확인한 관절 증거만 사용합니다. 마이크·이전 세션 값·추측 피드백은 사용하지 않습니다.</Text>
                </View>
              ) : trajectory ? (
                <View style={[styles.feedbackPanel, feedbackTone(trajectory)]}>
                  <Text style={styles.feedbackEyebrow}>실시간 궤적 코치</Text>
                  <Text style={styles.feedbackTitle}>{trajectory.title}</Text>
                  <Text style={styles.sectionLabel}>관찰</Text>
                  <Text style={styles.feedbackBody}>{trajectory.observation}</Text>
                  <Text style={styles.sectionLabel}>지금 수정</Text>
                  <Text style={styles.feedbackBody}>{trajectory.correction}</Text>
                  <Text style={styles.sectionLabel}>보강훈련</Text>
                  <Text style={styles.feedbackBody}>{trajectory.reinforcement}</Text>
                  <View style={styles.metricsRow}>
                    <Text style={styles.metric}>현재 {trajectory.currentBpm} BPM</Text>
                    <Text style={styles.metric}>안정 {trajectory.lastStableBpm} BPM</Text>
                    <Text style={styles.metric}>{trajectory.deviationPercent == null ? '기준 수집' : `편차 ${trajectory.deviationPercent}%`}</Text>
                  </View>
                </View>
              ) : (
                <View style={[styles.feedbackPanel, styles.feedbackWaiting]}>
                  <Text style={styles.feedbackEyebrow}>기준 궤적 수집</Text>
                  <Text style={styles.feedbackTitle}>같은 동작을 느린 속도로 반복하세요.</Text>
                  <Text style={styles.feedbackBody}>충분한 연속 궤적이 쌓인 뒤에만 속도 유지 여부와 보강훈련을 표시합니다.</Text>
                </View>
              )}

              {!running && matchingPresets.length > 1 ? (
                <Pressable onPress={cycleRoutine} style={styles.nextRoutineButton}>
                  <Text style={styles.nextRoutineLabel}>다음 루틴</Text>
                  <Text style={styles.nextRoutineTitle} numberOfLines={1}>{preset.title}</Text>
                </Pressable>
              ) : null}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {savedMessage ? <Text style={styles.savedText}>{savedMessage}</Text> : null}
              <View style={styles.bottomSpacer} />
            </ScrollView>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  practiceRoot: { flex: 1, backgroundColor: '#0d1117', paddingBottom: Platform.OS === 'android' ? 14 : 8 },
  loadingSurface: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117' },
  loadingBuild: { color: '#7ee787', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  loadingText: { color: '#ffffff', fontSize: 18, fontWeight: '900', marginTop: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  closeOnly: { minHeight: 48, borderRadius: 13, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 16 },
  closeOnlyText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },

  calibrationRoot: { flex: 1, backgroundColor: '#000000' },
  calibrationVersionPatch: { position: 'absolute', top: 66, alignSelf: 'center', minWidth: 190, height: 24, borderRadius: 8, backgroundColor: 'rgba(13,17,23,0.98)', alignItems: 'center', justifyContent: 'center', zIndex: 90, paddingHorizontal: 10 },
  calibrationVersionText: { color: '#7ee787', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },

  header: { minHeight: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#30363d', backgroundColor: '#161b22' },
  headerCopy: { flex: 1 },
  buildBadge: { color: '#7ee787', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900', marginTop: 1 },
  closeButton: { minWidth: 62, minHeight: 38, borderRadius: 11, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },

  modeRow: { minHeight: 44, flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#0d1117' },
  modeButton: { flex: 1, minHeight: 34, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  modeButtonActive: { backgroundColor: '#1f6feb', borderColor: '#79c0ff' },
  modeButtonText: { color: '#b1bac4', fontSize: 9, fontWeight: '900' },
  modeButtonTextActive: { color: '#ffffff' },
  disabled: { opacity: 0.48 },

  primaryControlRow: { minHeight: 66, flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#0d1117' },
  startButton: { flex: 1, minHeight: 54, borderRadius: 14, backgroundColor: '#238636', borderWidth: 1, borderColor: '#7ee787', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  stopButton: { backgroundColor: '#b62324', borderColor: '#ffb4ad' },
  startButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  startButtonSub: { color: '#e6edf3', fontSize: 8, fontWeight: '700', marginTop: 3, textAlign: 'center' },
  bpmBox: { width: 112, minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  bpmAdjust: { width: 32, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', backgroundColor: '#21262d' },
  bpmAdjustText: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  bpmCopy: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bpmNumber: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  bpmUnit: { color: '#8b949e', fontSize: 7, fontWeight: '900' },

  cameraStage: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#090c10', paddingHorizontal: 10 },
  cameraShell: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d' },

  recognitionStrip: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, paddingVertical: 7, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22' },
  statusDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#d29922', borderWidth: 2, borderColor: '#f2cc60' },
  statusDotReady: { backgroundColor: '#238636', borderColor: '#7ee787' },
  recognitionCopy: { flex: 1 },
  recognitionTitle: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  recognitionDetail: { color: '#b1bac4', fontSize: 8, lineHeight: 12, marginTop: 2 },
  frameCount: { color: '#79c0ff', fontSize: 11, fontWeight: '900' },

  feedbackScroll: { flex: 1, minHeight: 80, backgroundColor: '#0d1117' },
  feedbackContent: { paddingHorizontal: 10, paddingTop: 9, paddingBottom: 28 },
  feedbackPanel: { borderRadius: 14, borderWidth: 1, padding: 13 },
  feedbackWaiting: { backgroundColor: '#161b22', borderColor: '#30363d' },
  feedbackGood: { backgroundColor: '#0f2d1c', borderColor: '#2ea043' },
  feedbackBad: { backgroundColor: '#3a1718', borderColor: '#da3633' },
  feedbackEyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  feedbackTitle: { color: '#ffffff', fontSize: 14, lineHeight: 20, fontWeight: '900', marginTop: 4 },
  feedbackBody: { color: '#d8dee4', fontSize: 10, lineHeight: 16, marginTop: 4 },
  sectionLabel: { color: '#8b949e', fontSize: 8, fontWeight: '900', marginTop: 9 },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  metric: { color: '#ffffff', backgroundColor: '#21262d', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 8, fontWeight: '800', overflow: 'hidden' },
  nextRoutineButton: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#161b22', justifyContent: 'center', paddingHorizontal: 12, marginTop: 9 },
  nextRoutineLabel: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  nextRoutineTitle: { color: '#ffffff', fontSize: 10, fontWeight: '800', marginTop: 2 },
  errorText: { color: '#ffb4ad', fontSize: 10, lineHeight: 15, fontWeight: '800', marginTop: 9 },
  savedText: { color: '#7ee787', fontSize: 10, fontWeight: '900', marginTop: 9 },
  bottomSpacer: { height: 12 },
});
