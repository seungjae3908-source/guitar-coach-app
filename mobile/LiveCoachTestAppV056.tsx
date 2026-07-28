import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import LiveCoachTestApp from './LiveCoachTestApp';
import {
  isAdvancedMetronomeAvailable,
  previewVoiceCountAsync,
  startAdvancedMetronomeAsync,
  stopAdvancedMetronomeAsync,
} from './modules/guitar-coach-metronome';

type MeterOption = {
  label: string;
  beats: number;
};

type SubdivisionOption = {
  value: 1 | 2 | 3 | 4;
  label: string;
  countExample: string;
};

const METER_OPTIONS: MeterOption[] = [
  { label: '2/4', beats: 2 },
  { label: '3/4', beats: 3 },
  { label: '4/4', beats: 4 },
  { label: '5/4', beats: 5 },
  { label: '6/8', beats: 6 },
  { label: '7/8', beats: 7 },
  { label: '9/8', beats: 9 },
  { label: '12/8', beats: 12 },
];

const SUBDIVISION_OPTIONS: SubdivisionOption[] = [
  { value: 1, label: '4분', countExample: '원 · 투 · 쓰리 · 포' },
  { value: 2, label: '8분', countExample: '원 앤 투 앤' },
  { value: 3, label: '셋잇단', countExample: '원 트립 렛' },
  { value: 4, label: '16분', countExample: '원 이 앤 어' },
];

const NUMBER_LABELS = ['원', '투', '쓰리', '포', '파이브', '식스', '세븐', '에잇', '나인', '텐', '일레븐', '트웰브'];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function countToken(pulseIndex: number, beats: number, subdivision: number) {
  const safeSubdivision = clamp(Math.round(subdivision), 1, 4);
  const beatIndex = Math.floor(pulseIndex / safeSubdivision) % Math.max(1, beats);
  const subIndex = pulseIndex % safeSubdivision;
  const number = NUMBER_LABELS[beatIndex] ?? String(beatIndex + 1);

  if (safeSubdivision === 1) return number;
  if (safeSubdivision === 2) return subIndex === 0 ? number : '앤';
  if (safeSubdivision === 3) return subIndex === 0 ? number : subIndex === 1 ? '트립' : '렛';
  return subIndex === 0 ? number : subIndex === 1 ? '이' : subIndex === 2 ? '앤' : '어';
}

function OptionButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionButton,
        active && styles.optionButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.optionButtonText, active && styles.optionButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function LiveCoachTestAppV056() {
  const [expanded, setExpanded] = useState(true);
  const [bpm, setBpm] = useState(70);
  const [bpmInput, setBpmInput] = useState('70');
  const [meterLabel, setMeterLabel] = useState('4/4');
  const [subdivision, setSubdivision] = useState<1 | 2 | 3 | 4>(1);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [pulseIndex, setPulseIndex] = useState(0);
  const [error, setError] = useState('');
  const visualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const meter = useMemo(
    () => METER_OPTIONS.find((option) => option.label === meterLabel) ?? METER_OPTIONS[2],
    [meterLabel],
  );

  const subdivisionOption = useMemo(
    () => SUBDIVISION_OPTIONS.find((option) => option.value === subdivision) ?? SUBDIVISION_OPTIONS[0],
    [subdivision],
  );

  useEffect(() => {
    if (!running) {
      setPulseIndex(0);
      void stopAdvancedMetronomeAsync();
      return;
    }

    setError('');
    void startAdvancedMetronomeAsync(
      bpm,
      meter.beats,
      subdivision,
      soundEnabled,
      voiceEnabled,
    ).catch((caught) => {
      setError(caught instanceof Error ? caught.message : '메트로놈을 시작하지 못했습니다.');
      setRunning(false);
    });

    return () => {
      void stopAdvancedMetronomeAsync();
    };
  }, [bpm, meter.beats, running, soundEnabled, subdivision, voiceEnabled]);

  useEffect(() => {
    if (visualTimerRef.current) {
      clearTimeout(visualTimerRef.current);
      visualTimerRef.current = null;
    }

    if (!running) return;

    let cancelled = false;
    let nextAt = Date.now() + 80;
    let nextPulse = 0;
    const intervalMs = 60000 / bpm / subdivision;
    const totalPulses = Math.max(1, meter.beats * subdivision);

    const tick = () => {
      if (cancelled) return;
      setPulseIndex(nextPulse);
      nextPulse = (nextPulse + 1) % totalPulses;
      nextAt += intervalMs;
      visualTimerRef.current = setTimeout(tick, Math.max(0, nextAt - Date.now()));
    };

    visualTimerRef.current = setTimeout(tick, 80);

    return () => {
      cancelled = true;
      if (visualTimerRef.current) {
        clearTimeout(visualTimerRef.current);
        visualTimerRef.current = null;
      }
    };
  }, [bpm, meter.beats, running, subdivision]);

  const setSafeBpm = (next: number) => {
    const safe = clamp(Math.round(next), 35, 220);
    setBpm(safe);
    setBpmInput(String(safe));
  };

  const commitBpm = () => {
    const parsed = Number(bpmInput);
    if (!Number.isFinite(parsed)) {
      setBpmInput(String(bpm));
      return;
    }
    setSafeBpm(parsed);
  };

  const toggleRunning = () => {
    if (!isAdvancedMetronomeAvailable) {
      setError('이 설치본에는 고급 메트로놈 모듈이 없습니다.');
      return;
    }
    if (!soundEnabled && !voiceEnabled) {
      setError('클릭음 또는 음성 카운트 중 하나를 켜 주세요.');
      return;
    }
    setRunning((current) => !current);
  };

  const previewVoice = () => {
    setError('');
    void previewVoiceCountAsync(subdivision).catch((caught) => {
      setError(caught instanceof Error ? caught.message : '음성 카운트를 재생하지 못했습니다.');
    });
  };

  const beatNumber = Math.floor(pulseIndex / subdivision) + 1;
  const currentToken = countToken(pulseIndex, meter.beats, subdivision);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>고급 메트로놈 0.5.6</Text>
          <Text style={styles.headerStatus}>
            {running ? `${meter.label} · ${bpm} BPM · ${currentToken}` : '연속 클릭·음성 카운트'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded((current) => !current)}
          style={({ pressed }) => [styles.expandButton, pressed && styles.pressed]}
        >
          <Text style={styles.expandButtonText}>{expanded ? '접기' : '열기'}</Text>
        </Pressable>
      </View>

      {expanded ? (
        <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panel} nestedScrollEnabled>
          <View style={styles.liveRow}>
            <View>
              <Text style={styles.liveLabel}>현재 카운트</Text>
              <Text style={styles.liveCount}>{running ? currentToken : '대기'}</Text>
            </View>
            <View style={styles.liveMetaWrap}>
              <Text style={styles.liveMeta}>{meter.label}</Text>
              <Text style={styles.liveMeta}>{running ? `${beatNumber}박` : `${meter.beats}박 구성`}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>BPM</Text>
          <View style={styles.bpmRow}>
            <OptionButton label="-5" active={false} onPress={() => setSafeBpm(bpm - 5)} />
            <OptionButton label="-1" active={false} onPress={() => setSafeBpm(bpm - 1)} />
            <TextInput
              accessibilityLabel="메트로놈 BPM"
              keyboardType="number-pad"
              onBlur={commitBpm}
              onChangeText={setBpmInput}
              onSubmitEditing={commitBpm}
              selectTextOnFocus
              style={styles.bpmInput}
              value={bpmInput}
            />
            <OptionButton label="+1" active={false} onPress={() => setSafeBpm(bpm + 1)} />
            <OptionButton label="+5" active={false} onPress={() => setSafeBpm(bpm + 5)} />
          </View>

          <Text style={styles.sectionTitle}>박자</Text>
          <View style={styles.optionWrap}>
            {METER_OPTIONS.map((option) => (
              <OptionButton
                key={option.label}
                label={option.label}
                active={meter.label === option.label}
                onPress={() => setMeterLabel(option.label)}
              />
            ))}
          </View>

          <Text style={styles.sectionTitle}>음표 분할</Text>
          <View style={styles.optionWrap}>
            {SUBDIVISION_OPTIONS.map((option) => (
              <OptionButton
                key={option.value}
                label={option.label}
                active={subdivision === option.value}
                onPress={() => setSubdivision(option.value)}
              />
            ))}
          </View>
          <Text style={styles.exampleText}>{subdivisionOption.countExample}</Text>

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>클릭음</Text>
              <Text style={styles.switchDetail}>첫 박은 높은 소리로 강조합니다.</Text>
            </View>
            <Switch value={soundEnabled} onValueChange={setSoundEnabled} />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>음성 카운트</Text>
              <Text style={styles.switchDetail}>Android 기본 음성으로 원·앤·트립렛·이앤어를 읽습니다.</Text>
            </View>
            <Switch value={voiceEnabled} onValueChange={setVoiceEnabled} />
          </View>

          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              onPress={toggleRunning}
              style={({ pressed }) => [
                styles.primaryButton,
                running && styles.stopButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>{running ? '메트로놈 정지' : '메트로놈 시작'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={previewVoice}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonText}>음성 미리듣기</Text>
            </Pressable>
          </View>

          {voiceEnabled && subdivision >= 3 ? (
            <Text style={styles.noticeText}>빠른 셋잇단·16분 음성은 35~80 BPM에서 가장 또렷합니다.</Text>
          ) : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Text style={styles.compatText}>아래 카메라 자세 분석과 동시에 계속 작동합니다.</Text>
        </ScrollView>
      ) : null}

      <View style={styles.appWrap}>
        <LiveCoachTestApp />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#07111f',
  },
  header: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#23354d',
    backgroundColor: '#0b1728',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  headerTitle: {
    color: '#f7fbff',
    fontSize: 17,
    fontWeight: '800',
  },
  headerStatus: {
    color: '#87a7cc',
    fontSize: 12,
    marginTop: 3,
  },
  expandButton: {
    minWidth: 58,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#18304e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandButtonText: {
    color: '#dcecff',
    fontWeight: '800',
  },
  panelScroll: {
    maxHeight: 385,
    borderBottomWidth: 1,
    borderBottomColor: '#23354d',
    backgroundColor: '#0c192a',
  },
  panel: {
    padding: 14,
    gap: 9,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#10243b',
  },
  liveLabel: {
    color: '#89a7c8',
    fontSize: 12,
  },
  liveCount: {
    color: '#75f0b8',
    fontSize: 26,
    fontWeight: '900',
    marginTop: 2,
  },
  liveMetaWrap: {
    alignItems: 'flex-end',
    gap: 3,
  },
  liveMeta: {
    color: '#dcecff',
    fontSize: 13,
    fontWeight: '700',
  },
  sectionTitle: {
    color: '#c9ddf5',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  bpmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bpmInput: {
    width: 72,
    height: 40,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#3d5f86',
    backgroundColor: '#07111f',
    color: '#ffffff',
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  optionButton: {
    minHeight: 38,
    minWidth: 54,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#345170',
    backgroundColor: '#112238',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionButtonActive: {
    borderColor: '#5ce4a8',
    backgroundColor: '#173d35',
  },
  optionButtonText: {
    color: '#c5d8ee',
    fontSize: 13,
    fontWeight: '700',
  },
  optionButtonTextActive: {
    color: '#7bf0ba',
  },
  exampleText: {
    color: '#8cb0d3',
    fontSize: 12,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#102238',
  },
  switchTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  switchTitle: {
    color: '#e8f3ff',
    fontSize: 14,
    fontWeight: '800',
  },
  switchDetail: {
    color: '#7f9dbf',
    fontSize: 11,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 13,
    backgroundColor: '#24b97d',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  stopButton: {
    backgroundColor: '#d45261',
  },
  primaryButtonText: {
    color: '#04130d',
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#45698f',
    backgroundColor: '#14283f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: '#d6e9ff',
    fontWeight: '800',
  },
  noticeText: {
    color: '#f1c46d',
    fontSize: 11,
    lineHeight: 16,
  },
  errorText: {
    color: '#ff8f9b',
    fontSize: 12,
    lineHeight: 17,
  },
  compatText: {
    color: '#77b79c',
    fontSize: 11,
    lineHeight: 16,
  },
  appWrap: {
    flex: 1,
    minHeight: 0,
  },
  pressed: {
    opacity: 0.72,
  },
});
