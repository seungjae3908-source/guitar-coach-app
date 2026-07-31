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
  View,
} from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import { getPracticePresetsForMode, type PracticePreset } from '../config/personal-practice-presets';
import {
  categoryMatchesFocusMode,
  FOCUS_MODE_OPTIONS,
  focusModeForCategory,
  type FocusPracticeMode,
} from '../services/focus-practice-mode';
import {
  isAdvancedMetronomeAvailable,
  startAdvancedMetronomeAsync,
  stopAdvancedMetronomeAsync,
  updateAdvancedMetronomeAsync,
} from '../modules/guitar-coach-metronome';
import { clearLatestLiveAnalysisFrames } from '../services/analysis-stream';
import {
  clearLiveCoachFeedback,
  subscribeLiveCoachFeedbackStack,
  type LiveCoachFeedback,
} from '../services/live-coach-feedback';
import { clearLivePracticeContext, setLivePracticeContext } from '../services/practice-session-context';
import { savePracticeSession, type PracticeSessionRecord, type SessionIssue } from '../services/practice-session-store';
import {
  TrajectorySpeedCoach,
  type MotionSample,
  type TrajectoryCoachResult,
} from '../services/trajectory-speed-engine';
import CalibratedCoachCamera from './CalibratedCoachCamera';

function formatTime(seconds: number) {
  const minute = Math.floor(seconds / 60);
  const second = seconds % 60;
  return `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function visualStatusColor(status: LiveCoachFeedback['status']) {
  if (status === 'success') return '#2ea043';
  if (status === 'warning') return '#da3633';
  if (status === 'correction') return '#9e6a03';
  return '#1f6feb';
}

function trajectoryIssue(result: TrajectoryCoachResult | null): SessionIssue[] {
  if (!result || result.state !== 'broken') return [];
  return [{
    id: 'trajectory-broken',
    title: result.title,
    count: Math.max(1, result.brokenCycles),
    severity: 'warn',
    confidencePercent: result.confidencePercent,
  }];
}

export default function PracticeSessionRunnerV6({
  mode,
  voiceCoachEnabled,
  onClose,
}: {
  mode: GuitarModeId;
  voiceCoachEnabled: boolean;
  onClose: () => void;
}) {
  const presets = useMemo(() => getPracticePresetsForMode(mode), [mode]);
  const initialPreset = presets[0] ?? null;
  const [focusMode, setFocusMode] = useState<FocusPracticeMode>(focusModeForCategory(initialPreset?.category));
  const matchingPresets = useMemo(
    () => presets.filter((preset) => categoryMatchesFocusMode(preset.category, focusMode)),
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
  const [cameraStatus, setCameraStatus] = useState('카메라 연결 대기');
  const [calibrationReady, setCalibrationReady] = useState(false);
  const [acceptedFrames, setAcceptedFrames] = useState(0);
  const [capturedFrames, setCapturedFrames] = useState(0);
  const [trajectory, setTrajectory] = useState<TrajectoryCoachResult | null>(null);
  const [visualFeedback, setVisualFeedback] = useState<LiveCoachFeedback | null>(null);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const startedAtRef = useRef<number | null>(null);
  const bpmRef = useRef(bpm);
  const trajectoryRef = useRef<TrajectorySpeedCoach | null>(null);
  const finalTrajectoryRef = useRef<TrajectoryCoachResult | null>(null);

  useEffect(() => {
    const next = matchingPresets[0];
    if (!next) return;
    setPresetId(next.id);
    setBpm(next.startBpm);
    bpmRef.current = next.startBpm;
    setCalibrationReady(next.cameraFocus !== 'right-hand');
    setAcceptedFrames(0);
    setCapturedFrames(0);
    setTrajectory(null);
    setVisualFeedback(null);
  }, [focusMode, matchingPresets]);

  useEffect(() => {
    if (!preset || running) return;
    setBpm(preset.startBpm);
    bpmRef.current = preset.startBpm;
    setCalibrationReady(preset.cameraFocus !== 'right-hand');
    setAcceptedFrames(0);
    setCapturedFrames(0);
    setTrajectory(null);
    setVisualFeedback(null);
    setSavedMessage('');
  }, [preset?.id, running]);

  useEffect(() => subscribeLiveCoachFeedbackStack((snapshot) => {
    if (!running || !preset) {
      setVisualFeedback(null);
      return;
    }
    const next = snapshot.active.find((feedback) => (
      !feedback.id.startsWith('sound-')
      && feedback.category === preset.category
    )) ?? null;
    setVisualFeedback(next);
  }), [preset, running]);

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

  const applyBpm = async (nextBpm: number) => {
    if (!preset) return;
    const safe = Math.min(preset.targetBpm, Math.max(35, Math.round(nextBpm)));
    bpmRef.current = safe;
    setBpm(safe);
    trajectoryRef.current?.updateBpm(safe, Date.now());
    if (running && isAdvancedMetronomeAvailable) {
      await updateAdvancedMetronomeAsync(safe, 4, 2, true, false, 0);
    }
    if (running && startedAtRef.current) {
      setLivePracticeContext({
        active: true,
        guitarMode: mode,
        presetId: preset.id,
        title: preset.title,
        goal: preset.goal,
        pattern: preset.pattern,
        category: preset.category,
        cameraFocus: preset.cameraFocus,
        bpm: safe,
        targetBpm: preset.targetBpm,
        pulsesPerBeat: 2,
        microphoneEnabled: false,
        calibrationConfidencePercent: null,
        startedAt: startedAtRef.current,
      });
    }
  };

  const startLesson = async () => {
    if (!preset || running) return;
    if (preset.cameraFocus === 'right-hand' && !calibrationReady) {
      setError('카메라에서 사운드홀과 브리지 위치를 먼저 지정하세요.');
      return;
    }
    setError('');
    setSavedMessage('');
    setAcceptedFrames(0);
    setCapturedFrames(0);
    setVisualFeedback(null);
    clearLatestLiveAnalysisFrames();
    clearLiveCoachFeedback();
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    setElapsedSeconds(0);
    const coach = new TrajectorySpeedCoach({
      startBpm: bpmRef.current,
      targetBpm: preset.targetBpm,
      pulsesPerBeat: 2,
      pattern: preset.pattern,
    });
    trajectoryRef.current = coach;
    const initial = coach.start(startedAt);
    finalTrajectoryRef.current = initial;
    setTrajectory(initial);
    setLivePracticeContext({
      active: true,
      guitarMode: mode,
      presetId: preset.id,
      title: preset.title,
      goal: preset.goal,
      pattern: preset.pattern,
      category: preset.category,
      cameraFocus: preset.cameraFocus,
      bpm: bpmRef.current,
      targetBpm: preset.targetBpm,
      pulsesPerBeat: 2,
      microphoneEnabled: false,
      calibrationConfidencePercent: null,
      startedAt,
    });
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
        id: `${startedAt}-${preset.id}-roi`,
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
        issues: trajectoryIssue(final),
        nextAssignment: final?.reinforcement || '오른손이 5프레임 연속 인식되는 위치를 유지한 뒤 기준 궤적을 다시 수집하세요.',
        cameraMode: preset.cameraFocus,
        microphoneUsed: false,
        metronomeUsed: isAdvancedMetronomeAvailable,
        notes: `ROI 검증 세션 · 캡처 ${capturedFrames} · 승인 ${acceptedFrames} · 음성 ${voiceCoachEnabled ? '켜짐' : '꺼짐'} · 마이크 분석 미사용`,
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
  };

  if (!preset) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>집중교정 루틴이 없습니다</Text>
        <Pressable onPress={onClose} style={styles.closeOnly}><Text style={styles.closeOnlyText}>닫기</Text></Pressable>
      </View>
    );
  }

  const startDisabled = !running && preset.cameraFocus === 'right-hand' && !calibrationReady;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => void stopLesson(true)}>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0d1117" translucent={false} />

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>{mode === 'acoustic' ? '통기타' : '일렉기타'} · ROI 검증 집중교정</Text>
            <Text style={styles.title} numberOfLines={1}>{preset.title}</Text>
          </View>
          <Pressable onPress={() => void stopLesson(true)} style={styles.closeButton}>
            <Text style={styles.closeText}>닫기</Text>
          </Pressable>
        </View>

        <ScrollView horizontal style={styles.modeScroll} contentContainerStyle={styles.modeRow} showsHorizontalScrollIndicator={false}>
          {FOCUS_MODE_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              disabled={running}
              onPress={() => setFocusMode(option.id)}
              style={[styles.modeButton, focusMode === option.id && styles.modeButtonActive]}
            >
              <Text style={[styles.modeText, focusMode === option.id && styles.modeTextActive]}>{option.label.replace(' 모드', '')}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView horizontal style={styles.presetScroll} contentContainerStyle={styles.presetRow} showsHorizontalScrollIndicator={false}>
          {matchingPresets.map((item) => (
            <Pressable
              key={item.id}
              disabled={running}
              onPress={() => setPresetId(item.id)}
              style={[styles.presetButton, preset.id === item.id && styles.presetButtonActive]}
            >
              <Text style={[styles.presetText, preset.id === item.id && styles.presetTextActive]} numberOfLines={1}>{item.title}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.controlBar}>
          <Pressable
            disabled={startDisabled}
            onPress={() => running ? void stopLesson(false) : void startLesson()}
            style={[styles.lessonButton, running && styles.lessonButtonStop, startDisabled && styles.lessonButtonDisabled]}
          >
            <Text style={styles.lessonButtonText}>
              {running ? `종료·저장 ${formatTime(elapsedSeconds)}` : startDisabled ? '사운드홀·브리지 지정 후 시작' : '레슨 시작'}
            </Text>
          </Pressable>
          <Pressable onPress={() => void applyBpm(bpm - 5)} style={styles.bpmButton}><Text style={styles.bpmButtonText}>−5</Text></Pressable>
          <View style={styles.bpmValue}><Text style={styles.bpmNumber}>{bpm}</Text><Text style={styles.bpmUnit}>BPM</Text></View>
          <Pressable onPress={() => void applyBpm(bpm + 5)} style={styles.bpmButton}><Text style={styles.bpmButtonText}>+5</Text></Pressable>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          <View style={styles.cameraArea}>
            <CalibratedCoachCamera
              coachingActive={running}
              category={preset.category}
              cameraFocus={preset.cameraFocus}
              onMotionSample={handleMotionSample}
              onAcceptedFrame={() => setAcceptedFrames((value) => value + 1)}
              onFrameCount={setCapturedFrames}
              onStatus={setCameraStatus}
              onCalibrationReady={setCalibrationReady}
            />
          </View>

          <View style={styles.evidenceCard}>
            <View style={styles.evidenceTop}>
              <Text style={styles.cardLabel}>실제 인식 상태</Text>
              <Text style={styles.evidenceCount}>캡처 {capturedFrames} · 승인 {acceptedFrames}</Text>
            </View>
            <Text style={styles.evidenceTitle}>{cameraStatus}</Text>
            <Text style={styles.evidenceText}>
              {acceptedFrames > 0
                ? '승인된 오른손 프레임만 궤적과 피드백에 사용합니다.'
                : '손이 연속으로 확인되기 전에는 자세·간격·궤적을 평가하지 않습니다.'}
            </Text>
          </View>

          {running && trajectory ? (
            <View style={styles.trajectoryCard}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardLabel}>속도·궤적</Text>
                <Text style={styles.confidence}>{trajectory.confidencePercent}%</Text>
              </View>
              <Text style={styles.cardTitle}>{trajectory.title}</Text>
              <Text style={styles.line}><Text style={styles.lineKey}>관찰 </Text>{trajectory.observation}</Text>
              <Text style={styles.line}><Text style={styles.lineKey}>원인 </Text>{trajectory.cause}</Text>
              <Text style={styles.line}><Text style={styles.lineKey}>교정 </Text>{trajectory.correction}</Text>
              <Text style={styles.line}><Text style={styles.lineKey}>보강 </Text>{trajectory.reinforcement}</Text>
            </View>
          ) : (
            <View style={styles.waitCard}>
              <Text style={styles.cardTitle}>{running ? '기준 궤적 표본 대기' : '레슨 시작 전 자동 추적'}</Text>
              <Text style={styles.evidenceText}>{running
                ? '같은 오른손이 연속 인식된 뒤에만 느린 기준 궤적 수집을 시작합니다.'
                : '관절 위치만 확인하며 자세 점수와 교정 문장은 만들지 않습니다.'}</Text>
            </View>
          )}

          {running && visualFeedback ? (
            <View style={[styles.feedbackCard, { borderColor: visualStatusColor(visualFeedback.status) }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardLabel}>카메라 세부 피드백</Text>
                <Text style={styles.confidence}>{visualFeedback.confidencePercent}%</Text>
              </View>
              <Text style={styles.cardTitle}>{visualFeedback.title}</Text>
              <Text style={styles.line}><Text style={styles.lineKey}>근거 </Text>{visualFeedback.evidence}</Text>
              <Text style={styles.line}><Text style={styles.lineKey}>교정 </Text>{visualFeedback.instruction}</Text>
              <Text style={styles.line}><Text style={styles.lineKey}>다음 목표 </Text>{visualFeedback.nextGoal}</Text>
            </View>
          ) : null}

          <View style={styles.micOffCard}>
            <Text style={styles.micOffTitle}>마이크 분석 완전 OFF</Text>
            <Text style={styles.micOffText}>이번 검증 빌드에서는 무음 오판 경로를 없애기 위해 강약·클리핑 판정과 마이크 경고를 실행하지 않습니다.</Text>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {savedMessage ? <Text style={styles.savedText}>{savedMessage}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117', paddingTop: Platform.OS === 'android' ? Math.max(0, StatusBar.currentHeight ?? 0) : 0 },
  empty: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  closeOnly: { marginTop: 14, minHeight: 42, borderRadius: 11, backgroundColor: '#21262d', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  closeOnlyText: { color: '#ffffff', fontWeight: '900' },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#30363d', backgroundColor: '#0d1117' },
  headerText: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  title: { color: '#ffffff', fontSize: 17, fontWeight: '900', marginTop: 3 },
  closeButton: { minWidth: 60, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  modeScroll: { maxHeight: 50, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  modeRow: { paddingHorizontal: 9, paddingVertical: 6, gap: 6 },
  modeButton: { minWidth: 78, minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  modeButtonActive: { borderColor: '#2ea043', backgroundColor: '#14251a' },
  modeText: { color: '#8b949e', fontSize: 9, fontWeight: '900' },
  modeTextActive: { color: '#7ee787' },
  presetScroll: { maxHeight: 48, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  presetRow: { paddingHorizontal: 9, paddingVertical: 6, gap: 6 },
  presetButton: { minWidth: 132, maxWidth: 210, minHeight: 34, borderRadius: 9, backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  presetButtonActive: { backgroundColor: '#1f6feb' },
  presetText: { color: '#8b949e', fontSize: 8, fontWeight: '900' },
  presetTextActive: { color: '#ffffff' },
  controlBar: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#30363d', backgroundColor: '#11161d' },
  lessonButton: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  lessonButtonStop: { backgroundColor: '#da3633' },
  lessonButtonDisabled: { backgroundColor: '#30363d' },
  lessonButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900', textAlign: 'center' },
  bpmButton: { width: 45, minHeight: 48, borderRadius: 11, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  bpmButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  bpmValue: { width: 62, minHeight: 48, borderRadius: 11, backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center' },
  bpmNumber: { color: '#7ee787', fontSize: 20, lineHeight: 21, fontWeight: '900' },
  bpmUnit: { color: '#8b949e', fontSize: 6, fontWeight: '900' },
  body: { flex: 1, backgroundColor: '#0d1117' },
  bodyContent: { paddingBottom: 72 },
  cameraArea: { width: '100%', aspectRatio: 3 / 4, minHeight: 440, maxHeight: 620, backgroundColor: '#000000' },
  evidenceCard: { margin: 10, marginBottom: 0, borderRadius: 14, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#111d2f', padding: 12 },
  evidenceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardLabel: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  evidenceCount: { color: '#7ee787', fontSize: 8, fontWeight: '900' },
  evidenceTitle: { color: '#ffffff', fontSize: 13, fontWeight: '900', marginTop: 5 },
  evidenceText: { color: '#b1bac4', fontSize: 9, lineHeight: 15, marginTop: 5 },
  trajectoryCard: { margin: 10, marginBottom: 0, borderRadius: 14, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#111820', padding: 12 },
  waitCard: { margin: 10, marginBottom: 0, borderRadius: 14, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 12 },
  feedbackCard: { margin: 10, marginBottom: 0, borderRadius: 14, borderWidth: 2, backgroundColor: '#161b22', padding: 12 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  confidence: { color: '#7ee787', fontSize: 10, fontWeight: '900' },
  cardTitle: { color: '#ffffff', fontSize: 14, fontWeight: '900', marginTop: 5 },
  line: { color: '#d0d7de', fontSize: 9, lineHeight: 15, marginTop: 5 },
  lineKey: { color: '#7ee787', fontWeight: '900' },
  micOffCard: { margin: 10, borderRadius: 14, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#161b22', padding: 12 },
  micOffTitle: { color: '#f2cc60', fontSize: 11, fontWeight: '900' },
  micOffText: { color: '#b1bac4', fontSize: 8, lineHeight: 14, marginTop: 4 },
  errorText: { color: '#ffb4ad', fontSize: 9, lineHeight: 14, textAlign: 'center', paddingHorizontal: 12, marginTop: 8 },
  savedText: { color: '#7ee787', fontSize: 9, fontWeight: '900', textAlign: 'center', marginTop: 8 },
});
