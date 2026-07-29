import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  getAdvancedMetronomeTimingStateAsync,
  isAdvancedMetronomeAvailable,
  MetronomeSoundPreset,
  prepareVoiceCountAsync,
  previewMetronomeSoundAsync,
  startAdvancedMetronomeAsync,
  stopAdvancedMetronomeAsync,
  updateAdvancedMetronomeAsync,
} from '../modules/guitar-coach-metronome';
import {
  isCoachSpeechAvailable,
  prepareCoachSpeechAsync,
  speakCoachPhraseAsync,
} from '../modules/guitar-coach-speech';

type Phase = 'idle' | 'count-in' | 'practice' | 'paused' | 'complete';
type IncreaseMode = 'off' | 'time' | 'bars';

const METERS = [
  { label: '2/4', beats: 2 },
  { label: '3/4', beats: 3 },
  { label: '4/4', beats: 4 },
  { label: '5/4', beats: 5 },
  { label: '6/8', beats: 6 },
  { label: '7/8', beats: 7 },
  { label: '9/8', beats: 9 },
  { label: '12/8', beats: 12 },
] as const;

const SUBDIVISIONS = [
  { value: 1 as const, label: '4분' },
  { value: 2 as const, label: '8분' },
  { value: 3 as const, label: '셋잇단' },
  { value: 4 as const, label: '16분' },
];

const SOUNDS: Array<{ value: MetronomeSoundPreset; label: string }> = [
  { value: 0, label: '클래식' },
  { value: 1, label: '높은 클릭' },
  { value: 2, label: '낮은 클릭' },
  { value: 3, label: '디지털' },
  { value: 4, label: '부드러운' },
];

const DURATIONS = [30, 60, 180, 300, 600];
const TIME_INTERVALS = [15, 30, 60, 120];
const BAR_INTERVALS = [2, 4, 8, 16];

function OptionButton({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.optionButton, active && styles.optionButtonActive, disabled && styles.disabled]}
    >
      <Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds}초`;
  return `${seconds / 60}분`;
}

export default function MetronomeProgramPanel() {
  const [startBpm, setStartBpm] = useState(60);
  const [currentBpm, setCurrentBpm] = useState(60);
  const [targetBpm, setTargetBpm] = useState(100);
  const [meterLabel, setMeterLabel] = useState('4/4');
  const [subdivision, setSubdivision] = useState<1 | 2 | 3 | 4>(1);
  const [soundPreset, setSoundPreset] = useState<MetronomeSoundPreset>(0);
  const [countInBars, setCountInBars] = useState(2);
  const [countInVoice, setCountInVoice] = useState(true);
  const [durationSeconds, setDurationSeconds] = useState(180);
  const [increaseMode, setIncreaseMode] = useState<IncreaseMode>('time');
  const [increaseStep, setIncreaseStep] = useState(2);
  const [timeIntervalSeconds, setTimeIntervalSeconds] = useState(30);
  const [barInterval, setBarInterval] = useState(4);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [countInPulsesRemaining, setCountInPulsesRemaining] = useState(0);
  const [completedBars, setCompletedBars] = useState(0);
  const [increaseCount, setIncreaseCount] = useState(0);
  const [status, setStatus] = useState('프로그램을 설정하고 시작하세요.');
  const [error, setError] = useState('');
  const phaseRef = useRef<Phase>('idle');
  const practiceStartedAtRef = useRef(0);
  const accumulatedBeforePauseRef = useRef(0);
  const countInStartPulseRef = useRef(0);
  const lastPulseCountRef = useRef(0);
  const lastBarPulseRef = useRef(-1);
  const lastIncreaseAtSecondsRef = useRef(0);
  const lastIncreaseAtBarsRef = useRef(0);
  const busyRef = useRef(false);

  const meter = useMemo(
    () => METERS.find((item) => item.label === meterLabel) ?? METERS[2],
    [meterLabel],
  );
  const pulsesPerBar = meter.beats * subdivision;
  const running = phase === 'count-in' || phase === 'practice';
  const locked = running || phase === 'paused';
  const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);
  const progressPercent = Math.min(100, Math.round(elapsedSeconds / Math.max(1, durationSeconds) * 100));

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const timing = await getAdvancedMetronomeTimingStateAsync();
        if (cancelled || !timing.running) return;
        const currentPhase = phaseRef.current;

        if (currentPhase === 'count-in') {
          const completed = Math.max(0, Math.floor(timing.absolutePulseCount - countInStartPulseRef.current));
          const total = countInBars * pulsesPerBar;
          const remaining = Math.max(0, total - completed);
          setCountInPulsesRemaining(remaining);
          if (remaining <= 0) {
            await updateAdvancedMetronomeAsync(
              currentBpm,
              meter.beats,
              subdivision,
              true,
              false,
              soundPreset,
            );
            phaseRef.current = 'practice';
            setPhase('practice');
            practiceStartedAtRef.current = Date.now();
            accumulatedBeforePauseRef.current = 0;
            lastPulseCountRef.current = 0;
            lastBarPulseRef.current = -1;
            setElapsedSeconds(0);
            setCompletedBars(0);
            setStatus(`연습 진행 중 · ${currentBpm} BPM`);
          }
        } else if (currentPhase === 'practice') {
          const elapsed = accumulatedBeforePauseRef.current + Math.floor((Date.now() - practiceStartedAtRef.current) / 1000);
          setElapsedSeconds(elapsed);

          if (timing.absolutePulseCount < lastPulseCountRef.current) {
            lastPulseCountRef.current = 0;
            lastBarPulseRef.current = -1;
          }
          if (
            timing.absolutePulseCount !== lastPulseCountRef.current &&
            timing.lastTickPulseIndex === pulsesPerBar - 1 &&
            timing.absolutePulseCount !== lastBarPulseRef.current
          ) {
            lastBarPulseRef.current = timing.absolutePulseCount;
            setCompletedBars((value) => value + 1);
          }
          lastPulseCountRef.current = timing.absolutePulseCount;

          if (elapsed >= durationSeconds) {
            await finishProgram();
            return;
          }

          const shouldIncreaseByTime = increaseMode === 'time' &&
            elapsed - lastIncreaseAtSecondsRef.current >= timeIntervalSeconds;
          const currentBars = completedBars;
          const shouldIncreaseByBars = increaseMode === 'bars' &&
            currentBars - lastIncreaseAtBarsRef.current >= barInterval;
          const atBarBoundary = timing.nextPulseIndex === 0 || timing.lastTickPulseIndex === pulsesPerBar - 1;

          if ((shouldIncreaseByTime || shouldIncreaseByBars) && atBarBoundary && currentBpm < targetBpm) {
            const nextBpm = Math.min(targetBpm, currentBpm + increaseStep);
            await updateAdvancedMetronomeAsync(
              nextBpm,
              meter.beats,
              subdivision,
              true,
              false,
              soundPreset,
            );
            setCurrentBpm(nextBpm);
            setIncreaseCount((value) => value + 1);
            lastIncreaseAtSecondsRef.current = elapsed;
            lastIncreaseAtBarsRef.current = currentBars;
            lastPulseCountRef.current = 0;
            lastBarPulseRef.current = -1;
            setStatus(nextBpm >= targetBpm ? `목표 ${targetBpm} BPM 도달` : `${nextBpm} BPM으로 자동 증가`);
            if (isCoachSpeechAvailable) {
              void speakCoachPhraseAsync(`${nextBpm} 비피엠`, { interrupt: true, speechRate: 1.05 }).catch(() => undefined);
            }
          }
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '프로그램 상태를 읽지 못했습니다.');
      } finally {
        if (!cancelled && phaseRef.current !== 'complete' && phaseRef.current !== 'idle') {
          timer = setTimeout(poll, 80);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    barInterval,
    completedBars,
    countInBars,
    currentBpm,
    durationSeconds,
    increaseMode,
    increaseStep,
    meter.beats,
    pulsesPerBar,
    running,
    soundPreset,
    subdivision,
    targetBpm,
    timeIntervalSeconds,
  ]);

  useEffect(() => () => {
    void stopAdvancedMetronomeAsync();
  }, []);

  const start = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError('');
    try {
      if (!isAdvancedMetronomeAvailable) throw new Error('고급 메트로놈 모듈이 APK에 없습니다.');
      if (countInVoice) await prepareVoiceCountAsync();
      if (isCoachSpeechAvailable) await prepareCoachSpeechAsync().catch(() => undefined);
      setCurrentBpm(startBpm);
      setElapsedSeconds(0);
      setCompletedBars(0);
      setIncreaseCount(0);
      accumulatedBeforePauseRef.current = 0;
      lastIncreaseAtSecondsRef.current = 0;
      lastIncreaseAtBarsRef.current = 0;
      lastPulseCountRef.current = 0;
      lastBarPulseRef.current = -1;

      if (countInBars > 0) {
        await startAdvancedMetronomeAsync(
          startBpm,
          meter.beats,
          subdivision,
          true,
          countInVoice,
          soundPreset,
        );
        countInStartPulseRef.current = 0;
        setCountInPulsesRemaining(countInBars * pulsesPerBar);
        phaseRef.current = 'count-in';
        setPhase('count-in');
        setStatus(`${countInBars}마디 카운트인`);
      } else {
        await startAdvancedMetronomeAsync(startBpm, meter.beats, subdivision, true, false, soundPreset);
        practiceStartedAtRef.current = Date.now();
        phaseRef.current = 'practice';
        setPhase('practice');
        setStatus(`연습 진행 중 · ${startBpm} BPM`);
      }
    } catch (caught) {
      await stopAdvancedMetronomeAsync();
      phaseRef.current = 'idle';
      setPhase('idle');
      setError(caught instanceof Error ? caught.message : '메트로놈 프로그램을 시작하지 못했습니다.');
    } finally {
      busyRef.current = false;
    }
  };

  const pause = async () => {
    if (phase !== 'practice' || busyRef.current) return;
    busyRef.current = true;
    try {
      accumulatedBeforePauseRef.current += Math.floor((Date.now() - practiceStartedAtRef.current) / 1000);
      await stopAdvancedMetronomeAsync();
      phaseRef.current = 'paused';
      setPhase('paused');
      setStatus(`일시정지 · ${currentBpm} BPM`);
    } finally {
      busyRef.current = false;
    }
  };

  const resume = async () => {
    if (phase !== 'paused' || busyRef.current) return;
    busyRef.current = true;
    setError('');
    try {
      await startAdvancedMetronomeAsync(currentBpm, meter.beats, subdivision, true, false, soundPreset);
      practiceStartedAtRef.current = Date.now();
      phaseRef.current = 'practice';
      setPhase('practice');
      setStatus(`재개 · ${currentBpm} BPM`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '프로그램을 재개하지 못했습니다.');
    } finally {
      busyRef.current = false;
    }
  };

  const finishProgram = async () => {
    await stopAdvancedMetronomeAsync();
    phaseRef.current = 'complete';
    setPhase('complete');
    setElapsedSeconds(durationSeconds);
    setStatus(`완료 · ${startBpm}에서 ${currentBpm} BPM · ${increaseCount}회 증가`);
    if (isCoachSpeechAvailable) {
      void speakCoachPhraseAsync('연습이 끝났습니다. 손과 손목에 힘을 빼고 잠시 쉬세요.', { interrupt: true, speechRate: 1.02 }).catch(() => undefined);
    }
  };

  const stop = async () => {
    await stopAdvancedMetronomeAsync();
    phaseRef.current = 'idle';
    setPhase('idle');
    setStatus('프로그램을 정지했습니다.');
  };

  const reset = async () => {
    await stopAdvancedMetronomeAsync();
    phaseRef.current = 'idle';
    setPhase('idle');
    setCurrentBpm(startBpm);
    setElapsedSeconds(0);
    setCompletedBars(0);
    setIncreaseCount(0);
    setCountInPulsesRemaining(0);
    setStatus('프로그램을 설정하고 시작하세요.');
    setError('');
  };

  const countInBeat = countInPulsesRemaining > 0
    ? Math.floor((countInBars * pulsesPerBar - countInPulsesRemaining) / subdivision) % meter.beats + 1
    : 1;
  const countInBar = countInPulsesRemaining > 0
    ? Math.floor((countInBars * pulsesPerBar - countInPulsesRemaining) / pulsesPerBar) + 1
    : countInBars;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>SMART METRONOME PROGRAM</Text>
      <Text style={styles.title}>카운트인·타이머·자동 BPM</Text>
      <Text style={styles.subtitle}>카운트인 후 연습을 시작하고, 설정한 시간 또는 마디마다 목표 BPM까지 자동으로 올립니다.</Text>

      <View style={styles.liveCard}>
        <View style={styles.liveMain}>
          <Text style={styles.liveLabel}>{phase === 'count-in' ? `카운트인 ${countInBar}마디 ${countInBeat}박` : phase === 'practice' ? '연습 진행' : phase === 'paused' ? '일시정지' : phase === 'complete' ? '완료' : '대기'}</Text>
          <Text style={styles.liveBpm}>{currentBpm}<Text style={styles.liveUnit}> BPM</Text></Text>
          <Text style={styles.liveStatus}>{status}</Text>
        </View>
        <View style={styles.timeBlock}>
          <Text style={styles.timeValue}>{formatDuration(remainingSeconds)}</Text>
          <Text style={styles.timeLabel}>남은 시간</Text>
          <Text style={styles.barLabel}>{completedBars}마디 · {increaseCount}회 증가</Text>
        </View>
      </View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progressPercent}%` }]} /></View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>시작 BPM / 목표 BPM</Text>
        <View style={styles.bpmSettingRow}>
          <View style={styles.bpmSettingBlock}>
            <Text style={styles.settingLabel}>시작</Text>
            <View style={styles.stepRow}>
              <OptionButton label="-5" onPress={() => setStartBpm((value) => Math.max(35, value - 5))} disabled={locked} />
              <Text style={styles.settingValue}>{startBpm}</Text>
              <OptionButton label="+5" onPress={() => setStartBpm((value) => Math.min(targetBpm, value + 5))} disabled={locked} />
            </View>
          </View>
          <View style={styles.bpmSettingBlock}>
            <Text style={styles.settingLabel}>목표</Text>
            <View style={styles.stepRow}>
              <OptionButton label="-5" onPress={() => setTargetBpm((value) => Math.max(startBpm, value - 5))} disabled={locked} />
              <Text style={styles.settingValue}>{targetBpm}</Text>
              <OptionButton label="+5" onPress={() => setTargetBpm((value) => Math.min(220, value + 5))} disabled={locked} />
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>박자</Text>
        <View style={styles.optionWrap}>{METERS.map((item) => <OptionButton key={item.label} label={item.label} active={meter.label === item.label} onPress={() => setMeterLabel(item.label)} disabled={locked} />)}</View>

        <Text style={styles.sectionTitle}>음표 분할</Text>
        <View style={styles.optionWrap}>{SUBDIVISIONS.map((item) => <OptionButton key={item.value} label={item.label} active={subdivision === item.value} onPress={() => setSubdivision(item.value)} disabled={locked} />)}</View>

        <Text style={styles.sectionTitle}>클릭 음원</Text>
        <View style={styles.optionWrap}>{SOUNDS.map((item) => <OptionButton key={item.value} label={item.label} active={soundPreset === item.value} onPress={() => setSoundPreset(item.value)} disabled={locked} />)}</View>
        {!locked ? <Pressable onPress={() => void previewMetronomeSoundAsync(soundPreset)} style={styles.previewButton}><Text style={styles.previewText}>선택 음원 미리듣기</Text></Pressable> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>카운트인 마디</Text>
        <View style={styles.optionWrap}>{[0, 1, 2, 4].map((value) => <OptionButton key={value} label={value === 0 ? '없음' : `${value}마디`} active={countInBars === value} onPress={() => setCountInBars(value)} disabled={locked} />)}</View>
        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}><Text style={styles.switchTitle}>카운트인 사람 음성</Text><Text style={styles.switchDetail}>원, 투, 쓰리, 포를 함께 읽습니다.</Text></View>
          <Switch disabled={locked || countInBars === 0} value={countInVoice} onValueChange={setCountInVoice} />
        </View>

        <Text style={styles.sectionTitle}>전체 연습 시간</Text>
        <View style={styles.optionWrap}>{DURATIONS.map((value) => <OptionButton key={value} label={durationLabel(value)} active={durationSeconds === value} onPress={() => setDurationSeconds(value)} disabled={locked} />)}</View>

        <Text style={styles.sectionTitle}>자동 BPM 증가 방식</Text>
        <View style={styles.optionWrap}>
          <OptionButton label="사용 안 함" active={increaseMode === 'off'} onPress={() => setIncreaseMode('off')} disabled={locked} />
          <OptionButton label="시간마다" active={increaseMode === 'time'} onPress={() => setIncreaseMode('time')} disabled={locked} />
          <OptionButton label="마디마다" active={increaseMode === 'bars'} onPress={() => setIncreaseMode('bars')} disabled={locked} />
        </View>

        {increaseMode !== 'off' ? (
          <>
            <Text style={styles.sectionTitle}>한 번에 증가</Text>
            <View style={styles.optionWrap}>{[1, 2, 3, 5].map((value) => <OptionButton key={value} label={`+${value}`} active={increaseStep === value} onPress={() => setIncreaseStep(value)} disabled={locked} />)}</View>
            <Text style={styles.sectionTitle}>{increaseMode === 'time' ? '증가 간격' : '증가 마디'}</Text>
            <View style={styles.optionWrap}>
              {(increaseMode === 'time' ? TIME_INTERVALS : BAR_INTERVALS).map((value) => (
                <OptionButton
                  key={value}
                  label={increaseMode === 'time' ? durationLabel(value) : `${value}마디`}
                  active={increaseMode === 'time' ? timeIntervalSeconds === value : barInterval === value}
                  onPress={() => increaseMode === 'time' ? setTimeIntervalSeconds(value) : setBarInterval(value)}
                  disabled={locked}
                />
              ))}
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        {phase === 'idle' || phase === 'complete' ? (
          <Pressable onPress={() => void start()} style={styles.startButton}><Text style={styles.startText}>{startBpm} BPM 프로그램 시작</Text></Pressable>
        ) : phase === 'practice' ? (
          <Pressable onPress={() => void pause()} style={styles.pauseButton}><Text style={styles.startText}>일시정지</Text></Pressable>
        ) : phase === 'paused' ? (
          <Pressable onPress={() => void resume()} style={styles.startButton}><Text style={styles.startText}>재개</Text></Pressable>
        ) : (
          <View style={styles.countInButton}><Text style={styles.startText}>카운트인 진행 중</Text></View>
        )}
        {phase !== 'idle' && phase !== 'complete' ? <Pressable onPress={() => void stop()} style={styles.stopButton}><Text style={styles.stopText}>정지</Text></Pressable> : null}
        {phase === 'complete' ? <Pressable onPress={() => void reset()} style={styles.resetButton}><Text style={styles.stopText}>초기화</Text></Pressable> : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 12, paddingBottom: 80 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 20, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#8b949e', fontSize: 9, lineHeight: 15, marginTop: 5 },
  liveCard: { flexDirection: 'row', backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 17, padding: 13, marginTop: 12 },
  liveMain: { flex: 1 },
  liveLabel: { color: '#8b949e', fontSize: 8, fontWeight: '900' },
  liveBpm: { color: '#7ee787', fontSize: 36, fontWeight: '900', marginTop: 2 },
  liveUnit: { fontSize: 11, color: '#b1bac4' },
  liveStatus: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 3 },
  timeBlock: { alignItems: 'flex-end', justifyContent: 'center' },
  timeValue: { color: '#f0f6fc', fontSize: 22, fontWeight: '900' },
  timeLabel: { color: '#8b949e', fontSize: 7, marginTop: 2 },
  barLabel: { color: '#79c0ff', fontSize: 7, marginTop: 6 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: '#21262d', overflow: 'hidden', marginTop: 7 },
  progressFill: { height: '100%', backgroundColor: '#2ea043' },
  card: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 11, marginTop: 10 },
  sectionTitle: { color: '#f0f6fc', fontSize: 10, fontWeight: '900', marginTop: 10, marginBottom: 6 },
  bpmSettingRow: { flexDirection: 'row', gap: 10 },
  bpmSettingBlock: { flex: 1 },
  settingLabel: { color: '#8b949e', fontSize: 7, fontWeight: '900', marginBottom: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  settingValue: { color: '#f0f6fc', fontSize: 18, fontWeight: '900', minWidth: 42, textAlign: 'center' },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  optionButton: { minHeight: 34, minWidth: 43, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  optionButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  optionText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  optionTextActive: { color: '#ffffff' },
  previewButton: { minHeight: 35, borderRadius: 10, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#111d2f', alignItems: 'center', justifyContent: 'center', marginTop: 7 },
  previewText: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  switchRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#30363d', marginTop: 9, paddingTop: 7 },
  switchTextWrap: { flex: 1, paddingRight: 8 },
  switchTitle: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  switchDetail: { color: '#8b949e', fontSize: 7, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 11 },
  startButton: { flex: 1.4, minHeight: 46, borderRadius: 12, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  pauseButton: { flex: 1.4, minHeight: 46, borderRadius: 12, backgroundColor: '#d29922', alignItems: 'center', justifyContent: 'center' },
  countInButton: { flex: 1.4, minHeight: 46, borderRadius: 12, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center' },
  stopButton: { flex: 0.7, minHeight: 46, borderRadius: 12, backgroundColor: '#da3633', alignItems: 'center', justifyContent: 'center' },
  resetButton: { flex: 0.7, minHeight: 46, borderRadius: 12, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center' },
  startText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  stopText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 13, marginTop: 8 },
  disabled: { opacity: 0.4 },
});
