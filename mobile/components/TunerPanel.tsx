import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getLatestNativeAudioReadingAsync,
  isNativeAudioAnalysisAvailable,
  NativeAudioReading,
  startNativeAudioAnalysisAsync,
  stopNativeAudioAnalysisAsync,
  updateNativeAudioReferenceAsync,
} from '../modules/guitar-coach-audio';
import { evaluateAnalysisQuality } from '../services/analysis-confidence';
import {
  createTunerReading,
  GUITAR_TUNINGS,
  GuitarTuning,
  GuitarTuningId,
  matchReadingToTuning,
} from '../services/tuner-engine';

type BuiltInTuningId = Exclude<GuitarTuningId, 'custom'>;

const TUNING_IDS: BuiltInTuningId[] = ['standard', 'drop-d', 'half-step-down', 'dadgad', 'open-g'];

function tuningLabel(id: BuiltInTuningId) {
  if (id === 'standard') return '표준';
  if (id === 'drop-d') return 'Drop D';
  if (id === 'half-step-down') return '반음↓';
  if (id === 'dadgad') return 'DADGAD';
  return 'Open G';
}

export default function TunerPanel() {
  const [running, setRunning] = useState(false);
  const [referenceA4, setReferenceA4] = useState(440);
  const [tuningId, setTuningId] = useState<BuiltInTuningId>('standard');
  const [nativeReading, setNativeReading] = useState<NativeAudioReading | null>(null);
  const [error, setError] = useState('');
  const actionBusyRef = useRef(false);

  const tuning: GuitarTuning = GUITAR_TUNINGS[tuningId];
  const tunerReading = useMemo(() => {
    if (!nativeReading?.hasPitch) return null;
    return createTunerReading(
      nativeReading.frequencyHz,
      nativeReading.pitchConfidence,
      referenceA4,
    );
  }, [nativeReading, referenceA4]);
  const tuningMatch = useMemo(
    () => tunerReading ? matchReadingToTuning(tunerReading, tuning, referenceA4) : null,
    [referenceA4, tunerReading, tuning],
  );
  const quality = useMemo(() => evaluateAnalysisQuality({
    source: 'microphone',
    confidence: nativeReading?.pitchConfidence ?? 0,
    noiseFloor: nativeReading?.noiseFloor,
    clippingRatio: nativeReading?.clippingRatio,
    sampleCount: nativeReading?.sampleCount ? 4 : 0,
  }), [nativeReading]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const reading = await getLatestNativeAudioReadingAsync();
        if (!cancelled) {
          setNativeReading(reading);
          setError('');
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '튜너 값을 읽지 못했습니다.');
      } finally {
        if (!cancelled) timer = setTimeout(poll, 120);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [running]);

  useEffect(() => () => { void stopNativeAudioAnalysisAsync(); }, []);

  useEffect(() => {
    if (!running) return;
    void updateNativeAudioReferenceAsync(referenceA4).catch((caught) => {
      setError(caught instanceof Error ? caught.message : '기준 주파수를 바꾸지 못했습니다.');
    });
  }, [referenceA4, running]);

  const requestMicrophonePermission = async () => {
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: '마이크 권한',
        message: '튜너와 연주 어택 분석을 휴대폰 안에서 처리하기 위해 마이크 권한이 필요합니다.',
        buttonPositive: '허용',
        buttonNegative: '취소',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const toggle = async () => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    setError('');
    try {
      if (running) {
        await stopNativeAudioAnalysisAsync();
        setRunning(false);
        setNativeReading(null);
        return;
      }
      if (!isNativeAudioAnalysisAvailable) throw new Error('이 APK에는 마이크 튜너 모듈이 없습니다.');
      const granted = await requestMicrophonePermission();
      if (!granted) throw new Error('마이크 권한이 허용되지 않았습니다.');
      await startNativeAudioAnalysisAsync(referenceA4);
      setRunning(true);
    } catch (caught) {
      setRunning(false);
      setError(caught instanceof Error ? caught.message : '튜너를 시작하지 못했습니다.');
    } finally {
      actionBusyRef.current = false;
    }
  };

  const cents = tuningMatch?.centsFromTarget ?? tunerReading?.cents ?? 0;
  const inTune = Boolean(tunerReading && tuningMatch && Math.abs(cents) <= 4 && quality.allowed);
  const noteText = quality.allowed && tunerReading
    ? `${tunerReading.noteName}${tunerReading.octave}`
    : running
      ? '소리 대기'
      : '튜너 꺼짐';
  const direction = !tunerReading || !quality.allowed
    ? '한 줄씩 길게 튕겨 주세요.'
    : inTune
      ? '정확합니다.'
      : cents < 0
        ? '음이 낮습니다. 줄을 조금 조이세요.'
        : '음이 높습니다. 줄을 조금 풀어 주세요.';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>LIVE CHROMATIC TUNER</Text>
          <Text style={styles.title}>마이크 기타 튜너</Text>
          <Text style={styles.subtitle}>음원은 서버로 보내지 않고 휴대폰 안에서 분석합니다.</Text>
        </View>
        <Pressable onPress={() => void toggle()} style={({ pressed }) => [styles.powerButton, running && styles.stopButton, pressed && styles.pressed]}>
          <Text style={styles.powerText}>{running ? '정지' : '시작'}</Text>
        </Pressable>
      </View>

      <View style={[styles.readingCard, inTune && styles.readingCardGood]}>
        <Text style={[styles.note, inTune && styles.noteGood]}>{noteText}</Text>
        <Text style={styles.targetText}>
          {tuningMatch ? `${tuningMatch.stringNumber}번 줄 · 목표 ${tuningMatch.targetNote}` : tuning.title}
        </Text>
        <Text style={[styles.centsText, inTune && styles.centsGood]}>
          {tunerReading && quality.allowed ? `${cents >= 0 ? '+' : ''}${cents.toFixed(1)} cent` : '-- cent'}
        </Text>
        <Text style={styles.direction}>{direction}</Text>
      </View>

      <Text style={styles.sectionTitle}>튜닝</Text>
      <View style={styles.optionWrap}>
        {TUNING_IDS.map((id) => (
          <Pressable key={id} onPress={() => setTuningId(id)} style={({ pressed }) => [styles.option, tuningId === id && styles.optionActive, pressed && styles.pressed]}>
            <Text style={[styles.optionText, tuningId === id && styles.optionTextActive]}>{tuningLabel(id)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>기준 A4</Text>
      <View style={styles.referenceRow}>
        <Pressable onPress={() => setReferenceA4((value) => Math.max(430, value - 1))} style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
          <Text style={styles.smallButtonText}>-1</Text>
        </Pressable>
        <Text style={styles.referenceValue}>{referenceA4} Hz</Text>
        <Pressable onPress={() => setReferenceA4((value) => Math.min(450, value + 1))} style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
          <Text style={styles.smallButtonText}>+1</Text>
        </Pressable>
      </View>

      <View style={styles.metricsRow}>
        <Metric label="피치 신뢰도" value={`${Math.round((nativeReading?.pitchConfidence ?? 0) * 100)}%`} />
        <Metric label="입력 RMS" value={(nativeReading?.rms ?? 0).toFixed(3)} />
        <Metric label="어택" value={`${nativeReading?.attackCount ?? 0}회`} />
        <Metric label="간격" value={(nativeReading?.attackIntervalMs ?? 0) > 0 ? `${Math.round(nativeReading!.attackIntervalMs)}ms` : '-'} />
      </View>

      {!quality.allowed && running ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>{quality.primaryMessage}</Text>
          {quality.actions.slice(0, 2).map((action) => <Text key={action} style={styles.warningText}>• {action}</Text>)}
        </View>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
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
  card: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 20, padding: 15 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTextWrap: { flex: 1, paddingRight: 10 },
  eyebrow: { color: '#79c0ff', fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  title: { color: '#f0f6fc', fontSize: 18, fontWeight: '900', marginTop: 4 },
  subtitle: { color: '#8b949e', fontSize: 10, lineHeight: 15, marginTop: 4 },
  powerButton: { minWidth: 60, minHeight: 42, borderRadius: 13, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  stopButton: { backgroundColor: '#da3633' },
  powerText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  readingCard: { alignItems: 'center', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, padding: 15, marginTop: 14 },
  readingCardGood: { borderColor: '#2ea043', backgroundColor: '#102418' },
  note: { color: '#f0f6fc', fontSize: 43, fontWeight: '900' },
  noteGood: { color: '#7ee787' },
  targetText: { color: '#8b949e', fontSize: 10, fontWeight: '800', marginTop: 2 },
  centsText: { color: '#f2cc60', fontSize: 19, fontWeight: '900', marginTop: 7 },
  centsGood: { color: '#7ee787' },
  direction: { color: '#b1bac4', fontSize: 11, marginTop: 5, textAlign: 'center' },
  sectionTitle: { color: '#f0f6fc', fontSize: 11, fontWeight: '900', marginTop: 14, marginBottom: 7 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { minHeight: 37, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  optionActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  optionText: { color: '#b1bac4', fontSize: 9, fontWeight: '900' },
  optionTextActive: { color: '#ffffff' },
  referenceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallButton: { width: 50, height: 40, borderRadius: 11, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center' },
  smallButtonText: { color: '#f0f6fc', fontSize: 11, fontWeight: '900' },
  referenceValue: { flex: 1, color: '#7ee787', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  metricsRow: { flexDirection: 'row', gap: 5, marginTop: 14 },
  metricCard: { flex: 1, backgroundColor: '#0d1117', borderRadius: 11, paddingVertical: 9, alignItems: 'center' },
  metricValue: { color: '#f0f6fc', fontSize: 11, fontWeight: '900' },
  metricLabel: { color: '#6e7681', fontSize: 7, marginTop: 3, textAlign: 'center' },
  warningCard: { backgroundColor: '#2d2208', borderWidth: 1, borderColor: '#9e6a03', borderRadius: 13, padding: 11, marginTop: 12 },
  warningTitle: { color: '#f2cc60', fontSize: 10, fontWeight: '900' },
  warningText: { color: '#d2b45c', fontSize: 9, lineHeight: 15, marginTop: 3 },
  errorText: { color: '#ff7b72', fontSize: 10, lineHeight: 16, marginTop: 10 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.985 }] },
});
