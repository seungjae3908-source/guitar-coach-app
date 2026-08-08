import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
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
  updateAdvancedMetronomeAsync,
} from '../modules/guitar-coach-metronome';
import { clearLatestLiveAnalysisFrames, subscribeLiveAnalysis } from '../services/analysis-stream';
import { loadBestCameraCalibration } from '../services/camera-calibration-store';
import { clearLiveCoachFeedback } from '../services/live-coach-feedback';
import {
  LivePracticeSessionAccumulator,
  type LiveSessionSnapshot,
} from '../services/live-practice-session';
import {
  clearLivePracticeContext,
  getLivePracticeContext,
  setLivePracticeContext,
} from '../services/practice-session-context';
import {
  decideNextPracticeStep,
  type PracticeAttempt,
  type ProgressionDecision,
} from '../services/practice-progression-engine';
import {
  loadPracticeSessions,
  type PracticeSessionRecord,
  savePracticeSession,
} from '../services/practice-session-store';
import CameraFirstTeacherPanel from './CameraFirstTeacherPanel';
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

const DURATION_OPTIONS = [60, 180, 300, 600];

function pulsesForPreset(preset: PracticePreset): 1 | 2 | 3 | 4 {
  if (preset.pattern?.toLowerCase().includes('p i m')) return 3;
  if (preset.category === 'arpeggio') return 3;
  if (
    preset.category === 'strumming'
    || preset.category === 'alternatePicking'
    || preset.category === 'downPicking'
    || preset.category === 'palmMute'
  ) return 2;
  return 1;
}

function formatElapsed(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function durationLabel(seconds: number) {
  return seconds < 60 ? `${seconds}초` : `${Math.round(seconds / 60)}분`;
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

function TinyButton({
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
      style={[styles.tinyButton, active && styles.tinyButtonActive, disabled && styles.disabled]}
    >
      <Text style={[styles.tinyButtonText, active && styles.tinyButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function PracticeSessionRunnerV3({
  mode,
  voiceCoachEnabled: _voiceCoachEnabled,
  onClose,
}: {
  mode: GuitarModeId;
  voiceCoachEnabled: boolean;
  onClose?: () => void;
}) {
  const { height: windowHeight } = useWindowDimensions();
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
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [tensionReported, setTensionReported] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [manualMistakes, setManualMistakes] = useState(0);
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot>(EMPTY_SNAPSHOT);
  const [decision, setDecision] = useState<ProgressionDecision | null>(null);
  const [status, setStatus] = useState('모드를 고르고 카메라 화면에서 시작하세요.');
  const [error, setError] = useState('');
  const [calibrationConfidence, setCalibrationConfidence] = useState<number | null>(null);
  const accumulatorRef = useRef<LivePracticeSessionAccumulator | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const lastSnapshotAtRef = useRef(0);
  const autoStopTriggeredRef = useRef(false);

  const pulsesPerBeat = preset ? pulsesForPreset(preset) : 1;
  const remainingSeconds = autoStopEnabled
    ? Math.max(0, sessionDurationSeconds - elapsedSeconds)
    : null;

  useEffect(() => {
    const first = presets[0];
    const nextFocus = focusModeForCategory(first?.category);
    const firstPreset = presets.find((item) => categoryMatchesFocusMode(item.category, nextFocus)) ?? first;
    setFocusMode(nextFocus);
    setSelectedPresetId(firstPreset?.id ?? '');
    setBpm(firstPreset?.startBpm ?? 70);
    setSessionDurationSeconds(firstPreset?.durationSeconds ?? 180);
    setRunning(false);
    setSettingsOpen(false);
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
    setStatus('카메라 화면에서 자세를 맞춘 뒤 시작하세요.');
    clearLiveCoachFeedback();
  }, [preset, running]);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    const accumulator = accumulatorRef.current;
    if (!running || !accumulator) return;
    accumulator.addFrame(frame);
    if (frame.capturedAt - lastSnapshotAtRef.current >= 450) {
      lastSnapshotAtRef.current = frame.capturedAt;
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
        if (!cancelled) setError(caught instanceof Error ? caught.message : '메트로놈 상태를 읽지 못했습니다.');
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

  const requestMicrophonePermission = async () => {
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: '연주 소리 분석 권한',
        message: '선택한 경우에만 박자와 톤을 보조 분석합니다.',
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
    setStatus('카메라와 분석기를 준비하는 중…');
    try {
      if (!isAdvancedMetronomeAvailable) throw new Error('메트로놈 모듈이 APK에 없습니다.');
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
      setSnapshot(EMPTY_SNAPSHOT);
      setDecision(null);
      setSettingsOpen(false);

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
      setStatus('실시간 카메라 코칭 중');
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
    setRunning(false);
    clearLivePracticeContext();
    setStatus('기록을 저장하는 중…');
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
        : ` · 박오차 ${timingLabel(finalSnapshot.timingOffsetMs)}`;
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
        ? '저장 완료 · 판정 가능한 표본이 부족했습니다.'
        : `저장 완료 · 평균 ${finalSnapshot.averageScore}점`);
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

  const selectFocusMode = (nextMode: FocusPracticeMode) => {
    if (running) return;
    const first = presets.find((item) => categoryMatchesFocusMode(item.category, nextMode));
    if (!first) return;
    setFocusMode(nextMode);
    setSelectedPresetId(first.id);
    setError('');
  };

  const changeBpm = (delta: number) => {
    const next = Math.min(220, Math.max(35, bpm + delta));
    setBpm(next);
    accumulatorRef.current?.updateBpm(next);
    const context = getLivePracticeContext();
    if (context?.active) setLivePracticeContext({ ...context, bpm: next });
    if (running) {
      void updateAdvancedMetronomeAsync(next, 4, pulsesPerBeat, accentEnabled, false, 0)
        .catch((caught) => setError(caught instanceof Error ? caught.message : 'BPM 변경에 실패했습니다.'));
    }
  };

  if (!preset) {
    return <View style={styles.center}><Text style={styles.statusText}>등록된 개인 루틴이 없습니다.</Text></View>;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>{mode === 'acoustic' ? '통기타' : '일렉기타'} · CAMERA FOCUS</Text>
          <Text style={styles.title} numberOfLines={1}>{preset.title}</Text>
          <Text style={styles.statusText} numberOfLines={1}>{status}</Text>
        </View>
        {onClose ? (
          <Pressable disabled={running} onPress={onClose} style={[styles.closeButton, running && styles.disabled]}>
            <Text style={styles.closeText}>닫기</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal style={styles.modeScroll} contentContainerStyle={styles.modeRow} showsHorizontalScrollIndicator={false}>
        {availableFocusModes.map((item) => (
          <Pressable
            key={item.id}
            disabled={running}
            onPress={() => selectFocusMode(item.id)}
            style={[styles.modeChip, focusMode === item.id && styles.modeChipActive, running && styles.disabled]}
          >
            <Text style={[styles.modeChipText, focusMode === item.id && styles.modeChipTextActive]}>{item.label.replace(' 모드', '')}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView horizontal style={styles.presetScroll} contentContainerStyle={styles.presetRow} showsHorizontalScrollIndicator={false}>
        {focusPresets.map((item) => (
          <Pressable
            key={item.id}
            disabled={running}
            onPress={() => setSelectedPresetId(item.id)}
            style={[styles.presetChip, item.id === preset.id && styles.presetChipActive, running && styles.disabled]}
          >
            <Text style={[styles.presetText, item.id === preset.id && styles.presetTextActive]} numberOfLines={1}>{item.title}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.screenContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        <View style={styles.cameraHeading}>
          <View>
            <Text style={styles.cameraEyebrow}>LIVE CAMERA</Text>
            <Text style={styles.cameraTitle}>{running ? '실시간 동작 분석' : '카메라 중심 연습 화면'}</Text>
          </View>
          <Text style={styles.cameraState}>{running ? `${snapshot.sampleCounts.hand + snapshot.sampleCounts.pose} 프레임` : `${bpm} BPM`}</Text>
        </View>

        <View style={[styles.cameraWrap, { minHeight: Math.max(500, Math.round(windowHeight * 0.62)) }]}>
          <SessionCoachCamera running={running} category={preset.category} cameraFocus={preset.cameraFocus} />
        </View>

        <CameraFirstTeacherPanel preset={preset} running={running} />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {decision ? (
          <View style={styles.decisionCard}>
            <Text style={styles.decisionTitle}>다음 연습 · {decision.nextBpm} BPM</Text>
            <Text style={styles.decisionText}>{decision.nextFocus}</Text>
          </View>
        ) : null}

        {settingsOpen && !running ? (
          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>보조 설정</Text>
            <View style={styles.durationRow}>
              {DURATION_OPTIONS.map((value) => (
                <TinyButton
                  key={value}
                  label={durationLabel(value)}
                  active={autoStopEnabled && sessionDurationSeconds === value}
                  onPress={() => {
                    setAutoStopEnabled(true);
                    setSessionDurationSeconds(value);
                  }}
                />
              ))}
              <TinyButton label="무제한" active={!autoStopEnabled} onPress={() => setAutoStopEnabled(false)} />
            </View>
            <View style={styles.settingSwitchRow}>
              <Text style={styles.settingLabel}>마이크 박자·톤 보조</Text>
              <Switch value={microphoneEnabled} onValueChange={setMicrophoneEnabled} />
            </View>
            <View style={styles.settingSwitchRow}>
              <Text style={styles.settingLabel}>첫 박 악센트</Text>
              <Switch value={accentEnabled} onValueChange={setAccentEnabled} />
            </View>
            <View style={styles.settingSwitchRow}>
              <Text style={styles.settingLabel}>손목·어깨 긴장/통증</Text>
              <Switch value={tensionReported} onValueChange={setTensionReported} />
            </View>
            <Text style={styles.settingsNote}>메트로놈과 마이크는 화면 보조 기능이며 카메라 교정보다 위에 표시하지 않습니다.</Text>
          </View>
        ) : null}

        <View style={styles.bottomInfoCard}>
          <Text style={styles.bottomInfoTitle}>현재 목표</Text>
          <Text style={styles.bottomInfoText}>{preset.goal}</Text>
          <Text style={styles.bottomInfoMeta}>{preset.pattern ?? '동작 반복'} · {pulsesPerBeat}분할 · 촬영보정 {calibrationConfidence == null ? '없음' : `${calibrationConfidence}%`}</Text>
        </View>
      </ScrollView>

      <View style={styles.bottomDock}>
        <View style={styles.dockTopRow}>
          <Pressable onPress={() => changeBpm(-5)} style={styles.bpmStep}><Text style={styles.bpmStepText}>−5</Text></Pressable>
          <View style={styles.bpmCompact}><Text style={styles.bpmCompactValue}>{bpm}</Text><Text style={styles.bpmCompactUnit}>BPM</Text></View>
          <Pressable onPress={() => changeBpm(5)} style={styles.bpmStep}><Text style={styles.bpmStepText}>+5</Text></Pressable>
          <View style={styles.timeCompact}>
            <Text style={styles.timeLabel}>{running ? '연습' : '시간'}</Text>
            <Text style={styles.timeValue}>{running ? formatElapsed(elapsedSeconds) : remainingSeconds == null ? '∞' : durationLabel(sessionDurationSeconds)}</Text>
          </View>
          <Pressable disabled={running} onPress={() => setSettingsOpen((value) => !value)} style={[styles.settingsButton, running && styles.disabled]}>
            <Text style={styles.settingsButtonText}>{settingsOpen ? '닫기' : '설정'}</Text>
          </Pressable>
        </View>
        <View style={styles.dockBottomRow}>
          <Pressable onPress={() => setManualMistakes((value) => value + 1)} style={styles.mistakeButton}>
            <Text style={styles.mistakeText}>실수 +1 · {manualMistakes}</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => running ? void stopAndSave(false) : void start()}
            style={[styles.startButton, running && styles.stopButton, busy && styles.disabled]}
          >
            <Text style={styles.startText}>{busy ? '처리 중…' : running ? '종료·저장' : '카메라 레슨 시작'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  headerTextWrap: { flex: 1, paddingRight: 7 },
  eyebrow: { color: '#79c0ff', fontSize: 7, fontWeight: '900', letterSpacing: 0.6 },
  title: { color: '#f0f6fc', fontSize: 14, fontWeight: '900', marginTop: 1 },
  statusText: { color: '#8b949e', fontSize: 7, marginTop: 2 },
  closeButton: { minWidth: 43, height: 31, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  modeScroll: { maxHeight: 39, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  modeRow: { gap: 5, paddingHorizontal: 8, paddingVertical: 5 },
  modeChip: { minWidth: 70, minHeight: 28, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  modeChipActive: { borderColor: '#2ea043', backgroundColor: '#14251a' },
  modeChipText: { color: '#8b949e', fontSize: 8, fontWeight: '900' },
  modeChipTextActive: { color: '#7ee787' },
  presetScroll: { maxHeight: 36, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  presetRow: { gap: 5, paddingHorizontal: 8, paddingVertical: 4 },
  presetChip: { maxWidth: 180, minHeight: 27, borderRadius: 8, backgroundColor: '#161b22', justifyContent: 'center', paddingHorizontal: 9 },
  presetChipActive: { backgroundColor: '#238636' },
  presetText: { color: '#8b949e', fontSize: 7, fontWeight: '800' },
  presetTextActive: { color: '#ffffff' },
  screen: { flex: 1 },
  screenContent: { paddingBottom: 112 },
  cameraHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 7, paddingBottom: 4 },
  cameraEyebrow: { color: '#79c0ff', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  cameraTitle: { color: '#f0f6fc', fontSize: 12, fontWeight: '900', marginTop: 1 },
  cameraState: { color: '#7ee787', fontSize: 8, fontWeight: '900' },
  cameraWrap: { width: '100%' },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 13, marginHorizontal: 9, marginTop: 7 },
  decisionCard: { marginHorizontal: 8, marginTop: 7, borderRadius: 11, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#102418', padding: 9 },
  decisionTitle: { color: '#7ee787', fontSize: 9, fontWeight: '900' },
  decisionText: { color: '#d2f2da', fontSize: 8, lineHeight: 12, marginTop: 2 },
  settingsCard: { marginHorizontal: 8, marginTop: 8, borderRadius: 13, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 10 },
  settingsTitle: { color: '#f0f6fc', fontSize: 10, fontWeight: '900', marginBottom: 7 },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 7 },
  tinyButton: { minWidth: 49, minHeight: 30, borderRadius: 8, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  tinyButtonActive: { borderColor: '#2ea043', backgroundColor: '#238636' },
  tinyButtonText: { color: '#b1bac4', fontSize: 7, fontWeight: '900' },
  tinyButtonTextActive: { color: '#ffffff' },
  settingSwitchRow: { minHeight: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#21262d' },
  settingLabel: { color: '#b1bac4', fontSize: 8, fontWeight: '800' },
  settingsNote: { color: '#8b949e', fontSize: 7, lineHeight: 12, marginTop: 6 },
  bottomInfoCard: { marginHorizontal: 8, marginTop: 8, borderRadius: 11, backgroundColor: '#161b22', padding: 9 },
  bottomInfoTitle: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  bottomInfoText: { color: '#f0f6fc', fontSize: 9, lineHeight: 14, fontWeight: '800', marginTop: 3 },
  bottomInfoMeta: { color: '#8b949e', fontSize: 7, marginTop: 4 },
  bottomDock: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 1, borderTopColor: '#30363d', backgroundColor: '#0d1117', paddingHorizontal: 7, paddingTop: 6, paddingBottom: 8 },
  dockTopRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bpmStep: { width: 36, height: 31, borderRadius: 9, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  bpmStepText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  bpmCompact: { minWidth: 53, height: 31, borderRadius: 9, backgroundColor: '#161b22', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 2 },
  bpmCompactValue: { color: '#7ee787', fontSize: 15, fontWeight: '900' },
  bpmCompactUnit: { color: '#8b949e', fontSize: 6, fontWeight: '800' },
  timeCompact: { flex: 1, minHeight: 31, borderRadius: 9, backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center' },
  timeLabel: { color: '#6e7681', fontSize: 6, fontWeight: '800' },
  timeValue: { color: '#f0f6fc', fontSize: 9, fontWeight: '900', marginTop: 1 },
  settingsButton: { minWidth: 45, height: 31, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  settingsButtonText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  dockBottomRow: { flexDirection: 'row', gap: 6, marginTop: 5 },
  mistakeButton: { flex: 0.8, minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  mistakeText: { color: '#f2cc60', fontSize: 8, fontWeight: '900' },
  startButton: { flex: 1.3, minHeight: 36, borderRadius: 10, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  stopButton: { backgroundColor: '#da3633' },
  startText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  disabled: { opacity: 0.42 },
});
