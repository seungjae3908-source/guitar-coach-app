import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  PermissionsAndroid,
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
import { clearLatestLiveAnalysisFrames } from '../services/analysis-stream';
import { loadBestCameraCalibration } from '../services/camera-calibration-store';
import { DynamicsAccentAnalyzer, type DynamicsSnapshot } from '../services/dynamics-accent-engine';
import { clearLiveCoachFeedback, publishLiveCoachFeedback } from '../services/live-coach-feedback';
import { clearLivePracticeContext, setLivePracticeContext } from '../services/practice-session-context';
import { savePracticeSession, type PracticeSessionRecord, type SessionIssue } from '../services/practice-session-store';
import {
  TrajectorySpeedCoach,
  type MotionSample,
  type TrajectoryCoachResult,
} from '../services/trajectory-speed-engine';
import AutoFocusCoachCamera from './AutoFocusCoachCamera';
import DetailedCoachPanelV2 from './DetailedCoachPanelV2';
import LiveDynamicsGraph from './LiveDynamicsGraph';

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

function emptyDynamics(preset: PracticePreset) {
  return new DynamicsAccentAnalyzer({ category: preset.category, pattern: preset.pattern }).getSnapshot();
}

function formatElapsed(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function trajectoryFeedback(result: TrajectoryCoachResult, category: PracticePreset['category']) {
  return {
    id: 'speed-trajectory-resilience',
    capturedAt: result.capturedAt,
    status: result.state === 'stable'
      ? 'success' as const
      : result.state === 'broken'
        ? 'warning' as const
        : result.state === 'cannot-judge'
          ? 'cannot-judge' as const
          : 'correction' as const,
    category,
    title: result.title,
    instruction: `${result.correction} 보강훈련: ${result.reinforcement}`,
    evidence: `${result.observation} 마지막 안정 속도 ${result.lastStableBpm} BPM.`,
    nextGoal: result.nextGoal,
    confidencePercent: result.confidencePercent,
    stableCount: result.stableCycles,
    priority: result.state === 'broken' ? 11 : result.state === 'stable' ? 8 : 9,
    measurements: [
      { label: '현재', value: `${result.currentBpm} BPM` },
      { label: '안정', value: `${result.lastStableBpm} BPM` },
      { label: '궤적 편차', value: result.deviationPercent == null ? '-' : `${result.deviationPercent}%` },
    ],
  };
}

function dynamicsFeedback(snapshot: DynamicsSnapshot, category: PracticePreset['category']) {
  return {
    id: `sound-dynamics-${snapshot.issue}`,
    capturedAt: snapshot.capturedAt,
    status: snapshot.issue === 'stable'
      ? 'success' as const
      : snapshot.issue === 'clipping'
        ? 'warning' as const
        : snapshot.issue === 'waiting'
          ? 'waiting' as const
          : 'correction' as const,
    category,
    title: snapshot.title,
    instruction: `${snapshot.correction} 보강훈련: ${snapshot.reinforcement}`,
    evidence: snapshot.observation,
    nextGoal: snapshot.reinforcement,
    confidencePercent: snapshot.confidencePercent,
    stableCount: snapshot.issue === 'stable' ? 1 : 0,
    priority: snapshot.issue === 'clipping' ? 7 : 6,
    measurements: [
      { label: '악센트', value: snapshot.accentMatchPercent == null ? '-' : `${snapshot.accentMatchPercent}%` },
      { label: '음량 안정', value: snapshot.evennessPercent == null ? '-' : `${snapshot.evennessPercent}%` },
    ],
  };
}

export default function PracticeSessionRunnerV4({
  mode,
  voiceCoachEnabled: _voiceCoachEnabled,
  onClose,
}: {
  mode: GuitarModeId;
  voiceCoachEnabled: boolean;
  onClose?: () => void;
}) {
  const presets = useMemo(() => getPracticePresetsForMode(mode), [mode]);
  const initialFocus = focusModeForCategory(presets[0]?.category);
  const [focusMode, setFocusMode] = useState<FocusPracticeMode>(initialFocus);
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
  const [bpm, setBpm] = useState(preset?.startBpm ?? 60);
  const bpmRef = useRef(bpm);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('AI 관절·각도·궤적 자동 분석 중');
  const [error, setError] = useState('');
  const [frameCount, setFrameCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [metronomeActive, setMetronomeActive] = useState(false);
  const [autoProgress, setAutoProgress] = useState(true);
  const [trajectory, setTrajectory] = useState<TrajectoryCoachResult | null>(null);
  const [dynamics, setDynamics] = useState<DynamicsSnapshot>(() => preset ? emptyDynamics(preset) : ({
    capturedAt: 0,
    points: [],
    issue: 'waiting',
    title: '강약 표본 대기',
    observation: '',
    correction: '',
    reinforcement: '',
    confidencePercent: 0,
    accentMatchPercent: null,
    evennessPercent: null,
    completedCycles: 0,
  }));
  const trajectoryRef = useRef<TrajectorySpeedCoach | null>(null);
  const dynamicsRef = useRef<DynamicsAccentAnalyzer | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const finalTrajectoryRef = useRef<TrajectoryCoachResult | null>(null);
  const finalDynamicsRef = useRef<DynamicsSnapshot | null>(null);
  const lastDynamicsIssueRef = useRef('');
  const lastTrajectoryPublishAtRef = useRef(0);
  const pulsesPerBeat = preset ? pulsesForPreset(preset) : 1;

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    const first = presets[0];
    const nextFocus = focusModeForCategory(first?.category);
    const firstPreset = presets.find((item) => categoryMatchesFocusMode(item.category, nextFocus)) ?? first;
    setFocusMode(nextFocus);
    setSelectedPresetId(firstPreset?.id ?? '');
    setBpm(firstPreset?.startBpm ?? 60);
    setRunning(false);
    setStatus('AI 관절·각도·궤적 자동 분석 중');
    setFrameCount(0);
    setTrajectory(null);
    if (firstPreset) setDynamics(emptyDynamics(firstPreset));
    clearLivePracticeContext();
    clearLiveCoachFeedback();
  }, [mode, presets]);

  useEffect(() => {
    if (!preset || running) return;
    setBpm(preset.startBpm);
    setTrajectory(null);
    setDynamics(emptyDynamics(preset));
    trajectoryRef.current = null;
    dynamicsRef.current = null;
    setStatus('AI 관절·각도·궤적 자동 분석 중');
    setError('');
    clearLiveCoachFeedback();
  }, [preset, running]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt) setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 250);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running || !metronomeActive) return;
    const timer = setInterval(() => {
      void getAdvancedMetronomeTimingStateAsync().catch((caught) => {
        setError(caught instanceof Error ? caught.message : '메트로놈 상태를 읽지 못했습니다.');
      });
    }, 90);
    return () => clearInterval(timer);
  }, [metronomeActive, running]);

  useEffect(() => {
    if (!running || !microphoneActive) return;
    const timer = setInterval(() => {
      void getLatestNativeAudioReadingAsync()
        .then((reading) => {
          const next = dynamicsRef.current?.addReading(reading, Date.now());
          if (!next) return;
          setDynamics(next);
          finalDynamicsRef.current = next;
          if (next.completedCycles > 0 && next.issue !== lastDynamicsIssueRef.current) {
            lastDynamicsIssueRef.current = next.issue;
            publishLiveCoachFeedback(dynamicsFeedback(next, preset.category));
          }
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : '소리 분석값을 읽지 못했습니다.'));
    }, 70);
    return () => clearInterval(timer);
  }, [microphoneActive, preset.category, running]);

  useEffect(() => () => {
    clearLivePracticeContext();
    clearLiveCoachFeedback();
    void stopAdvancedMetronomeAsync();
    void stopNativeAudioAnalysisAsync();
  }, []);

  const requestMicrophone = async () => {
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: '강약·악센트 분석 권한',
        message: '실제 음량 파형과 악센트 위치를 휴대폰 안에서 비교합니다.',
        buttonPositive: '허용',
        buttonNegative: '카메라만 사용',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const applyBpm = async (nextBpm: number, capturedAt = Date.now()) => {
    const safe = Math.min(preset.targetBpm, Math.max(35, Math.round(nextBpm)));
    bpmRef.current = safe;
    setBpm(safe);
    trajectoryRef.current?.updateBpm(safe, capturedAt);
    if (runningRef.current && metronomeActive) {
      try {
        await updateAdvancedMetronomeAsync(safe, 4, pulsesPerBeat, true, false, 0);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'BPM 변경에 실패했습니다.');
      }
    }
    if (runningRef.current) {
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
        pulsesPerBeat,
        microphoneEnabled: microphoneActive,
        calibrationConfidencePercent: null,
        startedAt: startedAtRef.current ?? capturedAt,
      });
    }
  };

  const handleMotionSample = (sample: MotionSample) => {
    if (!runningRef.current) return;
    const next = trajectoryRef.current?.addSample(sample);
    if (!next) return;
    setTrajectory(next);
    finalTrajectoryRef.current = next;
    if (sample.capturedAt - lastTrajectoryPublishAtRef.current >= 900 || next.state === 'broken') {
      lastTrajectoryPublishAtRef.current = sample.capturedAt;
      publishLiveCoachFeedback(trajectoryFeedback(next, preset.category));
    }
    if (!autoProgress) return;
    if (next.shouldIncreaseBpm) {
      const raised = Math.min(preset.targetBpm, bpmRef.current + 5);
      setStatus(`${bpmRef.current} BPM 안정 · ${raised} BPM으로 자동 상승`);
      void applyBpm(raised, sample.capturedAt);
    } else if (next.shouldReturnToStableBpm && bpmRef.current > next.lastStableBpm) {
      setStatus(`궤적 붕괴 감지 · 마지막 안정 ${next.lastStableBpm} BPM으로 복귀`);
      void applyBpm(next.lastStableBpm, sample.capturedAt);
    }
  };

  const start = async () => {
    if (!preset || busy) return;
    setBusy(true);
    setError('');
    setStatus('기준 궤적·메트로놈·강약 분석 준비 중');
    try {
      const calibration = await loadBestCameraCalibration({
        guitarMode: mode,
        cameraFacing: preset.cameraFocus === 'full-body' ? 'front' : 'back',
        mirrored: preset.cameraFocus === 'full-body',
      });
      const startedAt = Date.now();
      const trajectoryEngine = new TrajectorySpeedCoach({
        startBpm: bpmRef.current,
        targetBpm: preset.targetBpm,
        pulsesPerBeat,
        pattern: preset.pattern,
      });
      trajectoryRef.current = trajectoryEngine;
      const initialTrajectory = trajectoryEngine.start(startedAt);
      setTrajectory(initialTrajectory);
      finalTrajectoryRef.current = initialTrajectory;
      const dynamicsEngine = new DynamicsAccentAnalyzer({ category: preset.category, pattern: preset.pattern });
      dynamicsRef.current = dynamicsEngine;
      const initialDynamics = dynamicsEngine.reset(startedAt);
      setDynamics(initialDynamics);
      finalDynamicsRef.current = initialDynamics;
      lastDynamicsIssueRef.current = '';
      lastTrajectoryPublishAtRef.current = 0;
      clearLatestLiveAnalysisFrames();
      clearLiveCoachFeedback();
      startedAtRef.current = startedAt;
      setElapsedSeconds(0);

      let metroStarted = false;
      if (isAdvancedMetronomeAvailable) {
        try {
          await startAdvancedMetronomeAsync(bpmRef.current, 4, pulsesPerBeat, true, false, 0);
          metroStarted = true;
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : '메트로놈을 시작하지 못했습니다.');
        }
      }
      setMetronomeActive(metroStarted);

      let micStarted = false;
      if (isNativeAudioAnalysisAvailable) {
        const granted = await requestMicrophone();
        if (granted) {
          try {
            await startNativeAudioAnalysisAsync(440);
            micStarted = true;
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : '마이크 강약 분석을 시작하지 못했습니다.');
          }
        }
      }
      setMicrophoneActive(micStarted);

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
        pulsesPerBeat,
        microphoneEnabled: micStarted,
        calibrationConfidencePercent: calibration?.confidencePercent ?? null,
        startedAt,
      });
      runningRef.current = true;
      setRunning(true);
      setStatus('느린 속도 개인 기준 궤적 수집 중');
    } catch (caught) {
      clearLivePracticeContext();
      await stopAdvancedMetronomeAsync();
      await stopNativeAudioAnalysisAsync();
      setRunning(false);
      runningRef.current = false;
      setStatus('레슨 시작 실패');
      setError(caught instanceof Error ? caught.message : '레슨을 시작하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const stopAndSave = async () => {
    if (!running || busy) return;
    setBusy(true);
    runningRef.current = false;
    setRunning(false);
    clearLivePracticeContext();
    setStatus('분석 기록 저장 중');
    try {
      await stopAdvancedMetronomeAsync();
      await stopNativeAudioAnalysisAsync();
      setMetronomeActive(false);
      setMicrophoneActive(false);
      const endedAt = Date.now();
      const startedAt = startedAtRef.current ?? endedAt;
      const trajectoryFinal = finalTrajectoryRef.current;
      const dynamicsFinal = finalDynamicsRef.current;
      const issues: SessionIssue[] = [];
      if (trajectoryFinal?.state === 'broken') {
        issues.push({
          id: 'speed-trajectory-resilience',
          title: trajectoryFinal.title,
          count: Math.max(1, trajectoryFinal.brokenCycles),
          severity: 'high',
          confidencePercent: trajectoryFinal.confidencePercent,
        });
      }
      if (dynamicsFinal && dynamicsFinal.issue !== 'stable' && dynamicsFinal.issue !== 'waiting') {
        issues.push({
          id: `dynamics-${dynamicsFinal.issue}`,
          title: dynamicsFinal.title,
          count: 1,
          severity: dynamicsFinal.issue === 'clipping' ? 'high' : 'warn',
          confidencePercent: dynamicsFinal.confidencePercent,
        });
      }
      const record: PracticeSessionRecord = {
        id: `trajectory-session-${endedAt}`,
        guitarMode: mode,
        category: preset.category,
        presetId: preset.id,
        title: preset.title,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        durationSeconds: Math.max(1, Math.floor((endedAt - startedAt) / 1_000)),
        bpmStart: preset.startBpm,
        bpmEnd: bpmRef.current,
        averageScore: trajectoryFinal?.deviationPercent == null ? null : Math.max(0, 100 - trajectoryFinal.deviationPercent),
        bestScore: trajectoryFinal?.lastStableBpm ? Math.min(100, 70 + Math.max(0, trajectoryFinal.lastStableBpm - preset.startBpm)) : null,
        averageConfidencePercent: Math.round(meanSafe([
          trajectoryFinal?.confidencePercent,
          dynamicsFinal?.confidencePercent,
        ])),
        manualMistakes: 0,
        aiMistakes: issues.reduce((sum, issue) => sum + issue.count, 0),
        stableSeconds: trajectoryFinal?.stableCycles ? trajectoryFinal.stableCycles * 2 : 0,
        issues,
        nextAssignment: trajectoryFinal?.state === 'broken'
          ? trajectoryFinal.reinforcement
          : dynamicsFinal && dynamicsFinal.issue !== 'stable'
            ? dynamicsFinal.reinforcement
            : `${Math.min(preset.targetBpm, bpmRef.current + 5)} BPM에서 같은 궤적과 강약을 유지하세요.`,
        cameraMode: preset.cameraFocus,
        microphoneUsed: Boolean(dynamicsFinal?.completedCycles),
        metronomeUsed: metronomeActive,
        notes: `기준 ${trajectoryFinal?.baselineBpm ?? bpmRef.current} BPM · 마지막 안정 ${trajectoryFinal?.lastStableBpm ?? bpmRef.current} BPM · 자동상승 ${autoProgress ? '사용' : '미사용'}`,
      };
      await savePracticeSession(record);
      setStatus('저장 완료 · AI 자동 분석은 계속 작동 중');
      startedAtRef.current = null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '연습 기록 저장에 실패했습니다.');
      setStatus('기록 저장 실패 · AI 자동 분석은 계속 작동 중');
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (runningRef.current) await stopAndSave();
    onClose?.();
  };

  const selectFocus = (next: FocusPracticeMode) => {
    if (running) return;
    const first = presets.find((item) => categoryMatchesFocusMode(item.category, next));
    if (!first) return;
    setFocusMode(next);
    setSelectedPresetId(first.id);
  };

  if (!preset) {
    return <View style={styles.empty}><Text style={styles.emptyText}>등록된 집중교정 루틴이 없습니다.</Text></View>;
  }

  const lastStableBpm = trajectory?.lastStableBpm ?? preset.startBpm;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => void close()}>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0d1117" />

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>{mode === 'acoustic' ? '통기타' : '일렉기타'} · 궤적 유지 훈련</Text>
            <Text style={styles.title} numberOfLines={1}>{preset.title}</Text>
            <Text style={styles.status} numberOfLines={1}>{status}</Text>
          </View>
          <Pressable onPress={() => void close()} style={styles.closeButton}>
            <Text style={styles.closeText}>닫기</Text>
          </Pressable>
        </View>

        <ScrollView horizontal style={styles.modeScroll} contentContainerStyle={styles.chipRow} showsHorizontalScrollIndicator={false}>
          {availableFocusModes.map((item) => (
            <Pressable
              key={item.id}
              disabled={running}
              onPress={() => selectFocus(item.id)}
              style={[styles.modeChip, focusMode === item.id && styles.modeChipActive, running && styles.disabled]}
            >
              <Text style={[styles.modeText, focusMode === item.id && styles.modeTextActive]}>{item.label.replace(' 모드', '')}</Text>
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

        <View style={styles.cameraArea}>
          <AutoFocusCoachCamera
            coachingActive={running}
            category={preset.category}
            cameraFocus={preset.cameraFocus}
            onMotionSample={handleMotionSample}
            onFrameCount={setFrameCount}
            onStatus={(next) => {
              if (!runningRef.current) setStatus(next);
            }}
          />
        </View>

        <LiveDynamicsGraph snapshot={dynamics} active={running && microphoneActive} />

        <View style={styles.feedbackArea}>
          <DetailedCoachPanelV2 running={running} preset={preset} trajectory={trajectory} dynamics={dynamics} />
        </View>

        {error ? <Text style={styles.errorText} numberOfLines={2}>{error}</Text> : null}

        <View style={styles.dock}>
          <Pressable disabled={running && busy} onPress={() => void applyBpm(bpmRef.current - 5)} style={styles.stepButton}>
            <Text style={styles.stepText}>−5</Text>
          </Pressable>
          <View style={styles.bpmBox}>
            <Text style={styles.bpmValue}>{bpm}</Text>
            <Text style={styles.bpmUnit}>BPM</Text>
          </View>
          <Pressable disabled={running && busy} onPress={() => void applyBpm(bpmRef.current + 5)} style={styles.stepButton}>
            <Text style={styles.stepText}>+5</Text>
          </Pressable>
          <View style={styles.stableBox}>
            <Text style={styles.stableLabel}>마지막 안정</Text>
            <Text style={styles.stableValue}>{lastStableBpm} BPM</Text>
          </View>
          <Pressable onPress={() => setAutoProgress((value) => !value)} style={[styles.autoButton, autoProgress && styles.autoButtonActive]}>
            <Text style={[styles.autoText, autoProgress && styles.autoTextActive]}>자동+5 {autoProgress ? 'ON' : 'OFF'}</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => running ? void stopAndSave() : void start()}
            style={[styles.startButton, running && styles.stopButton, busy && styles.disabled]}
          >
            <Text style={styles.startText}>{busy ? '처리 중' : running ? `종료·저장 ${formatElapsed(elapsedSeconds)}` : '레슨 시작'}</Text>
          </Pressable>
        </View>

        <Text style={styles.frameCounter}>자동 분석 {frameCount}프레임 · 레슨 전에도 관절·각도·궤적 분석 작동</Text>
      </SafeAreaView>
    </Modal>
  );
}

function meanSafe(values: Array<number | null | undefined>) {
  const safe = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return safe.length ? safe.reduce((sum, value) => sum + value, 0) / safe.length : 0;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117' },
  emptyText: { color: '#f0f6fc' },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#30363d', paddingHorizontal: 9, paddingVertical: 5 },
  headerText: { flex: 1, paddingRight: 7 },
  eyebrow: { color: '#79c0ff', fontSize: 7, fontWeight: '900', letterSpacing: 0.6 },
  title: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', marginTop: 1 },
  status: { color: '#8b949e', fontSize: 7, marginTop: 1 },
  closeButton: { minWidth: 43, height: 32, borderRadius: 9, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#484f58', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  modeScroll: { maxHeight: 37, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  chipRow: { gap: 5, paddingHorizontal: 7, paddingVertical: 4 },
  modeChip: { minWidth: 67, height: 28, borderRadius: 9, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  modeChipActive: { borderColor: '#2ea043', backgroundColor: '#14251a' },
  modeText: { color: '#8b949e', fontSize: 8, fontWeight: '900' },
  modeTextActive: { color: '#7ee787' },
  presetScroll: { maxHeight: 35, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  presetRow: { gap: 5, paddingHorizontal: 7, paddingVertical: 4 },
  presetChip: { maxWidth: 190, height: 27, borderRadius: 8, backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  presetChipActive: { backgroundColor: '#238636' },
  presetText: { color: '#8b949e', fontSize: 7, fontWeight: '800' },
  presetTextActive: { color: '#ffffff' },
  cameraArea: { flex: 1.25, minHeight: 280, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  feedbackArea: { flex: 0.78, minHeight: 130, maxHeight: 210 },
  dock: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 4, borderTopWidth: 1, borderTopColor: '#30363d', backgroundColor: '#0d1117', paddingHorizontal: 6, paddingVertical: 5 },
  stepButton: { width: 31, height: 34, borderRadius: 9, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  bpmBox: { minWidth: 49, height: 34, borderRadius: 9, backgroundColor: '#161b22', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 2 },
  bpmValue: { color: '#7ee787', fontSize: 15, fontWeight: '900' },
  bpmUnit: { color: '#8b949e', fontSize: 6, fontWeight: '800' },
  stableBox: { minWidth: 55, height: 34, borderRadius: 9, backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  stableLabel: { color: '#6e7681', fontSize: 5, fontWeight: '800' },
  stableValue: { color: '#f0f6fc', fontSize: 8, fontWeight: '900', marginTop: 1 },
  autoButton: { minWidth: 55, height: 34, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  autoButtonActive: { borderColor: '#2ea043', backgroundColor: '#102418' },
  autoText: { color: '#8b949e', fontSize: 6, fontWeight: '900' },
  autoTextActive: { color: '#7ee787' },
  startButton: { flex: 1, minWidth: 75, height: 38, borderRadius: 10, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  stopButton: { backgroundColor: '#da3633' },
  startText: { color: '#ffffff', fontSize: 8, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#ffb4ad', backgroundColor: '#2b1618', fontSize: 7, lineHeight: 11, paddingHorizontal: 8, paddingVertical: 4 },
  frameCounter: { color: '#6e7681', backgroundColor: '#0d1117', fontSize: 6, textAlign: 'center', paddingBottom: 3 },
  disabled: { opacity: 0.44 },
});
