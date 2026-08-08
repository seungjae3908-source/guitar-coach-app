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

import LiveCoachDetailedAi from '../LiveCoachDetailedAi';
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
  updateAdvancedMetronomeAsync,
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

function cameraLabel(preset: PracticePreset) {
  if (preset.cameraFocus === 'right-hand') return '오른손 근접';
  if (preset.cameraFocus === 'left-hand') return '왼손 근접';
  if (preset.cameraFocus === 'full-body') return '전신 자세';
  return '카메라 선택';
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

export default function PracticeSessionRunner({
  mode,
  onClose,
}: {
  mode: GuitarModeId;
  onClose?: () => void;
}) {
  const presets = useMemo(() => getPracticePresetsForMode(mode), [mode]);
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? '');
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];
  const [bpm, setBpm] = useState(selectedPreset?.startBpm ?? 70);
  const [running, setRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [manualMistakes, setManualMistakes] = useState(0);
  const [tensionReported, setTensionReported] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [snapshot, setSnapshot] = useState<LiveSessionSnapshot>(EMPTY_SNAPSHOT);
  const [decision, setDecision] = useState<ProgressionDecision | null>(null);
  const [status, setStatus] = useState('루틴을 선택하고 시작하세요.');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const accumulatorRef = useRef<LivePracticeSessionAccumulator | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const audioPollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metronomePollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotAtRef = useRef(0);
  const actionBusyRef = useRef(false);

  useEffect(() => {
    const next = presets[0];
    setSelectedPresetId(next?.id ?? '');
    setBpm(next?.startBpm ?? 70);
    setDecision(null);
  }, [mode, presets]);

  useEffect(() => {
    if (!selectedPreset || running) return;
    setBpm(selectedPreset.startBpm);
    setDecision(null);
    setSnapshot(EMPTY_SNAPSHOT);
    setManualMistakes(0);
    setTensionReported(false);
  }, [running, selectedPreset]);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    if (!running || !accumulatorRef.current) return;
    accumulatorRef.current.addFrame(frame);
    const now = Date.now();
    if (now - lastSnapshotAtRef.current >= 500) {
      lastSnapshotAtRef.current = now;
      setSnapshot(accumulatorRef.current.snapshot());
    }
  }), [running]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (!startedAt) return;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 250);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const poll = async () => {
      try {
        await getAdvancedMetronomeTimingStateAsync();
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '메트로놈 시각을 읽지 못했습니다.');
      } finally {
        if (!cancelled) metronomePollingRef.current = setTimeout(poll, 70);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (metronomePollingRef.current) clearTimeout(metronomePollingRef.current);
      metronomePollingRef.current = null;
    };
  }, [running]);

  useEffect(() => {
    if (!running || !microphoneEnabled) return;
    let cancelled = false;
    const poll = async () => {
      try {
        await getLatestNativeAudioReadingAsync();
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '마이크 분석값을 읽지 못했습니다.');
      } finally {
        if (!cancelled) audioPollingRef.current = setTimeout(poll, 90);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (audioPollingRef.current) clearTimeout(audioPollingRef.current);
      audioPollingRef.current = null;
    };
  }, [microphoneEnabled, running]);

  useEffect(() => {
    if (!running || !accumulatorRef.current || !selectedPreset) return;
    accumulatorRef.current.updateBpm(bpm);
    void updateAdvancedMetronomeAsync(
      bpm,
      4,
      pulsesForPreset(selectedPreset),
      true,
      false,
      0,
    ).catch((caught) => setError(caught instanceof Error ? caught.message : 'BPM 변경에 실패했습니다.'));
  }, [bpm, running, selectedPreset]);

  useEffect(() => () => {
    if (audioPollingRef.current) clearTimeout(audioPollingRef.current);
    if (metronomePollingRef.current) clearTimeout(metronomePollingRef.current);
    void stopAdvancedMetronomeAsync();
    void stopNativeAudioAnalysisAsync();
  }, []);

  const requestMicrophonePermission = async () => {
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: '연주 분석 마이크 권한',
        message: '탄현 시점과 박자 간격을 휴대폰 안에서 분석하기 위해 마이크 권한이 필요합니다.',
        buttonPositive: '허용',
        buttonNegative: '취소',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const start = async () => {
    if (!selectedPreset || actionBusyRef.current) return;
    actionBusyRef.current = true;
    setError('');
    setStatus('세션 준비 중…');
    try {
      if (!isAdvancedMetronomeAvailable) throw new Error('이 APK에는 고급 메트로놈 모듈이 없습니다.');
      const calibration = await loadBestCameraCalibration({
        guitarMode: mode,
        cameraFacing: 'back',
        mirrored: false,
      });
      if (microphoneEnabled) {
        if (!isNativeAudioAnalysisAvailable) throw new Error('마이크 분석 모듈이 없습니다.');
        const granted = await requestMicrophonePermission();
        if (!granted) throw new Error('마이크 권한이 허용되지 않았습니다.');
        await startNativeAudioAnalysisAsync(440);
      }
      clearLatestLiveAnalysisFrames();
      accumulatorRef.current = new LivePracticeSessionAccumulator({
        category: selectedPreset.category,
        bpm,
        pulsesPerBeat: pulsesForPreset(selectedPreset),
        calibration,
      });
      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
      setManualMistakes(0);
      setSnapshot(EMPTY_SNAPSHOT);
      setDecision(null);
      setTensionReported(false);
      await startAdvancedMetronomeAsync(
        bpm,
        4,
        pulsesForPreset(selectedPreset),
        true,
        false,
        0,
      );
      setRunning(true);
      setStatus(calibration
        ? `세션 실행 중 · 촬영 보정 ${calibration.confidencePercent}% 적용`
        : '세션 실행 중 · 줄 보정 없이 손·자세 중심으로 분석');
    } catch (caught) {
      await stopAdvancedMetronomeAsync();
      await stopNativeAudioAnalysisAsync();
      accumulatorRef.current = null;
      setRunning(false);
      setStatus('세션 시작 실패');
      setError(caught instanceof Error ? caught.message : '세션을 시작하지 못했습니다.');
    } finally {
      actionBusyRef.current = false;
    }
  };

  const stopAndSave = async () => {
    if (!selectedPreset || !running || saving) return;
    setSaving(true);
    setError('');
    setStatus('분석 종료 및 기록 저장 중…');
    try {
      setRunning(false);
      await stopAdvancedMetronomeAsync();
      await stopNativeAudioAnalysisAsync();
      const finalSnapshot = accumulatorRef.current?.snapshot() ?? EMPTY_SNAPSHOT;
      const endedAt = new Date();
      const startedAtMs = startedAtRef.current ?? endedAt.getTime();
      const durationSeconds = Math.max(1, Math.floor((endedAt.getTime() - startedAtMs) / 1000));
      const currentAttempt: PracticeAttempt = {
        id: `attempt-${endedAt.getTime()}`,
        presetId: selectedPreset.id,
        guitarMode: mode,
        category: selectedPreset.category,
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
      const recentAttempts = stored
        .map(sessionToAttempt)
        .filter((attempt): attempt is PracticeAttempt => Boolean(attempt));
      const nextDecision = decideNextPracticeStep(selectedPreset, [...recentAttempts, currentAttempt]);
      const timingNote = finalSnapshot.timingOffsetMs == null
        ? ''
        : ` · 박오차 ${timingLabel(finalSnapshot.timingOffsetMs)} · 흔들림 ${finalSnapshot.timingJitterMs ?? 0}ms`;
      const record: PracticeSessionRecord = {
        id: `session-${endedAt.getTime()}`,
        guitarMode: mode,
        category: selectedPreset.category,
        presetId: selectedPreset.id,
        title: selectedPreset.title,
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
        cameraMode: selectedPreset.cameraFocus,
        microphoneUsed: microphoneEnabled,
        metronomeUsed: true,
        notes: `${tensionReported ? '긴장 보고 · ' : ''}${nextDecision.reason}${timingNote}`,
      };
      await savePracticeSession(record);
      setSnapshot(finalSnapshot);
      setDecision(nextDecision);
      setBpm(nextDecision.nextBpm);
      setStatus(finalSnapshot.averageScore == null
        ? '저장 완료 · 유효 AI 표본이 부족해 점수는 제외했습니다.'
        : `저장 완료 · 평균 ${finalSnapshot.averageScore}점 · 다음 ${nextDecision.nextBpm} BPM`);
      accumulatorRef.current = null;
      startedAtRef.current = null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '세션 기록을 저장하지 못했습니다.');
      setStatus('저장 실패');
    } finally {
      setSaving(false);
    }
  };

  if (!selectedPreset) {
    return <View style={styles.center}><Text style={styles.statusText}>이 모드에 등록된 연습 루틴이 없습니다.</Text></View>;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>{mode === 'acoustic' ? '통기타' : '일렉기타'} · LIVE SESSION</Text>
          <Text style={styles.title}>{selectedPreset.title}</Text>
          <Text style={styles.statusText}>{status}</Text>
        </View>
        {onClose ? <Pressable disabled={running} onPress={onClose} style={[styles.closeButton, running && styles.disabled]}><Text style={styles.closeText}>닫기</Text></Pressable> : null}
      </View>

      <ScrollView horizontal style={styles.presetScroll} contentContainerStyle={styles.presetRow} showsHorizontalScrollIndicator={false}>
        {presets.map((preset) => (
          <Pressable
            key={preset.id}
            disabled={running}
            onPress={() => setSelectedPresetId(preset.id)}
            style={[styles.presetChip, preset.id === selectedPreset.id && styles.presetChipActive, running && styles.presetChipLocked]}
          >
            <Text style={[styles.presetChipText, preset.id === selectedPreset.id && styles.presetChipTextActive]}>{preset.title}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.controlCard}>
        <View style={styles.timeColumn}>
          <Text style={styles.timeLabel}>연습 시간</Text>
          <Text style={styles.timeValue}>{formatElapsed(elapsedSeconds)}</Text>
          <Text style={styles.cameraText}>{cameraLabel(selectedPreset)} · {pulsesForPreset(selectedPreset)}분할</Text>
        </View>
        <View style={styles.bpmColumn}>
          <Text style={styles.timeLabel}>현재 BPM</Text>
          <View style={styles.bpmRow}>
            <Pressable disabled={running} onPress={() => setBpm((value) => Math.max(35, value - 5))} style={[styles.stepButton, running && styles.disabled]}><Text style={styles.stepText}>-5</Text></Pressable>
            <Text style={styles.bpmValue}>{bpm}</Text>
            <Pressable disabled={running} onPress={() => setBpm((value) => Math.min(selectedPreset.targetBpm, value + 5))} style={[styles.stepButton, running && styles.disabled]}><Text style={styles.stepText}>+5</Text></Pressable>
          </View>
        </View>
      </View>

      <View style={styles.optionRow}>
        <View style={styles.switchWrap}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>마이크 박자 분석</Text>
            <Text style={styles.switchDetail}>실제 클릭 시각과 탄현 어택을 ms로 비교</Text>
          </View>
          <Switch disabled={running} value={microphoneEnabled} onValueChange={setMicrophoneEnabled} />
        </View>
        <View style={styles.switchWrap}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>긴장·통증</Text>
            <Text style={styles.switchDetail}>켜면 자동 증속을 중단하고 휴식 안내</Text>
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
        <Pressable onPress={() => running ? void stopAndSave() : void start()} style={[styles.startButton, running && styles.stopButton]}>
          <Text style={styles.startText}>{saving ? '저장 중…' : running ? '종료·자동 저장' : `${bpm} BPM 시작`}</Text>
        </Pressable>
      </View>

      {decision ? (
        <View style={styles.decisionCard}>
          <Text style={styles.decisionTitle}>다음 단계 · {decision.status === 'increase' ? '속도 증가' : decision.status === 'decrease' ? '속도 감소' : decision.status === 'stop' ? '연습 중지' : '현재 속도 유지'}</Text>
          <Text style={styles.decisionText}>{decision.reason}</Text>
          <Text style={styles.decisionFocus}>{decision.nextFocus}</Text>
        </View>
      ) : null}
      {snapshot.issues.length ? (
        <View style={styles.issueBar}>
          <Text style={styles.issueTitle}>현재 반복 문제</Text>
          <Text style={styles.issueText}>{snapshot.issues.slice(0, 3).map((issue) => `${issue.title} ${issue.count}`).join(' · ')}</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.coachWrap}>
        <LiveCoachDetailedAi />
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
  center: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  headerTextWrap: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', marginTop: 2 },
  statusText: { color: '#8b949e', fontSize: 9, lineHeight: 14, marginTop: 2 },
  closeButton: { minWidth: 48, height: 36, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  presetScroll: { maxHeight: 46, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  presetRow: { gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  presetChip: { minHeight: 31, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  presetChipActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  presetChipLocked: { opacity: 0.55 },
  presetChipText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  presetChipTextActive: { color: '#ffffff' },
  controlCard: { flexDirection: 'row', backgroundColor: '#161b22', borderBottomWidth: 1, borderBottomColor: '#30363d', padding: 10 },
  timeColumn: { flex: 1 },
  bpmColumn: { flex: 1, alignItems: 'flex-end' },
  timeLabel: { color: '#8b949e', fontSize: 8, fontWeight: '900' },
  timeValue: { color: '#7ee787', fontSize: 23, fontWeight: '900', marginTop: 2 },
  cameraText: { color: '#6e7681', fontSize: 8, marginTop: 2 },
  bpmRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  bpmValue: { color: '#f0f6fc', fontSize: 20, fontWeight: '900', minWidth: 42, textAlign: 'center' },
  stepButton: { width: 37, height: 32, borderRadius: 9, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  optionRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#30363d' },
  switchWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 7, borderRightWidth: 1, borderRightColor: '#30363d' },
  switchTextWrap: { flex: 1, paddingRight: 4 },
  switchTitle: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  switchDetail: { color: '#6e7681', fontSize: 7, lineHeight: 11, marginTop: 2 },
  metricRow: { flexDirection: 'row', gap: 4, padding: 7, backgroundColor: '#0d1117' },
  metricCard: { flex: 1, minWidth: 55, backgroundColor: '#161b22', borderRadius: 9, paddingVertical: 6, paddingHorizontal: 2, alignItems: 'center' },
  metricValue: { color: '#f0f6fc', fontSize: 8, fontWeight: '900', textAlign: 'center' },
  metricLabel: { color: '#6e7681', fontSize: 6, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingBottom: 7 },
  mistakeButton: { flex: 0.8, minHeight: 39, borderRadius: 10, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center' },
  mistakeText: { color: '#f2cc60', fontSize: 9, fontWeight: '900' },
  startButton: { flex: 1.2, minHeight: 39, borderRadius: 10, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  stopButton: { backgroundColor: '#da3633' },
  startText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  decisionCard: { backgroundColor: '#102418', borderWidth: 1, borderColor: '#2ea043', marginHorizontal: 8, marginBottom: 6, borderRadius: 11, padding: 8 },
  decisionTitle: { color: '#7ee787', fontSize: 9, fontWeight: '900' },
  decisionText: { color: '#b1bac4', fontSize: 8, lineHeight: 12, marginTop: 2 },
  decisionFocus: { color: '#f0f6fc', fontSize: 8, lineHeight: 12, fontWeight: '800', marginTop: 3 },
  issueBar: { backgroundColor: '#2d2208', borderWidth: 1, borderColor: '#9e6a03', marginHorizontal: 8, marginBottom: 6, borderRadius: 11, padding: 8 },
  issueTitle: { color: '#f2cc60', fontSize: 8, fontWeight: '900' },
  issueText: { color: '#d2b45c', fontSize: 8, lineHeight: 12, marginTop: 2 },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 12, marginHorizontal: 9, marginBottom: 5 },
  coachWrap: { flex: 1, minHeight: 360 },
  disabled: { opacity: 0.4 },
});
