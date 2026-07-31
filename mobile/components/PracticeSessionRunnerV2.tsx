import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import { getPracticePresetsForMode, PracticePreset } from '../config/personal-practice-presets';
import {
  categoryMatchesFocusMode,
  FOCUS_MODE_OPTIONS,
  focusModeForCategory,
  type FocusPracticeMode,
} from '../services/focus-practice-mode';
import {
  getLatestNativeAudioReadingAsync,
  isNativeAudioAnalysisAvailable,
  startNativeAudioAnalysisAsync,
  stopNativeAudioAnalysisAsync,
} from '../modules/guitar-coach-audio';
import {
  getAdvancedMetronomeTimingStateAsync,
  isAdvancedMetronomeAvailable,
  startAdvancedMetronomeAsync,
  stopAdvancedMetronomeAsync,
} from '../modules/guitar-coach-metronome';
import {
  clearLatestLiveAnalysisFrames,
  subscribeLiveAnalysis,
} from '../services/analysis-stream';
import { loadBestCameraCalibration } from '../services/camera-calibration-store';
import { clearLiveCoachFeedback } from '../services/live-coach-feedback';
import {
  LivePracticeSessionAccumulator,
  LiveSessionSnapshot,
} from '../services/live-practice-session';
import {
  clearLivePracticeContext,
  setLivePracticeContext,
} from '../services/practice-session-context';
import {
  decideNextPracticeStep,
  PracticeAttempt,
  ProgressionDecision,
} from '../services/practice-progression-engine';
import {
  loadPracticeSessions,
  PracticeSessionRecord,
  savePracticeSession,
} from '../services/practice-session-store';
import LiveTeacherPanel from './LiveTeacherPanel';
import SessionCoachCamera from './SessionCoachCamera';

const EMPTY_SNAPSHOT: LiveSessionSnapshot = {
  averageScore: null,
  bestScore: null,
  confidencePercent: 0,
  stableSeconds: 0,
  aiMistakes: 0,
  issues: [],
  sampleCounts: { pose: 0, hand: 0, audio: 0, validScore: 0 },
  lastStringNumber: null,
  timingOffsetMs: null,
  timingJitterMs: null,
};

const DURATION_OPTIONS = [30, 60, 120, 180, 300, 600];
const QUICK_BPM_OPTIONS = [40, 50, 60, 70, 80, 90, 100, 120];

function pulsesForPreset(preset: PracticePreset): 1 | 2 | 3 | 4 {
  if (preset.pattern?.toLowerCase().includes('p i m')) return 3;
  if (preset.category === 'arpeggio') return 3;
  if (
    preset.category === 'strumming' ||
    preset.category === 'alternatePicking' ||
    preset.category === 'downPicking' ||
    preset.category === 'palmMute'
  ) return 2;
  return 1;
}

function formatElapsed(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds}초`;
  if (seconds % 60 === 0) return `${seconds / 60}분`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

function timingLabel(offset: number | null) {
  if (offset == null) return '-';
  if (Math.abs(offset) <= 8) return '정박';
  return offset < 0 ? `${Math.abs(offset)}ms 빠름` : `${offset}ms 늦음`;
}

function sessionToAttempt(session: PracticeSessionRecord): PracticeAttempt | null {
  if (!session.presetId) return null;
  return {
    id: session.id,
    presetId: session.presetId,
    guitarMode: session.guitarMode,
    category: session.category,
    startedAt: session.startedAt,
    durationSeconds: session.durationSeconds,
    bpm: session.bpmEnd,
    score: session.averageScore,
    confidencePercent: session.averageConfidencePercent,
    manualMistakes: session.manualMistakes,
    aiMistakes: session.aiMistakes,
    stableStreak: session.stableSeconds >= 12 ? 3 : session.stableSeconds >= 6 ? 2 : session.stableSeconds >= 2 ? 1 : 0,
    painOrTensionReported: session.notes?.includes('긴장 보고') ?? false,
    repeatedIssueTags: session.issues.map((issue) => issue.title),
  };
}

function SmallOption({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.smallOption, active && styles.smallOptionActive, disabled && styles.disabled]}
    >
      <Text style={[styles.smallOptionText, active && styles.smallOptionTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function PracticeSessionRunnerV2({
  mode,
  voiceCoachEnabled,
  onClose,
}: {
  mode: GuitarModeId;
  voiceCoachEnabled: boolean;
  onClose?: () => void;
}) {
  const presets = useMemo(() => getPracticePresetsForMode(mode), [mode]);
  const [focusMode, setFocusMode] = useState<FocusPracticeMode>(focusModeForCategory(presets[0]?.category));
  const availableFocusModes = useMemo(
    () => FOCUS_MODE_OPTIONS.filter((option) => presets.some((item) => categoryMatchesFocusMode(item.category, option.id))),
    [presets],
  );
  const focusPresets = useMemo(
    () => presets.filter((item) => categoryMatchesFocusMode(item.category, focusMode)),
    [focusMode, presets],
  );
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? '');
  const preset = focusPresets.find((item) => item.id === selectedPresetId) ?? focusPresets[0] ?? presets[0];
  const [bpm, setBpm] = useState(preset?.startBpm ?? 70);
  const [sessionDurationSeconds, setSessionDurationSeconds] = useState(preset?.durationSeconds ?? 180);
  const [autoStopEnabled, setAutoStopEnabled] = useState(true);
  const [accentEnabled, setAccentEnabled] = useState(true);
  const [running, setRunning] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [manualMistakes, setManualMistakes] = useState(0);
  const [tensionReported, setTensionReported] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot>(EMPTY_SNAPSHOT);
  const [decision, setDecision] = useState<ProgressionDecision | null>(null);
  const [status, setStatus] = useState('루틴과 시간을 고른 뒤 시작하세요.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [calibrationConfidence, setCalibrationConfidence] = useState<number | null>(null);
  const accumulatorRef = useRef<LivePracticeSessionAccumulator | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const lastSnapshotAtRef = useRef(0);
  const autoStopTriggeredRef = useRef(false);

  const pulsesPerBeat = preset ? pulsesForPreset(preset) : 1;
  const remainingSeconds = autoStopEnabled
    ? Math.max(0, sessionDurationSeconds - elapsedSeconds)
    : null;
  const progressPercent = autoStopEnabled
    ? Math.min(100, Math.round(elapsedSeconds / Math.max(1, sessionDurationSeconds) * 100))
    : 0;

  useEffect(() => {
    const first = presets[0];
    const nextFocusMode = focusModeForCategory(first?.category);
    const firstInFocus = presets.find((item) => categoryMatchesFocusMode(item.category, nextFocusMode)) ?? first;
    setFocusMode(nextFocusMode);
    setSelectedPresetId(firstInFocus?.id ?? '');
    setBpm(firstInFocus?.startBpm ?? 70);
    setSessionDurationSeconds(first?.durationSeconds ?? 180);
    setSnapshot(EMPTY_SNAPSHOT);
    setDecision(null);
    setCalibrationConfidence(null);
    clearLivePracticeContext();
    clearLiveCoachFeedback();
  }, [mode, presets]);

  useEffect(() => {
    if (!preset || running) return;
    setBpm(preset.startBpm);
    setSessionDurationSeconds(preset.durationSeconds);
    setManualMistakes(0);
    setTensionReported(false);
    setSnapshot(EMPTY_SNAPSHOT);
    setDecision(null);
    setCalibrationConfidence(null);
    setStatus('루틴과 시간을 고른 뒤 시작하세요.');
    clearLiveCoachFeedback();
  }, [preset, running]);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    const accumulator = accumulatorRef.current;
    if (!running || !accumulator) return;
    accumulator.addFrame(frame);
    const now = Date.now();
    if (now - lastSnapshotAtRef.current >= 450) {
      lastSnapshotAtRef.current = now;
      setSnapshot(accumulator.snapshot());
    }
  }), [running]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        await getAdvancedMetronomeTimingStateAsync();
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '메트로놈 시각을 읽지 못했습니다.');
      } finally {
        if (!cancelled) timer = setTimeout(poll, 70);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [running]);

  useEffect(() => {
    if (!running || !microphoneEnabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        await getLatestNativeAudioReadingAsync();
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '마이크 분석값을 읽지 못했습니다.');
      } finally {
        if (!cancelled) timer = setTimeout(poll, 90);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [microphoneEnabled, running]);

  const selectFocusMode = (nextMode: FocusPracticeMode) => {
    if (running) return;
    const first = presets.find((item) => categoryMatchesFocusMode(item.category, nextMode));
    if (!first) return;
    setFocusMode(nextMode);
    setSelectedPresetId(first.id);
    setStatus(`${FOCUS_MODE_OPTIONS.find((item) => item.id === nextMode)?.label ?? '집중 모드'}를 선택했습니다.`);
    setError('');
  };

  const requestMicrophonePermission = async () => {
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: '연주 분석 마이크 권한',
        message: '탄현 시각과 메트로놈 클릭의 차이를 휴대폰 안에서 분석합니다.',
        buttonPositive: '허용',
        buttonNegative: '취소',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const start = async () => {
    if (!preset || busy) return;
    setBusy(true);
    setError('');
    setStatus('카메라·메트로놈·마이크 준비 중…');
    try {
      if (!isAdvancedMetronomeAvailable) throw new Error('고급 메트로놈 모듈이 APK에 없습니다.');
      const calibration = await loadBestCameraCalibration({
        guitarMode: mode,
        cameraFacing: 'back',
        mirrored: false,
      });
      const calibrationPercent = calibration?.confidencePercent ?? null;
      setCalibrationConfidence(calibrationPercent);

      if (microphoneEnabled) {
        if (!isNativeAudioAnalysisAvailable) throw new Error('마이크 분석 모듈이 APK에 없습니다.');
        const granted = await requestMicrophonePermission();
        if (!granted) throw new Error('마이크 권한이 허용되지 않았습니다.');
        await startNativeAudioAnalysisAsync(440);
      }

      clearLatestLiveAnalysisFrames();
      clearLiveCoachFeedback();
      accumulatorRef.current = new LivePracticeSessionAccumulator({
        category: preset.category,
        bpm,
        pulsesPerBeat,
        calibration,
      });
      startedAtRef.current = Date.now();
      autoStopTriggeredRef.current = false;
      setElapsedSeconds(0);
      setManualMistakes(0);
      setTensionReported(false);
      setSnapshot(EMPTY_SNAPSHOT);
      setDecision(null);

      setLivePracticeContext({
        active: true,
        guitarMode: mode,
        presetId: preset.id,
        title: preset.title,
        goal: preset.goal,
        pattern: preset.pattern,
        category: preset.category,
        cameraFocus: preset.cameraFocus,
        bpm,
        targetBpm: preset.targetBpm,
        pulsesPerBeat,
        microphoneEnabled,
        calibrationConfidencePercent: calibrationPercent,
        startedAt: startedAtRef.current,
      });

      await startAdvancedMetronomeAsync(bpm, 4, pulsesPerBeat, accentEnabled, false, 0);
      setRunning(true);
      setStatus(calibration
        ? `실시간 선생님 분석 중 · 촬영 보정 ${calibration.confidencePercent}% 적용`
        : '실시간 선생님 분석 중 · 보정 없는 항목은 판정 불가 처리');
    } catch (caught) {
      await stopAdvancedMetronomeAsync();
      await stopNativeAudioAnalysisAsync();
      accumulatorRef.current = null;
      startedAtRef.current = null;
      clearLivePracticeContext();
      clearLiveCoachFeedback();
      setRunning(false);
      setStatus('시작 실패');
      setError(caught instanceof Error ? caught.message : '집중 연습을 시작하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const stopAndSave = async (autoCompleted = false) => {
    if (!preset || !running || busy) return;
    setBusy(true);
    setError('');
    setStatus(autoCompleted ? '설정 시간이 끝나 기록을 계산하는 중…' : '종료하고 기록을 계산하는 중…');
    setRunning(false);
    clearLivePracticeContext();
    try {
      await stopAdvancedMetronomeAsync();
      await stopNativeAudioAnalysisAsync();
      const finalSnapshot = accumulatorRef.current?.snapshot() ?? EMPTY_SNAPSHOT;
      const endedAt = new Date();
      const startedAtMs = startedAtRef.current ?? endedAt.getTime();
      const durationSeconds = Math.max(1, Math.floor((endedAt.getTime() - startedAtMs) / 1000));
      const currentAttempt: PracticeAttempt = {
        id: `attempt-${endedAt.getTime()}`,
        presetId: preset.id,
        guitarMode: mode,
        category: preset.category,
        startedAt: new Date(startedAtMs).toISOString(),
        durationSeconds,
        bpm,
        score: finalSnapshot.averageScore,
        confidencePercent: finalSnapshot.confidencePercent,
        manualMistakes,
        aiMistakes: finalSnapshot.aiMistakes,
        stableStreak: finalSnapshot.stableSeconds >= 12 ? 3 : finalSnapshot.stableSeconds >= 6 ? 2 : finalSnapshot.stableSeconds >= 2 ? 1 : 0,
        painOrTensionReported: tensionReported,
        repeatedIssueTags: finalSnapshot.issues.map((issue) => issue.title),
      };
      const stored = await loadPracticeSessions();
      const attempts = stored.map(sessionToAttempt).filter((item): item is PracticeAttempt => Boolean(item));
      const nextDecision = decideNextPracticeStep(preset, [...attempts, currentAttempt]);
      const timingText = finalSnapshot.timingOffsetMs == null
        ? ''
        : ` · 박오차 ${timingLabel(finalSnapshot.timingOffsetMs)} · 흔들림 ${finalSnapshot.timingJitterMs ?? 0}ms`;
      const record: PracticeSessionRecord = {
        id: `session-${endedAt.getTime()}`,
        guitarMode: mode,
        category: preset.category,
        presetId: preset.id,
        title: preset.title,
        startedAt: currentAttempt.startedAt,
        endedAt: endedAt.toISOString(),
        durationSeconds,
        bpmStart: bpm,
        bpmEnd: bpm,
        averageScore: finalSnapshot.averageScore,
        bestScore: finalSnapshot.bestScore,
        averageConfidencePercent: finalSnapshot.confidencePercent,
        manualMistakes,
        aiMistakes: finalSnapshot.aiMistakes,
        stableSeconds: finalSnapshot.stableSeconds,
        issues: finalSnapshot.issues,
        nextAssignment: `${nextDecision.nextFocus} · 다음 ${nextDecision.nextBpm} BPM`,
        cameraMode: preset.cameraFocus,
        microphoneUsed: microphoneEnabled,
        metronomeUsed: true,
        notes: `${autoCompleted ? '설정 시간 완료 · ' : ''}${tensionReported ? '긴장 보고 · ' : ''}${nextDecision.reason}${timingText}`,
      };
      await savePracticeSession(record);
      setSnapshot(finalSnapshot);
      setDecision(nextDecision);
      setBpm(nextDecision.nextBpm);
      setStatus(finalSnapshot.averageScore == null
        ? '저장 완료 · 신뢰 가능한 표본이 부족해 점수는 제외했습니다.'
        : `저장 완료 · 평균 ${finalSnapshot.averageScore}점 · 다음 ${nextDecision.nextBpm} BPM`);
      accumulatorRef.current = null;
      startedAtRef.current = null;
      autoStopTriggeredRef.current = false;
    } catch (caught) {
      setStatus('기록 저장 실패');
      setError(caught instanceof Error ? caught.message : '연습 기록을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (!startedAt) return;
      const nextElapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setElapsedSeconds(nextElapsed);
      if (
        autoStopEnabled
        && nextElapsed >= sessionDurationSeconds
        && !autoStopTriggeredRef.current
      ) {
        autoStopTriggeredRef.current = true;
        void stopAndSave(true);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [autoStopEnabled, running, sessionDurationSeconds]);

  useEffect(() => () => {
    clearLivePracticeContext();
    clearLiveCoachFeedback();
    void stopAdvancedMetronomeAsync();
    void stopNativeAudioAnalysisAsync();
  }, []);

  if (!preset) {
    return <View style={styles.center}><Text style={styles.statusText}>등록된 개인 루틴이 없습니다.</Text></View>;
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
          <Text style={styles.eyebrow}>{mode === 'acoustic' ? '통기타' : '일렉기타'} · LIVE AI TEACHER</Text>
          <Text style={styles.title}>{preset.title}</Text>
          <Text style={styles.statusText}>{status}</Text>
        </View>
        {onClose ? (
          <Pressable disabled={running} onPress={onClose} style={[styles.closeButton, running && styles.disabled]}>
            <Text style={styles.closeText}>닫기</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.focusModeCard}>
        <Text style={styles.focusModeHeading}>집중 분석 모드</Text>
        <Text style={styles.focusModeGuide}>모드마다 카메라 속도와 손목·피크·손가락·줄 판정 기준을 따로 사용합니다.</Text>
        <View style={styles.focusModeRow}>
{availableFocusModes.map((item) => (
  <Pressable
    key={item.id}
    disabled={running}
    onPress={() => selectFocusMode(item.id)}
    style={[styles.focusModeButton, focusMode === item.id && styles.focusModeButtonActive, running && styles.disabled]}
  >
    <Text style={[styles.focusModeLabel, focusMode === item.id && styles.focusModeLabelActive]}>{item.label}</Text>
    <Text style={styles.focusModeDetail}>{item.detail}</Text>
  </Pressable>
))}
        </View>
      </View>

      <ScrollView horizontal style={styles.presetScroll} contentContainerStyle={styles.presetRow} showsHorizontalScrollIndicator={false}>
        {focusPresets.map((item) => (
          <Pressable
            key={item.id}
            disabled={running}
            onPress={() => setSelectedPresetId(item.id)}
            style={[styles.presetChip, item.id === preset.id && styles.presetChipActive, running && styles.disabled]}
          >
            <Text style={[styles.presetChipText, item.id === preset.id && styles.presetChipTextActive]}>{item.title}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.lessonPlanCard}>
        <Text style={styles.lessonPlanTitle}>오늘의 한 가지 목표</Text>
        <Text style={styles.lessonPlanGoal}>{preset.goal}</Text>
        <View style={styles.lessonMetaRow}>
          <Text style={styles.lessonMeta}>{preset.pattern ? `패턴 ${preset.pattern}` : '동작 반복 루틴'}</Text>
          <Text style={styles.lessonMeta}>분할 {pulsesPerBeat}회/박</Text>
          <Text style={styles.lessonMeta}>목표 {preset.targetBpm} BPM</Text>
        </View>
      </View>

      <View style={styles.setupCard}>
        <Text style={styles.sectionTitle}>집중 연습 시간</Text>
        <View style={styles.optionWrap}>
          {DURATION_OPTIONS.map((value) => (
            <SmallOption
              key={value}
              label={durationLabel(value)}
              active={autoStopEnabled && sessionDurationSeconds === value}
              disabled={running}
              onPress={() => {
                setAutoStopEnabled(true);
                setSessionDurationSeconds(value);
              }}
            />
          ))}
          <SmallOption label="무제한" active={!autoStopEnabled} disabled={running} onPress={() => setAutoStopEnabled(false)} />
        </View>
        <View style={styles.customRow}>
          <SmallOption label="-1분" disabled={running || !autoStopEnabled} onPress={() => setSessionDurationSeconds((value) => Math.max(30, value - 60))} />
          <SmallOption label="-30초" disabled={running || !autoStopEnabled} onPress={() => setSessionDurationSeconds((value) => Math.max(30, value - 30))} />
          <Text style={styles.customValue}>{autoStopEnabled ? durationLabel(sessionDurationSeconds) : '직접 종료'}</Text>
          <SmallOption label="+30초" disabled={running || !autoStopEnabled} onPress={() => setSessionDurationSeconds((value) => Math.min(1_800, value + 30))} />
          <SmallOption label="+1분" disabled={running || !autoStopEnabled} onPress={() => setSessionDurationSeconds((value) => Math.min(1_800, value + 60))} />
        </View>

        <Text style={styles.sectionTitle}>메트로놈 속도</Text>
        <View style={styles.bpmControlRow}>
          <SmallOption label="-5" disabled={running} onPress={() => setBpm((value) => Math.max(35, value - 5))} />
          <SmallOption label="-1" disabled={running} onPress={() => setBpm((value) => Math.max(35, value - 1))} />
          <View style={styles.bpmCenter}>
            <Text style={styles.bpmValue}>{bpm}</Text>
            <Text style={styles.bpmUnit}>BPM</Text>
          </View>
          <SmallOption label="+1" disabled={running} onPress={() => setBpm((value) => Math.min(220, value + 1))} />
          <SmallOption label="+5" disabled={running} onPress={() => setBpm((value) => Math.min(220, value + 5))} />
        </View>
        <View style={styles.optionWrap}>
          {QUICK_BPM_OPTIONS.map((value) => (
            <SmallOption key={value} label={`${value}`} active={bpm === value} disabled={running} onPress={() => setBpm(value)} />
          ))}
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchItem}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>마이크 박자 분석</Text>
              <Text style={styles.switchDetail}>탄현 간격·클리핑·흔들림을 실제 입력으로 비교</Text>
            </View>
            <Switch disabled={running} value={microphoneEnabled} onValueChange={setMicrophoneEnabled} />
          </View>
          <View style={styles.switchItem}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>첫 박 악센트</Text>
              <Text style={styles.switchDetail}>각 마디 첫 박을 강하게 재생</Text>
            </View>
            <Switch disabled={running} value={accentEnabled} onValueChange={setAccentEnabled} />
          </View>
        </View>
      </View>

      <View style={styles.liveSummary}>
        <View style={styles.timeBlock}>
          <Text style={styles.smallLabel}>연습 경과</Text>
          <Text style={styles.timeValue}>{formatElapsed(elapsedSeconds)}</Text>
        </View>
        <View style={styles.timeBlockCenter}>
          <Text style={styles.smallLabel}>남은 시간</Text>
          <Text style={styles.remainingValue}>{remainingSeconds == null ? '∞' : formatElapsed(remainingSeconds)}</Text>
        </View>
        <View style={styles.timeBlockRight}>
          <Text style={styles.smallLabel}>현재 속도</Text>
          <Text style={styles.runningBpm}>{bpm}<Text style={styles.runningBpmUnit}> BPM</Text></Text>
        </View>
      </View>
      {autoStopEnabled ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progressPercent}%` }]} /></View> : null}

      <View style={styles.actionRow}>
        <Pressable onPress={() => setManualMistakes((value) => value + 1)} style={styles.mistakeButton}>
          <Text style={styles.mistakeText}>내가 느낀 실수 +1 · {manualMistakes}</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => running ? void stopAndSave(false) : void start()}
          style={[styles.startButton, running && styles.stopButton, busy && styles.disabled]}
        >
          <Text style={styles.startText}>{busy ? '처리 중…' : running ? '종료·자동 저장' : `${bpm} BPM 실시간 레슨 시작`}</Text>
        </Pressable>
      </View>

      <View style={styles.tensionRow}>
        <View style={styles.switchTextWrap}>
          <Text style={styles.switchTitle}>손목·어깨 긴장 또는 통증</Text>
          <Text style={styles.switchDetail}>켜면 다음 속도 추천에서 증속을 중단하고 휴식을 우선합니다.</Text>
        </View>
        <Switch value={tensionReported} onValueChange={setTensionReported} />
      </View>

      <LiveTeacherPanel preset={preset} running={running} voiceEnabled={voiceCoachEnabled} />

      <View style={styles.metricRow}>
        <Metric label="평균" value={snapshot.averageScore == null ? '-' : `${snapshot.averageScore}`} />
        <Metric label="신뢰도" value={`${snapshot.confidencePercent}%`} />
        <Metric label="박 오차" value={timingLabel(snapshot.timingOffsetMs)} />
        <Metric label="흔들림" value={snapshot.timingJitterMs == null ? '-' : `${snapshot.timingJitterMs}ms`} />
        <Metric label="촬영보정" value={calibrationConfidence == null ? '없음' : `${calibrationConfidence}%`} />
      </View>

      {decision ? (
        <View style={styles.decisionCard}>
          <Text style={styles.decisionTitle}>AI 다음 수업 · {decision.nextBpm} BPM</Text>
          <Text style={styles.decisionText}>{decision.reason}</Text>
          <Text style={styles.decisionFocus}>{decision.nextFocus}</Text>
        </View>
      ) : null}
      {snapshot.issues.length ? (
        <View style={styles.issueCard}>
          <Text style={styles.issueTitle}>이번 세션에서 반복된 문제</Text>
          <Text style={styles.issueText}>{snapshot.issues.slice(0, 4).map((issue) => `${issue.title} ${issue.count}회`).join(' · ')}</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.cameraSectionHeader}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>LIVE CAMERA ANALYSIS</Text>
          <Text style={styles.cameraSectionTitle}>{FOCUS_MODE_OPTIONS.find((item) => item.id === focusMode)?.label} 실제 추적 화면</Text>
        </View>
        <Text style={styles.cameraSectionHint}>아래까지 자유롭게 스크롤됩니다</Text>
      </View>
      <View style={styles.cameraWrap}>
        <SessionCoachCamera running={running} category={preset.category} cameraFocus={preset.cameraFocus} />
      </View>

      <View style={styles.ruleCard}>
        <Text style={styles.ruleTitle}>이 루틴에서 실제로 확인하는 항목</Text>
        {preset.checkpoints.map((item, index) => <Text key={item} style={styles.ruleText}>{index + 1}. {item}</Text>)}
        <Text style={styles.ruleNotice}>카메라 프레임 속도나 보정값으로 확인할 수 없는 세부 시간 차이는 숫자를 만들지 않고 판정 불가로 표시합니다.</Text>
      </View>
    </ScrollView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { paddingBottom: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  headerTextWrap: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 17, fontWeight: '900', marginTop: 3 },
  statusText: { color: '#8b949e', fontSize: 9, lineHeight: 14, marginTop: 3 },
  closeButton: { minWidth: 48, height: 38, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  focusModeCard: { borderRadius: 17, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#111d2f', padding: 12, marginTop: 10 },
  focusModeHeading: { color: '#79c0ff', fontSize: 13, fontWeight: '900' },
  focusModeGuide: { color: '#b6d8ff', fontSize: 8, lineHeight: 13, marginTop: 4 },
  focusModeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  focusModeButton: { width: '48.8%', minHeight: 64, borderRadius: 12, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 9 },
  focusModeButtonActive: { borderColor: '#2ea043', backgroundColor: '#14251a' },
  focusModeLabel: { color: '#b1bac4', fontSize: 10, fontWeight: '900' },
  focusModeLabelActive: { color: '#7ee787' },
  focusModeDetail: { color: '#8b949e', fontSize: 7, lineHeight: 11, marginTop: 4 },
  presetScroll: { maxHeight: 49, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  presetRow: { gap: 6, paddingHorizontal: 9, paddingVertical: 7 },
  presetChip: { minHeight: 34, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', justifyContent: 'center', paddingHorizontal: 11 },
  presetChipActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  presetChipText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  presetChipTextActive: { color: '#ffffff' },
  lessonPlanCard: { margin: 9, marginBottom: 0, borderRadius: 15, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#111d2f', padding: 12 },
  lessonPlanTitle: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  lessonPlanGoal: { color: '#f0f6fc', fontSize: 12, lineHeight: 18, fontWeight: '800', marginTop: 4 },
  lessonMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  lessonMeta: { color: '#b6d8ff', backgroundColor: '#0d1522', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, fontSize: 7, fontWeight: '800' },
  setupCard: { margin: 9, marginBottom: 0, borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 11 },
  sectionTitle: { color: '#f0f6fc', fontSize: 10, fontWeight: '900', marginTop: 5, marginBottom: 7 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  smallOption: { minWidth: 44, minHeight: 34, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  smallOptionActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  smallOptionText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  smallOptionTextActive: { color: '#ffffff' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7 },
  customValue: { flex: 1, color: '#7ee787', fontSize: 10, fontWeight: '900', textAlign: 'center' },
  bpmControlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 7 },
  bpmCenter: { minWidth: 68, alignItems: 'center' },
  bpmValue: { color: '#7ee787', fontSize: 27, fontWeight: '900' },
  bpmUnit: { color: '#8b949e', fontSize: 7, fontWeight: '800' },
  switchRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#30363d', marginTop: 10, paddingTop: 8 },
  switchItem: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 6 },
  switchTextWrap: { flex: 1, paddingRight: 5 },
  switchTitle: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  switchDetail: { color: '#6e7681', fontSize: 7, lineHeight: 11, marginTop: 2 },
  liveSummary: { flexDirection: 'row', backgroundColor: '#161b22', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#30363d', marginTop: 9, paddingHorizontal: 12, paddingVertical: 9 },
  timeBlock: { flex: 1 },
  timeBlockCenter: { flex: 1, alignItems: 'center' },
  timeBlockRight: { flex: 1, alignItems: 'flex-end' },
  smallLabel: { color: '#8b949e', fontSize: 7, fontWeight: '900' },
  timeValue: { color: '#7ee787', fontSize: 22, fontWeight: '900', marginTop: 2 },
  remainingValue: { color: '#f0f6fc', fontSize: 22, fontWeight: '900', marginTop: 2 },
  runningBpm: { color: '#f0f6fc', fontSize: 22, fontWeight: '900', marginTop: 2 },
  runningBpmUnit: { color: '#8b949e', fontSize: 8 },
  progressTrack: { height: 5, backgroundColor: '#21262d', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#2ea043' },
  actionRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingTop: 9 },
  mistakeButton: { flex: 0.85, minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  mistakeText: { color: '#f2cc60', fontSize: 8, fontWeight: '900', textAlign: 'center' },
  startButton: { flex: 1.25, minHeight: 44, borderRadius: 11, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  stopButton: { backgroundColor: '#da3633' },
  startText: { color: '#ffffff', fontSize: 9, fontWeight: '900', textAlign: 'center' },
  tensionRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 8, marginTop: 7, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', paddingHorizontal: 10, paddingVertical: 7 },
  metricRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingTop: 8 },
  metricCard: { flex: 1, minWidth: 53, backgroundColor: '#161b22', borderRadius: 9, alignItems: 'center', paddingVertical: 7, paddingHorizontal: 2 },
  metricValue: { color: '#f0f6fc', fontSize: 8, fontWeight: '900', textAlign: 'center' },
  metricLabel: { color: '#6e7681', fontSize: 6, marginTop: 2 },
  decisionCard: { marginHorizontal: 8, marginTop: 7, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#102418' },
  decisionTitle: { color: '#7ee787', fontSize: 9, fontWeight: '900' },
  decisionText: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 3 },
  decisionFocus: { color: '#f0f6fc', fontSize: 8, lineHeight: 13, fontWeight: '800', marginTop: 3 },
  issueCard: { marginHorizontal: 8, marginTop: 7, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#9e6a03', backgroundColor: '#2d2208' },
  issueTitle: { color: '#f2cc60', fontSize: 9, fontWeight: '900' },
  issueText: { color: '#d2b45c', fontSize: 8, lineHeight: 13, marginTop: 3 },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 13, marginHorizontal: 9, marginTop: 7 },
  cameraSectionHeader: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 9, marginTop: 13, marginBottom: 4 },
  cameraSectionTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', marginTop: 2 },
  cameraSectionHint: { color: '#8b949e', fontSize: 7 },
  cameraWrap: { minHeight: 575 },
  ruleCard: { marginHorizontal: 9, marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 12 },
  ruleTitle: { color: '#79c0ff', fontSize: 9, fontWeight: '900', marginBottom: 6 },
  ruleText: { color: '#b1bac4', fontSize: 8, lineHeight: 14 },
  ruleNotice: { color: '#f2cc60', fontSize: 7, lineHeight: 12, marginTop: 8 },
  disabled: { opacity: 0.42 },
});
