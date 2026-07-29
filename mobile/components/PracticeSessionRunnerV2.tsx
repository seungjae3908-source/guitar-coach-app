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
import {
  LivePracticeSessionAccumulator,
  LiveSessionSnapshot,
} from '../services/live-practice-session';
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
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
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

export default function PracticeSessionRunnerV2({
  mode,
  onClose,
}: {
  mode: GuitarModeId;
  onClose?: () => void;
}) {
  const presets = useMemo(() => getPracticePresetsForMode(mode), [mode]);
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? '');
  const preset = presets.find((item) => item.id === selectedPresetId) ?? presets[0];
  const [bpm, setBpm] = useState(preset?.startBpm ?? 70);
  const [running, setRunning] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [manualMistakes, setManualMistakes] = useState(0);
  const [tensionReported, setTensionReported] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot>(EMPTY_SNAPSHOT);
  const [decision, setDecision] = useState<ProgressionDecision | null>(null);
  const [status, setStatus] = useState('루틴을 고른 뒤 시작하세요.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const accumulatorRef = useRef<LivePracticeSessionAccumulator | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const lastSnapshotAtRef = useRef(0);

  useEffect(() => {
    const first = presets[0];
    setSelectedPresetId(first?.id ?? '');
    setBpm(first?.startBpm ?? 70);
    setSnapshot(EMPTY_SNAPSHOT);
    setDecision(null);
  }, [mode, presets]);

  useEffect(() => {
    if (!preset || running) return;
    setBpm(preset.startBpm);
    setManualMistakes(0);
    setTensionReported(false);
    setSnapshot(EMPTY_SNAPSHOT);
    setDecision(null);
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
    const timer = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt) setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 250);
    return () => clearInterval(timer);
  }, [running]);

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

  useEffect(() => () => {
    void stopAdvancedMetronomeAsync();
    void stopNativeAudioAnalysisAsync();
  }, []);

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
      if (microphoneEnabled) {
        if (!isNativeAudioAnalysisAvailable) throw new Error('마이크 분석 모듈이 APK에 없습니다.');
        const granted = await requestMicrophonePermission();
        if (!granted) throw new Error('마이크 권한이 허용되지 않았습니다.');
        await startNativeAudioAnalysisAsync(440);
      }
      clearLatestLiveAnalysisFrames();
      accumulatorRef.current = new LivePracticeSessionAccumulator({
        category: preset.category,
        bpm,
        pulsesPerBeat: pulsesForPreset(preset),
        calibration,
      });
      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
      setManualMistakes(0);
      setTensionReported(false);
      setSnapshot(EMPTY_SNAPSHOT);
      setDecision(null);
      await startAdvancedMetronomeAsync(bpm, 4, pulsesForPreset(preset), true, false, 0);
      setRunning(true);
      setStatus(calibration
        ? `자동 분석 중 · 촬영 보정 ${calibration.confidencePercent}% 적용`
        : '자동 분석 중 · 손·자세 중심 분석');
    } catch (caught) {
      await stopAdvancedMetronomeAsync();
      await stopNativeAudioAnalysisAsync();
      accumulatorRef.current = null;
      startedAtRef.current = null;
      setRunning(false);
      setStatus('시작 실패');
      setError(caught instanceof Error ? caught.message : '집중 연습을 시작하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const stopAndSave = async () => {
    if (!preset || !running || busy) return;
    setBusy(true);
    setError('');
    setStatus('종료하고 기록을 계산하는 중…');
    setRunning(false);
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
        notes: `${tensionReported ? '긴장 보고 · ' : ''}${nextDecision.reason}${timingText}`,
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
    } catch (caught) {
      setStatus('기록 저장 실패');
      setError(caught instanceof Error ? caught.message : '연습 기록을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (!preset) {
    return <View style={styles.center}><Text style={styles.statusText}>등록된 개인 루틴이 없습니다.</Text></View>;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>{mode === 'acoustic' ? '통기타' : '일렉기타'} · AUTO AI SESSION</Text>
          <Text style={styles.title}>{preset.title}</Text>
          <Text style={styles.statusText}>{status}</Text>
        </View>
        {onClose ? (
          <Pressable disabled={running} onPress={onClose} style={[styles.closeButton, running && styles.disabled]}>
            <Text style={styles.closeText}>닫기</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal style={styles.presetScroll} contentContainerStyle={styles.presetRow} showsHorizontalScrollIndicator={false}>
        {presets.map((item) => (
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

      <View style={styles.controlRow}>
        <View style={styles.timeBlock}>
          <Text style={styles.smallLabel}>연습 시간</Text>
          <Text style={styles.timeValue}>{formatElapsed(elapsedSeconds)}</Text>
        </View>
        <View style={styles.bpmBlock}>
          <Text style={styles.smallLabel}>BPM · 목표 {preset.targetBpm}</Text>
          <View style={styles.bpmRow}>
            <Pressable disabled={running} onPress={() => setBpm((value) => Math.max(35, value - 5))} style={[styles.stepButton, running && styles.disabled]}><Text style={styles.stepText}>-5</Text></Pressable>
            <Text style={styles.bpmValue}>{bpm}</Text>
            <Pressable disabled={running} onPress={() => setBpm((value) => Math.min(preset.targetBpm, value + 5))} style={[styles.stepButton, running && styles.disabled]}><Text style={styles.stepText}>+5</Text></Pressable>
          </View>
        </View>
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchItem}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>마이크 박자</Text>
            <Text style={styles.switchDetail}>클릭과 탄현을 ms로 비교</Text>
          </View>
          <Switch disabled={running} value={microphoneEnabled} onValueChange={setMicrophoneEnabled} />
        </View>
        <View style={styles.switchItem}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>긴장·통증</Text>
            <Text style={styles.switchDetail}>증속 중지·휴식 처리</Text>
          </View>
          <Switch value={tensionReported} onValueChange={setTensionReported} />
        </View>
      </View>

      <View style={styles.metricRow}>
        <Metric label="평균" value={snapshot.averageScore == null ? '-' : `${snapshot.averageScore}`} />
        <Metric label="신뢰도" value={`${snapshot.confidencePercent}%`} />
        <Metric label="박 오차" value={timingLabel(snapshot.timingOffsetMs)} />
        <Metric label="흔들림" value={snapshot.timingJitterMs == null ? '-' : `${snapshot.timingJitterMs}ms`} />
        <Metric label="가까운 줄" value={snapshot.lastStringNumber ? `${snapshot.lastStringNumber}번` : '-'} />
      </View>

      <View style={styles.actionRow}>
        <Pressable onPress={() => setManualMistakes((value) => value + 1)} style={styles.mistakeButton}>
          <Text style={styles.mistakeText}>실수 +1 · {manualMistakes}</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => running ? void stopAndSave() : void start()} style={[styles.startButton, running && styles.stopButton, busy && styles.disabled]}>
          <Text style={styles.startText}>{busy ? '처리 중…' : running ? '종료·자동 저장' : `${bpm} BPM 자동 시작`}</Text>
        </Pressable>
      </View>

      {decision ? (
        <View style={styles.decisionCard}>
          <Text style={styles.decisionTitle}>다음 단계 · {decision.nextBpm} BPM</Text>
          <Text style={styles.decisionText}>{decision.reason}</Text>
          <Text style={styles.decisionFocus}>{decision.nextFocus}</Text>
        </View>
      ) : null}
      {snapshot.issues.length ? (
        <View style={styles.issueCard}>
          <Text style={styles.issueTitle}>반복 문제</Text>
          <Text style={styles.issueText}>{snapshot.issues.slice(0, 3).map((issue) => `${issue.title} ${issue.count}회`).join(' · ')}</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.cameraWrap}>
        <SessionCoachCamera running={running} category={preset.category} cameraFocus={preset.cameraFocus} />
      </View>
    </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  headerTextWrap: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  title: { color: '#f0f6fc', fontSize: 14, fontWeight: '900', marginTop: 2 },
  statusText: { color: '#8b949e', fontSize: 8, lineHeight: 12, marginTop: 2 },
  closeButton: { minWidth: 45, height: 34, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  presetScroll: { maxHeight: 43, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  presetRow: { gap: 5, paddingHorizontal: 8, paddingVertical: 6 },
  presetChip: { minHeight: 29, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', justifyContent: 'center', paddingHorizontal: 9 },
  presetChipActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  presetChipText: { color: '#b1bac4', fontSize: 7, fontWeight: '900' },
  presetChipTextActive: { color: '#ffffff' },
  controlRow: { flexDirection: 'row', backgroundColor: '#161b22', paddingHorizontal: 10, paddingVertical: 7 },
  timeBlock: { flex: 1 },
  bpmBlock: { flex: 1, alignItems: 'flex-end' },
  smallLabel: { color: '#8b949e', fontSize: 7, fontWeight: '900' },
  timeValue: { color: '#7ee787', fontSize: 21, fontWeight: '900', marginTop: 2 },
  bpmRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  stepButton: { width: 34, height: 29, borderRadius: 8, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  bpmValue: { color: '#f0f6fc', fontSize: 19, fontWeight: '900', minWidth: 39, textAlign: 'center' },
  switchRow: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#30363d' },
  switchItem: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRightWidth: 1, borderRightColor: '#30363d' },
  switchTextWrap: { flex: 1, paddingRight: 3 },
  switchTitle: { color: '#f0f6fc', fontSize: 7, fontWeight: '900' },
  switchDetail: { color: '#6e7681', fontSize: 6, lineHeight: 9, marginTop: 1 },
  metricRow: { flexDirection: 'row', gap: 3, padding: 6 },
  metricCard: { flex: 1, minWidth: 51, backgroundColor: '#161b22', borderRadius: 8, alignItems: 'center', paddingVertical: 5, paddingHorizontal: 1 },
  metricValue: { color: '#f0f6fc', fontSize: 7, fontWeight: '900', textAlign: 'center' },
  metricLabel: { color: '#6e7681', fontSize: 5, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 5, paddingHorizontal: 7, paddingBottom: 6 },
  mistakeButton: { flex: 0.75, minHeight: 36, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  mistakeText: { color: '#f2cc60', fontSize: 8, fontWeight: '900' },
  startButton: { flex: 1.25, minHeight: 36, borderRadius: 9, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  stopButton: { backgroundColor: '#da3633' },
  startText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  decisionCard: { marginHorizontal: 7, marginBottom: 5, padding: 7, borderRadius: 10, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#102418' },
  decisionTitle: { color: '#7ee787', fontSize: 8, fontWeight: '900' },
  decisionText: { color: '#b1bac4', fontSize: 7, lineHeight: 11, marginTop: 2 },
  decisionFocus: { color: '#f0f6fc', fontSize: 7, lineHeight: 11, fontWeight: '800', marginTop: 2 },
  issueCard: { marginHorizontal: 7, marginBottom: 5, padding: 7, borderRadius: 10, borderWidth: 1, borderColor: '#9e6a03', backgroundColor: '#2d2208' },
  issueTitle: { color: '#f2cc60', fontSize: 8, fontWeight: '900' },
  issueText: { color: '#d2b45c', fontSize: 7, lineHeight: 11, marginTop: 2 },
  errorText: { color: '#ff7b72', fontSize: 7, lineHeight: 11, marginHorizontal: 8, marginBottom: 4 },
  cameraWrap: { flex: 1, minHeight: 360 },
  disabled: { opacity: 0.42 },
});
