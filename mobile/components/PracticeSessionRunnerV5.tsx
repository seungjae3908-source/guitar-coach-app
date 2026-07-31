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
import DetailedCoachPanelV2 from './DetailedCoachPanelV2';
import LiveDynamicsGraph from './LiveDynamicsGraph';
import StableCoachCamera from './StableCoachCamera';

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

function emptyDynamics(preset: PracticePreset): DynamicsSnapshot {
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

export default function PracticeSessionRunnerV5({
  mode,
  voiceCoachEnabled: _voiceCoachEnabled,
  onClose,
}: {
  mode: GuitarModeId;
  voiceCoachEnabled: boolean;
  onClose?: () => void;
}) {
  const presets = useMemo(() => getPracticePresetsForMode(mode), [mode]);
  const firstPreset = presets[0];
  const initialFocus = focusModeForCategory(firstPreset?.category);
  const [focusMode, setFocusMode] = useState<FocusPracticeMode>(initialFocus);
  const availableFocusModes = useMemo(
    () => FOCUS_MODE_OPTIONS.filter((option) => presets.some((item) => categoryMatchesFocusMode(item.category, option.id))),
    [presets],
  );
  const focusPresets = useMemo(
    () => presets.filter((item) => categoryMatchesFocusMode(item.category, focusMode)),
    [focusMode, presets],
  );
  const [selectedPresetId, setSelectedPresetId] = useState(firstPreset?.id ?? '');
  const preset = focusPresets.find((item) => item.id === selectedPresetId) ?? focusPresets[0] ?? firstPreset;
  const [bpm, setBpm] = useState(preset?.startBpm ?? 60);
  const bpmRef = useRef(bpm);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('카메라 관절 오버레이 준비 중');
  const [error, setError] = useState('');
  const [analyzedFrameCount, setAnalyzedFrameCount] = useState(0);
  const [previewAcceptedFrames, setPreviewAcceptedFrames] = useState(0);
  const [sessionAcceptedFrames, setSessionAcceptedFrames] = useState(0);
  const sessionAcceptedRef = useRef(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [metronomeActive, setMetronomeActive] = useState(false);
  const [autoProgress, setAutoProgress] = useState(true);
  const [trajectory, setTrajectory] = useState<TrajectoryCoachResult | null>(null);
  const [dynamics, setDynamics] = useState<DynamicsSnapshot>(() => preset ? emptyDynamics(preset) : {
    capturedAt: 0,
    points: [],
    issue: 'waiting',
    title: '실제 기타 어택 대기',
    observation: '',
    correction: '',
    reinforcement: '',
    confidencePercent: 0,
    accentMatchPercent: null,
    evennessPercent: null,
    completedCycles: 0,
    acceptedAttacks: 0,
  });
  const trajectoryRef = useRef<TrajectorySpeedCoach | null>(null);
  const dynamicsRef = useRef<DynamicsAccentAnalyzer | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
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
    const nextFirst = presets[0];
    const nextFocus = focusModeForCategory(nextFirst?.category);
    const nextPreset = presets.find((item) => categoryMatchesFocusMode(item.category, nextFocus)) ?? nextFirst;
    setFocusMode(nextFocus);
    setSelectedPresetId(nextPreset?.id ?? '');
    setBpm(nextPreset?.startBpm ?? 60);
    setRunning(false);
    runningRef.current = false;
    setStatus('카메라 관절 오버레이 준비 중');
    setAnalyzedFrameCount(0);
    setPreviewAcceptedFrames(0);
    setSessionAcceptedFrames(0);
    sessionAcceptedRef.current = 0;
    setTrajectory(null);
    setSessionStartedAt(null);
    if (nextPreset) setDynamics(emptyDynamics(nextPreset));
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
    setSessionAcceptedFrames(0);
    sessionAcceptedRef.current = 0;
    setSessionStartedAt(null);
    setStatus('카메라 관절 오버레이 준비 중');
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
    if (!running || !microphoneActive || !preset) return;
    const timer = setInterval(() => {
      void getLatestNativeAudioReadingAsync()
        .then((reading) => {
          const next = dynamicsRef.current?.addReading(reading, Date.now());
          if (!next) return;
          setDynamics(next);
          finalDynamicsRef.current = next;
          if (
            next.completedCycles >= 2
            && next.acceptedAttacks >= 8
            && next.issue !== 'waiting'
            && next.issue !== lastDynamicsIssueRef.current
          ) {
            lastDynamicsIssueRef.current = next.issue;
            publishLiveCoachFeedback(dynamicsFeedback(next, preset.category));
          }
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : '소리 분석값을 읽지 못했습니다.'));
    }, 80);
    return () => clearInterval(timer);
  }, [microphoneActive, preset, running]);

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
        message: '실제 기타 어택이 충분히 감지될 때만 강약을 판정합니다.',
        buttonPositive: '허용',
        buttonNegative: '카메라만 사용',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const applyBpm = async (nextBpm: number, capturedAt = Date.now()) => {
    if (!preset) return;
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
  };

  const handleAcceptedFrame = () => {
    setPreviewAcceptedFrames((value) => value + 1);
    if (!runningRef.current) return;
    sessionAcceptedRef.current += 1;
    setSessionAcceptedFrames(sessionAcceptedRef.current);
  };

  const handleMotionSample = (sample: MotionSample) => {
    if (!runningRef.current || !preset) return;
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
    setStatus('레슨 엔진 준비 중');
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
      setSessionStartedAt(startedAt);
      setElapsedSeconds(0);
      sessionAcceptedRef.current = 0;
      setSessionAcceptedFrames(0);

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
            setError(caught instanceof Error ? caught.message : '마이크 분석을 시작하지 못했습니다.');
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
      setStatus('손·자세 증거 수집 중 · 충분하기 전에는 판정 안 함');
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
    if (!runningRef.current || !preset || busy) return;
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
      if (trajectoryFinal?.state === 'broken' && sessionAcceptedRef.current >= 12) {
        issues.push({
          id: 'speed-trajectory-resilience',
          title: trajectoryFinal.title,
          count: Math.max(1, trajectoryFinal.brokenCycles),
          severity: 'high',
          confidencePercent: trajectoryFinal.confidencePercent,
        });
      }
      if (
        dynamicsFinal
        && dynamicsFinal.completedCycles >= 2
        && dynamicsFinal.acceptedAttacks >= 8
        && dynamicsFinal.issue !== 'stable'
        && dynamicsFinal.issue !== 'waiting'
      ) {
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
        averageScore: trajectoryFinal?.deviationPercent == null || sessionAcceptedRef.current < 12
          ? null
          : Math.max(0, 100 - trajectoryFinal.deviationPercent),
        bestScore: trajectoryFinal?.lastStableBpm && sessionAcceptedRef.current >= 12
          ? Math.min(100, 70 + Math.max(0, trajectoryFinal.lastStableBpm - preset.startBpm))
          : null,
        averageConfidencePercent: Math.round(meanSafe([
          sessionAcceptedRef.current >= 12 ? trajectoryFinal?.confidencePercent : null,
          dynamicsFinal && dynamicsFinal.completedCycles >= 2 ? dynamicsFinal.confidencePercent : null,
        ])),
        manualMistakes: 0,
        aiMistakes: issues.reduce((sum, issue) => sum + issue.count, 0),
        stableSeconds: trajectoryFinal?.stableCycles && sessionAcceptedRef.current >= 12 ? trajectoryFinal.stableCycles * 2 : 0,
        issues,
        nextAssignment: issues[0]?.title
          ? trajectoryFinal?.reinforcement ?? dynamicsFinal?.reinforcement ?? '신뢰 가능한 표본을 다시 수집하세요.'
          : `${Math.min(preset.targetBpm, bpmRef.current + 5)} BPM에서 같은 궤적과 강약을 유지하세요.`,
        cameraMode: preset.cameraFocus,
        microphoneUsed: Boolean(dynamicsFinal && dynamicsFinal.completedCycles >= 2),
        metronomeUsed: metronomeActive,
        notes: `카메라 승인 ${sessionAcceptedRef.current}프레임 · 실제 어택 ${dynamicsFinal?.acceptedAttacks ?? 0}개 · 자동상승 ${autoProgress ? '사용' : '미사용'}`,
      };
      await savePracticeSession(record);
      setStatus('저장 완료 · 카메라 오버레이는 계속 작동 중');
      startedAtRef.current = null;
      setSessionStartedAt(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '연습 기록 저장에 실패했습니다.');
      setStatus('기록 저장 실패 · 카메라 오버레이는 계속 작동 중');
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
    const nextPreset = presets.find((item) => categoryMatchesFocusMode(item.category, next));
    if (!nextPreset) return;
    setFocusMode(next);
    setSelectedPresetId(nextPreset.id);
  };

  if (!preset) {
    return <View style={styles.empty}><Text style={styles.emptyText}>등록된 집중교정 루틴이 없습니다.</Text></View>;
  }

  const lastStableBpm = trajectory?.lastStableBpm ?? preset.startBpm;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => void close()}>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0d1117" translucent={false} />

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>{mode === 'acoustic' ? '통기타' : '일렉기타'} · 집중교정 V5</Text>
            <Text style={styles.title} numberOfLines={1}>{preset.title}</Text>
            <Text style={styles.status} numberOfLines={2}>{status}</Text>
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

        <ScrollView
          style={styles.mainScroll}
          contentContainerStyle={styles.mainContent}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          <View style={styles.cameraCard}>
            <View style={styles.cameraArea}>
              <StableCoachCamera
                coachingActive={running}
                category={preset.category}
                cameraFocus={preset.cameraFocus}
                onMotionSample={handleMotionSample}
                onAcceptedFrame={handleAcceptedFrame}
                onFrameCount={setAnalyzedFrameCount}
                onStatus={(next) => {
                  if (!runningRef.current) setStatus(next);
                }}
              />
            </View>
            <View style={styles.cameraMetaRow}>
              <Text style={styles.cameraMeta}>분석 {analyzedFrameCount}프레임</Text>
              <Text style={styles.cameraMeta}>인식 {previewAcceptedFrames}프레임</Text>
              <Text style={styles.cameraMetaStrong}>{running ? `세션 증거 ${sessionAcceptedFrames}` : '레슨 전 판정 없음'}</Text>
            </View>
          </View>

          <LiveDynamicsGraph snapshot={dynamics} active={running && microphoneActive} />

          <DetailedCoachPanelV2
            running={running}
            preset={preset}
            trajectory={trajectory}
            dynamics={dynamics}
            acceptedFrameCount={sessionAcceptedFrames}
            sessionStartedAt={sessionStartedAt}
            microphoneActive={microphoneActive}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.dock}>
          <View style={styles.controlRow}>
            <Pressable disabled={busy} onPress={() => void applyBpm(bpmRef.current - 5)} style={styles.stepButton}>
              <Text style={styles.stepText}>−5</Text>
            </Pressable>
            <View style={styles.bpmBox}>
              <Text style={styles.bpmValue}>{bpm}</Text>
              <Text style={styles.bpmUnit}>BPM</Text>
            </View>
            <Pressable disabled={busy} onPress={() => void applyBpm(bpmRef.current + 5)} style={styles.stepButton}>
              <Text style={styles.stepText}>+5</Text>
            </Pressable>
            <View style={styles.stableBox}>
              <Text style={styles.stableLabel}>마지막 안정</Text>
              <Text style={styles.stableValue}>{lastStableBpm} BPM</Text>
            </View>
            <Pressable onPress={() => setAutoProgress((value) => !value)} style={[styles.autoButton, autoProgress && styles.autoButtonActive]}>
              <Text style={[styles.autoText, autoProgress && styles.autoTextActive]}>자동+5 {autoProgress ? 'ON' : 'OFF'}</Text>
            </Pressable>
          </View>
          <Pressable
            disabled={busy}
            onPress={() => running ? void stopAndSave() : void start()}
            style={[styles.startButton, running && styles.stopButton, busy && styles.disabled]}
          >
            <Text style={styles.startText}>{busy ? '처리 중' : running ? `종료·저장 ${formatElapsed(elapsedSeconds)}` : '레슨 시작'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function meanSafe(values: Array<number | null | undefined>) {
  const safe = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return safe.length ? safe.reduce((sum, value) => sum + value, 0) / safe.length : 0;
}

const androidStatusPadding = Platform.OS === 'android' ? Math.max(0, StatusBar.currentHeight ?? 0) : 0;
const androidBottomPadding = Platform.OS === 'android' ? 22 : 8;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117', paddingTop: androidStatusPadding },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117' },
  emptyText: { color: '#f0f6fc' },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#30363d', paddingHorizontal: 12, paddingVertical: 8 },
  headerText: { flex: 1, paddingRight: 9 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  title: { color: '#f0f6fc', fontSize: 15, lineHeight: 19, fontWeight: '900', marginTop: 2 },
  status: { color: '#8b949e', fontSize: 8, lineHeight: 12, marginTop: 2 },
  closeButton: { minWidth: 48, height: 38, borderRadius: 11, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#484f58', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  modeScroll: { maxHeight: 48, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  chipRow: { gap: 6, paddingHorizontal: 9, paddingVertical: 6 },
  modeChip: { minWidth: 78, height: 34, borderRadius: 11, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  modeChipActive: { borderColor: '#2ea043', backgroundColor: '#14251a' },
  modeText: { color: '#8b949e', fontSize: 9, fontWeight: '900' },
  modeTextActive: { color: '#7ee787' },
  presetScroll: { maxHeight: 43, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  presetRow: { gap: 6, paddingHorizontal: 9, paddingVertical: 6 },
  presetChip: { maxWidth: 220, height: 31, borderRadius: 9, backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  presetChipActive: { backgroundColor: '#238636' },
  presetText: { color: '#8b949e', fontSize: 8, fontWeight: '800' },
  presetTextActive: { color: '#ffffff' },
  mainScroll: { flex: 1, backgroundColor: '#0d1117' },
  mainContent: { padding: 10, gap: 10, paddingBottom: 18 },
  cameraCard: { borderWidth: 1, borderColor: '#30363d', borderRadius: 18, overflow: 'hidden', backgroundColor: '#000000' },
  cameraArea: { width: '100%', aspectRatio: 3 / 4, backgroundColor: '#000000' },
  cameraMetaRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, backgroundColor: '#111820', paddingHorizontal: 10, paddingVertical: 7 },
  cameraMeta: { color: '#8b949e', fontSize: 7, fontWeight: '800' },
  cameraMetaStrong: { color: '#7ee787', fontSize: 7, fontWeight: '900' },
  errorText: { color: '#ffb4ad', backgroundColor: '#2b1618', borderWidth: 1, borderColor: '#f85149', borderRadius: 12, fontSize: 8, lineHeight: 13, paddingHorizontal: 10, paddingVertical: 8 },
  dock: { borderTopWidth: 1, borderTopColor: '#30363d', backgroundColor: '#0d1117', paddingHorizontal: 10, paddingTop: 8, paddingBottom: androidBottomPadding, gap: 7 },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepButton: { width: 42, height: 38, borderRadius: 10, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#f0f6fc', fontSize: 11, fontWeight: '900' },
  bpmBox: { minWidth: 64, height: 38, borderRadius: 10, backgroundColor: '#161b22', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 3 },
  bpmValue: { color: '#7ee787', fontSize: 18, fontWeight: '900' },
  bpmUnit: { color: '#8b949e', fontSize: 7, fontWeight: '800' },
  stableBox: { flex: 1, minWidth: 72, height: 38, borderRadius: 10, backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  stableLabel: { color: '#6e7681', fontSize: 6, fontWeight: '800' },
  stableValue: { color: '#f0f6fc', fontSize: 9, fontWeight: '900', marginTop: 1 },
  autoButton: { minWidth: 70, height: 38, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  autoButtonActive: { borderColor: '#2ea043', backgroundColor: '#102418' },
  autoText: { color: '#8b949e', fontSize: 7, fontWeight: '900' },
  autoTextActive: { color: '#7ee787' },
  startButton: { width: '100%', minHeight: 48, borderRadius: 13, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  stopButton: { backgroundColor: '#da3633' },
  startText: { color: '#ffffff', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  disabled: { opacity: 0.44 },
});
