import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import {
  getAdvancedMetronomeTimingStateAsync,
  isAdvancedMetronomeAvailable,
  type MetronomeSoundPreset,
  prepareVoiceCountAsync,
  previewMetronomeSoundAsync,
  startAdvancedMetronomeAsync,
  stopAdvancedMetronomeAsync,
  updateAdvancedMetronomeAsync,
} from '../modules/guitar-coach-metronome';

type Phase = 'idle' | 'count-in' | 'practice' | 'paused' | 'complete';
type IncreaseMode = 'off' | 'time' | 'bars';

const SOUNDS: Array<{ value: MetronomeSoundPreset; label: string }> = [
  { value: 0, label: '클래식' },
  { value: 1, label: '높은 클릭' },
  { value: 2, label: '낮은 클릭' },
  { value: 3, label: '디지털' },
  { value: 4, label: '부드러운' },
];
const SUBDIVISIONS = [1, 2, 3, 4] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function Stepper({
  label,
  value,
  unit,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <Pressable
          disabled={disabled || value <= min}
          onPress={() => onChange(clamp(value - 1, min, max))}
          style={[styles.stepButton, (disabled || value <= min) && styles.disabled]}
        >
          <Text style={styles.stepButtonText}>-1</Text>
        </Pressable>
        <View style={styles.stepValueWrap}>
          <Text style={styles.stepValue}>{value}</Text>
          {unit ? <Text style={styles.stepUnit}>{unit}</Text> : null}
        </View>
        <Pressable
          disabled={disabled || value >= max}
          onPress={() => onChange(clamp(value + 1, min, max))}
          style={[styles.stepButton, (disabled || value >= max) && styles.disabled]}
        >
          <Text style={styles.stepButtonText}>+1</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Choice({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.choice, active && styles.choiceActive, disabled && styles.disabled]}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function MetronomeProgramPanel() {
  const [startBpm, setStartBpm] = useState(60);
  const [targetBpm, setTargetBpm] = useState(100);
  const [currentBpm, setCurrentBpm] = useState(60);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
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
  const [completedBars, setCompletedBars] = useState(0);
  const [countInPulsesRemaining, setCountInPulsesRemaining] = useState(0);
  const [increaseCount, setIncreaseCount] = useState(0);
  const [status, setStatus] = useState('모든 숫자는 1단위로 조절할 수 있습니다.');
  const [error, setError] = useState('');

  const phaseRef = useRef<Phase>('idle');
  const busyRef = useRef(false);
  const currentBpmRef = useRef(60);
  const completedBarsRef = useRef(0);
  const practiceStartedAtRef = useRef(0);
  const accumulatedBeforePauseRef = useRef(0);
  const countInStartPulseRef = useRef(0);
  const lastPulseRef = useRef(-1);
  const lastBarPulseRef = useRef(-1);
  const lastIncreaseSecondsRef = useRef(0);
  const lastIncreaseBarsRef = useRef(0);

  const running = phase === 'count-in' || phase === 'practice';
  const locked = running || phase === 'paused';
  const pulsesPerBar = beatsPerBar * subdivision;
  const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);
  const progressPercent = Math.min(100, elapsedSeconds / Math.max(1, durationSeconds) * 100);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    currentBpmRef.current = currentBpm;
  }, [currentBpm]);

  useEffect(() => {
    completedBarsRef.current = completedBars;
  }, [completedBars]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = async () => {
      await stopAdvancedMetronomeAsync();
      phaseRef.current = 'complete';
      setPhase('complete');
      setElapsedSeconds(durationSeconds);
      setStatus(`완료 · ${startBpm} → ${currentBpmRef.current} BPM · ${increaseCount}회 증가`);
    };

    const poll = async () => {
      try {
        const timing = await getAdvancedMetronomeTimingStateAsync();
        if (cancelled || !timing.running) return;

        if (phaseRef.current === 'count-in') {
          const elapsedPulses = Math.max(0, timing.absolutePulseCount - countInStartPulseRef.current);
          const remaining = Math.max(0, countInBars * pulsesPerBar - elapsedPulses);
          setCountInPulsesRemaining(remaining);
          if (remaining <= 0) {
            await updateAdvancedMetronomeAsync(currentBpmRef.current, beatsPerBar, subdivision, true, false, soundPreset);
            practiceStartedAtRef.current = Date.now();
            accumulatedBeforePauseRef.current = 0;
            lastPulseRef.current = -1;
            lastBarPulseRef.current = -1;
            phaseRef.current = 'practice';
            setPhase('practice');
            setElapsedSeconds(0);
            setCompletedBars(0);
            setStatus(`연습 진행 중 · ${currentBpmRef.current} BPM`);
          }
        } else if (phaseRef.current === 'practice') {
          const elapsed = accumulatedBeforePauseRef.current + Math.floor((Date.now() - practiceStartedAtRef.current) / 1000);
          setElapsedSeconds(elapsed);
          if (elapsed >= durationSeconds) {
            await finish();
            return;
          }

          if (timing.absolutePulseCount !== lastPulseRef.current) {
            lastPulseRef.current = timing.absolutePulseCount;
            if (timing.lastTickPulseIndex === pulsesPerBar - 1 && timing.absolutePulseCount !== lastBarPulseRef.current) {
              lastBarPulseRef.current = timing.absolutePulseCount;
              const nextBars = completedBarsRef.current + 1;
              completedBarsRef.current = nextBars;
              setCompletedBars(nextBars);
            }
          }

          const currentBars = completedBarsRef.current;
          const timeReady = increaseMode === 'time' && elapsed - lastIncreaseSecondsRef.current >= timeIntervalSeconds;
          const barsReady = increaseMode === 'bars' && currentBars - lastIncreaseBarsRef.current >= barInterval;
          const atBoundary = timing.nextPulseIndex === 0 || timing.lastTickPulseIndex === pulsesPerBar - 1;
          if ((timeReady || barsReady) && atBoundary && currentBpmRef.current < targetBpm) {
            const nextBpm = Math.min(targetBpm, currentBpmRef.current + increaseStep);
            await updateAdvancedMetronomeAsync(nextBpm, beatsPerBar, subdivision, true, false, soundPreset);
            currentBpmRef.current = nextBpm;
            setCurrentBpm(nextBpm);
            setIncreaseCount((value) => value + 1);
            lastIncreaseSecondsRef.current = elapsed;
            lastIncreaseBarsRef.current = currentBars;
            setStatus(nextBpm >= targetBpm ? `목표 ${targetBpm} BPM 도달` : `${nextBpm} BPM으로 자동 증가`);
          }
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '메트로놈 상태를 읽지 못했습니다.');
      } finally {
        if (!cancelled && phaseRef.current !== 'idle' && phaseRef.current !== 'complete') timer = setTimeout(poll, 80);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [barInterval, beatsPerBar, countInBars, durationSeconds, increaseCount, increaseMode, increaseStep, pulsesPerBar, running, soundPreset, startBpm, subdivision, targetBpm, timeIntervalSeconds]);

  useEffect(() => () => {
    void stopAdvancedMetronomeAsync();
  }, []);

  const resetRuntime = () => {
    currentBpmRef.current = startBpm;
    completedBarsRef.current = 0;
    setCurrentBpm(startBpm);
    setElapsedSeconds(0);
    setCompletedBars(0);
    setIncreaseCount(0);
    setCountInPulsesRemaining(0);
    accumulatedBeforePauseRef.current = 0;
    lastIncreaseSecondsRef.current = 0;
    lastIncreaseBarsRef.current = 0;
    lastPulseRef.current = -1;
    lastBarPulseRef.current = -1;
  };

  const start = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError('');
    try {
      if (!isAdvancedMetronomeAvailable) throw new Error('고급 메트로놈 모듈이 APK에 없습니다.');
      if (countInVoice && countInBars > 0) await prepareVoiceCountAsync();
      resetRuntime();
      await startAdvancedMetronomeAsync(startBpm, beatsPerBar, subdivision, true, countInVoice && countInBars > 0, soundPreset);
      if (countInBars > 0) {
        countInStartPulseRef.current = 0;
        setCountInPulsesRemaining(countInBars * pulsesPerBar);
        phaseRef.current = 'count-in';
        setPhase('count-in');
        setStatus(`${countInBars}마디 카운트인`);
      } else {
        practiceStartedAtRef.current = Date.now();
        phaseRef.current = 'practice';
        setPhase('practice');
        setStatus(`연습 진행 중 · ${startBpm} BPM`);
      }
    } catch (caught) {
      await stopAdvancedMetronomeAsync();
      phaseRef.current = 'idle';
      setPhase('idle');
      setError(caught instanceof Error ? caught.message : '메트로놈을 시작하지 못했습니다.');
    } finally {
      busyRef.current = false;
    }
  };

  const pause = async () => {
    if (phase !== 'practice' || busyRef.current) return;
    busyRef.current = true;
    accumulatedBeforePauseRef.current += Math.floor((Date.now() - practiceStartedAtRef.current) / 1000);
    await stopAdvancedMetronomeAsync();
    phaseRef.current = 'paused';
    setPhase('paused');
    setStatus(`일시정지 · ${currentBpmRef.current} BPM`);
    busyRef.current = false;
  };

  const resume = async () => {
    if (phase !== 'paused' || busyRef.current) return;
    busyRef.current = true;
    try {
      await startAdvancedMetronomeAsync(currentBpmRef.current, beatsPerBar, subdivision, true, false, soundPreset);
      practiceStartedAtRef.current = Date.now();
      phaseRef.current = 'practice';
      setPhase('practice');
      setStatus(`재개 · ${currentBpmRef.current} BPM`);
    } finally {
      busyRef.current = false;
    }
  };

  const stop = async () => {
    await stopAdvancedMetronomeAsync();
    phaseRef.current = 'idle';
    setPhase('idle');
    setStatus('정지했습니다. 설정값은 유지됩니다.');
  };

  const setStart = (value: number) => {
    const next = clamp(value, 35, 220);
    setStartBpm(next);
    if (targetBpm < next) setTargetBpm(next);
    if (!locked) setCurrentBpm(next);
  };

  const setTarget = (value: number) => setTargetBpm(clamp(value, startBpm, 220));
  const countInBeat = countInPulsesRemaining > 0
    ? Math.floor((countInBars * pulsesPerBar - countInPulsesRemaining) / subdivision) % beatsPerBar + 1
    : 1;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>PRECISION SMART METRONOME</Text>
      <Text style={styles.title}>전 항목 1단위 정밀 조절</Text>
      <Text style={styles.subtitle}>BPM·시간·카운트인·자동 증가량과 간격을 모두 1단위로 맞춥니다.</Text>

      <View style={styles.liveCard}>
        <View style={styles.liveMain}>
          <Text style={styles.liveLabel}>{phase === 'count-in' ? `카운트인 ${countInBeat}박` : phase === 'practice' ? '연습 진행' : phase === 'paused' ? '일시정지' : phase === 'complete' ? '완료' : '대기'}</Text>
          <Text style={styles.liveBpm}>{currentBpm}<Text style={styles.liveUnit}> BPM</Text></Text>
          <Text style={styles.liveStatus}>{status}</Text>
        </View>
        <View style={styles.timeBlock}>
          <Text style={styles.timeValue}>{formatDuration(remainingSeconds)}</Text>
          <Text style={styles.timeLabel}>남은 시간</Text>
          <Text style={styles.barLabel}>{completedBars}마디 · 증속 {increaseCount}회</Text>
        </View>
      </View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progressPercent}%` }]} /></View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>속도</Text>
        <View style={styles.twoColumn}>
          <Stepper label="시작 BPM" value={startBpm} unit="BPM" min={35} max={220} disabled={locked} onChange={setStart} />
          <Stepper label="목표 BPM" value={targetBpm} unit="BPM" min={startBpm} max={220} disabled={locked} onChange={setTarget} />
        </View>
        <Text style={styles.sectionTitle}>박자와 분할</Text>
        <Stepper label="한 마디 박 수" value={beatsPerBar} unit="박" min={1} max={12} disabled={locked} onChange={setBeatsPerBar} />
        <View style={styles.choiceWrap}>{SUBDIVISIONS.map((value) => <Choice key={value} label={value === 1 ? '4분' : value === 2 ? '8분' : value === 3 ? '셋잇단' : '16분'} active={subdivision === value} disabled={locked} onPress={() => setSubdivision(value)} />)}</View>
        <Text style={styles.sectionTitle}>클릭 음원</Text>
        <View style={styles.choiceWrap}>{SOUNDS.map((item) => <Choice key={item.value} label={item.label} active={soundPreset === item.value} disabled={locked} onPress={() => setSoundPreset(item.value)} />)}</View>
        {!locked ? <Pressable onPress={() => void previewMetronomeSoundAsync(soundPreset)} style={styles.previewButton}><Text style={styles.previewText}>선택 음원 미리듣기</Text></Pressable> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>시간과 카운트인</Text>
        <View style={styles.twoColumn}>
          <Stepper label="전체 연습 시간" value={durationSeconds} unit="초" min={1} max={3600} disabled={locked} onChange={setDurationSeconds} />
          <Stepper label="카운트인" value={countInBars} unit="마디" min={0} max={16} disabled={locked} onChange={setCountInBars} />
        </View>
        <View style={styles.quickRow}>
          <Pressable disabled={locked} onPress={() => setDurationSeconds((value) => clamp(value - 60, 1, 3600))} style={[styles.quickButton, locked && styles.disabled]}><Text style={styles.quickText}>시간 -60초</Text></Pressable>
          <Pressable disabled={locked} onPress={() => setDurationSeconds((value) => clamp(value + 60, 1, 3600))} style={[styles.quickButton, locked && styles.disabled]}><Text style={styles.quickText}>시간 +60초</Text></Pressable>
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}><Text style={styles.switchTitle}>카운트인 음성</Text><Text style={styles.switchDetail}>카운트인 동안 박을 음성으로 읽습니다.</Text></View>
          <Switch disabled={locked || countInBars === 0} value={countInVoice} onValueChange={setCountInVoice} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>자동 BPM 증가</Text>
        <View style={styles.choiceWrap}>
          <Choice label="사용 안 함" active={increaseMode === 'off'} disabled={locked} onPress={() => setIncreaseMode('off')} />
          <Choice label="시간마다" active={increaseMode === 'time'} disabled={locked} onPress={() => setIncreaseMode('time')} />
          <Choice label="마디마다" active={increaseMode === 'bars'} disabled={locked} onPress={() => setIncreaseMode('bars')} />
        </View>
        {increaseMode !== 'off' ? (
          <View style={styles.twoColumn}>
            <Stepper label="한 번 증가량" value={increaseStep} unit="BPM" min={1} max={30} disabled={locked} onChange={setIncreaseStep} />
            {increaseMode === 'time'
              ? <Stepper label="증가 간격" value={timeIntervalSeconds} unit="초" min={1} max={600} disabled={locked} onChange={setTimeIntervalSeconds} />
              : <Stepper label="증가 간격" value={barInterval} unit="마디" min={1} max={128} disabled={locked} onChange={setBarInterval} />}
          </View>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        {phase === 'idle' || phase === 'complete'
          ? <Pressable onPress={() => void start()} style={styles.startButton}><Text style={styles.actionText}>{startBpm} BPM 시작</Text></Pressable>
          : phase === 'practice'
            ? <Pressable onPress={() => void pause()} style={styles.pauseButton}><Text style={styles.actionText}>일시정지</Text></Pressable>
            : phase === 'paused'
              ? <Pressable onPress={() => void resume()} style={styles.startButton}><Text style={styles.actionText}>재개</Text></Pressable>
              : <View style={styles.countButton}><Text style={styles.actionText}>카운트인 중</Text></View>}
        {phase !== 'idle' && phase !== 'complete' ? <Pressable onPress={() => void stop()} style={styles.stopButton}><Text style={styles.actionText}>정지</Text></Pressable> : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 12, paddingBottom: 90 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 20, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#8b949e', fontSize: 9, lineHeight: 15, marginTop: 5 },
  liveCard: { flexDirection: 'row', borderRadius: 17, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 13, marginTop: 12 },
  liveMain: { flex: 1 },
  liveLabel: { color: '#8b949e', fontSize: 8, fontWeight: '900' },
  liveBpm: { color: '#7ee787', fontSize: 36, fontWeight: '900', marginTop: 2 },
  liveUnit: { color: '#b1bac4', fontSize: 11 },
  liveStatus: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 3 },
  timeBlock: { alignItems: 'flex-end', justifyContent: 'center' },
  timeValue: { color: '#f0f6fc', fontSize: 22, fontWeight: '900' },
  timeLabel: { color: '#8b949e', fontSize: 7, marginTop: 2 },
  barLabel: { color: '#79c0ff', fontSize: 7, marginTop: 6 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: '#21262d', overflow: 'hidden', marginTop: 7 },
  progressFill: { height: '100%', backgroundColor: '#2ea043' },
  card: { backgroundColor: '#161b22', borderRadius: 16, borderWidth: 1, borderColor: '#30363d', padding: 11, marginTop: 10 },
  sectionTitle: { color: '#f0f6fc', fontSize: 10, fontWeight: '900', marginTop: 8, marginBottom: 7 },
  twoColumn: { flexDirection: 'row', gap: 8 },
  stepper: { flex: 1, minWidth: 0, borderRadius: 12, backgroundColor: '#0d1117', padding: 8, marginBottom: 7 },
  stepperLabel: { color: '#8b949e', fontSize: 7, fontWeight: '900', textAlign: 'center' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  stepButton: { width: 40, minHeight: 34, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  stepButtonText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  stepValueWrap: { flex: 1, alignItems: 'center' },
  stepValue: { color: '#7ee787', fontSize: 20, fontWeight: '900' },
  stepUnit: { color: '#8b949e', fontSize: 6 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  choice: { minHeight: 34, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  choiceActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  choiceText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  choiceTextActive: { color: '#ffffff' },
  previewButton: { minHeight: 35, borderRadius: 10, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#111d2f', alignItems: 'center', justifyContent: 'center', marginTop: 7 },
  previewText: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  quickRow: { flexDirection: 'row', gap: 6 },
  quickButton: { flex: 1, minHeight: 34, borderRadius: 9, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  quickText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  switchRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#30363d', marginTop: 9, paddingTop: 7 },
  switchTextWrap: { flex: 1, paddingRight: 8 },
  switchTitle: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  switchDetail: { color: '#8b949e', fontSize: 7, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 11 },
  startButton: { flex: 1.4, minHeight: 46, borderRadius: 12, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  pauseButton: { flex: 1.4, minHeight: 46, borderRadius: 12, backgroundColor: '#d29922', alignItems: 'center', justifyContent: 'center' },
  countButton: { flex: 1.4, minHeight: 46, borderRadius: 12, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center' },
  stopButton: { flex: 0.8, minHeight: 46, borderRadius: 12, backgroundColor: '#da3633', alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 13, marginTop: 8 },
  disabled: { opacity: 0.38 },
});
