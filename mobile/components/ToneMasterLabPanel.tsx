import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { GuitarModeId, ToneDeviceId } from '../config/guitar-mode-profiles';
import { getToneDeviceProfile } from '../config/tone-device-profiles';
import {
  applyToneProblemCorrection,
  buildToneLesson,
  generateToneVariations,
  type ToneCharacter,
  type ToneProblem,
  type ToneVariation,
} from '../services/tone-master-engine';
import {
  type GuitarPickup,
  type ToneGenre,
  type TonePresetDraft,
  type ToneRole,
} from '../services/tone-preset-engine';

const STORAGE_KEY = 'guitar-coach:tone-master-presets:v1';

const DEVICES: Array<{ id: ToneDeviceId; label: string }> = [
  { id: 'yamaha-thr30', label: 'Yamaha THR30' },
  { id: 'boss-gt1', label: 'BOSS GT-1' },
  { id: 'generic-amp', label: '일반 앰프' },
  { id: 'generic-multifx', label: '일반 멀티이펙터' },
];
const ROLES: Array<{ id: ToneRole; label: string }> = [
  { id: 'clean', label: '클린' },
  { id: 'rhythm', label: '리듬' },
  { id: 'lead', label: '리드' },
];
const GENRES: Array<{ id: ToneGenre; label: string }> = [
  { id: 'acoustic', label: '통기타' },
  { id: 'pop', label: '팝' },
  { id: 'rock', label: '록' },
  { id: 'blues', label: '블루스' },
  { id: 'ballad', label: '발라드' },
  { id: 'metal', label: '메탈' },
  { id: 'ambient', label: '앰비언트' },
  { id: 'indie', label: '인디' },
];
const PICKUPS: Array<{ id: GuitarPickup; label: string }> = [
  { id: 'acoustic-piezo', label: '통기타 피에조' },
  { id: 'single-coil', label: '싱글코일' },
  { id: 'humbucker', label: '험버커' },
  { id: 'p90', label: 'P90' },
  { id: 'unknown', label: '모름' },
];
const CHARACTERS: Array<{ id: ToneCharacter; label: string; detail: string }> = [
  { id: 'balanced', label: '균형', detail: '먼저 맞출 기준 톤' },
  { id: 'warm', label: '따뜻함', detail: '피크 거친 소리와 얇은 고역 완화' },
  { id: 'cut', label: '선명함', detail: '합주에서 기타 윤곽 강조' },
  { id: 'tight', label: '타이트', detail: '빠른 피킹·팜뮤트 분리' },
  { id: 'ambient', label: '공간감', detail: '발라드·클린 리드' },
];
const PROBLEMS: Array<{ id: ToneProblem; label: string }> = [
  { id: 'muddy', label: '먹먹·뭉침' },
  { id: 'harsh', label: '날카로움' },
  { id: 'thin', label: '얇은 소리' },
  { id: 'noisy', label: '노이즈' },
  { id: 'buried', label: '합주에서 묻힘' },
  { id: 'attack-blur', label: '어택 흐림' },
];

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PresetParameters({ preset }: { preset: TonePresetDraft }) {
  return (
    <View style={styles.parameterList}>
      {preset.parameters.map((parameter) => (
        <View key={parameter.id} style={styles.parameterRow}>
          <View style={styles.parameterTextWrap}>
            <Text style={styles.parameterLabel}>{parameter.label}</Text>
            <Text style={styles.parameterExplain}>{parameter.explanation}</Text>
          </View>
          <Text style={styles.parameterValue}>{parameter.value}{parameter.unit ?? ''}</Text>
        </View>
      ))}
    </View>
  );
}

export default function ToneMasterLabPanel({ mode }: { mode: GuitarModeId }) {
  const [deviceId, setDeviceId] = useState<ToneDeviceId>('yamaha-thr30');
  const [role, setRole] = useState<ToneRole>(mode === 'acoustic' ? 'clean' : 'rhythm');
  const [genre, setGenre] = useState<ToneGenre>(mode === 'acoustic' ? 'acoustic' : 'rock');
  const [pickup, setPickup] = useState<GuitarPickup>(mode === 'acoustic' ? 'acoustic-piezo' : 'humbucker');
  const [character, setCharacter] = useState<ToneCharacter>('balanced');
  const [brightness, setBrightness] = useState(mode === 'acoustic' ? 35 : 48);
  const [gainAmount, setGainAmount] = useState(mode === 'acoustic' ? 12 : 55);
  const [ambience, setAmbience] = useState(mode === 'acoustic' ? 20 : 24);
  const [variations, setVariations] = useState<ToneVariation[]>([]);
  const [selectedId, setSelectedId] = useState<'A' | 'B' | 'C'>('B');
  const [corrected, setCorrected] = useState<TonePresetDraft | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [listeningCheck, setListeningCheck] = useState('');
  const [status, setStatus] = useState('기타·장비·곡 역할을 고른 뒤 A/B/C 톤을 만드세요.');
  const [error, setError] = useState('');

  const selectedVariation = variations.find((item) => item.id === selectedId) ?? variations[1] ?? variations[0] ?? null;
  const visiblePreset = corrected ?? selectedVariation?.preset ?? null;
  const device = getToneDeviceProfile(deviceId);
  const lesson = useMemo(() => visiblePreset ? buildToneLesson(visiblePreset) : [], [visiblePreset]);

  const generate = () => {
    const next = generateToneVariations({
      deviceId,
      role,
      genre,
      pickup,
      brightness,
      gainAmount,
      ambience,
      notes: `${mode === 'acoustic' ? '통기타' : '일렉기타'} 수제자 톤 수업`,
    }, character);
    setVariations(next);
    setSelectedId('B');
    setCorrected(null);
    setCorrectionText('');
    setListeningCheck('');
    setStatus('A/B/C 세 가지 시작 톤을 만들었습니다. 같은 리프를 연주하며 차이를 비교하세요.');
    setError('');
  };

  const chooseVariation = (id: 'A' | 'B' | 'C') => {
    setSelectedId(id);
    setCorrected(null);
    setCorrectionText('');
    setListeningCheck('');
  };

  const correctProblem = (problem: ToneProblem) => {
    if (!visiblePreset) {
      setError('먼저 A/B/C 톤을 만드세요.');
      return;
    }
    const result = applyToneProblemCorrection(visiblePreset, problem);
    setCorrected(result.preset);
    setCorrectionText(result.explanation);
    setListeningCheck(result.listeningCheck);
    setStatus('선택한 소리 문제에 맞춰 값을 수정했습니다. 설명대로 같은 리프를 A/B 비교하세요.');
    setError('');
  };

  const savePreset = async () => {
    if (!visiblePreset) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const current = Array.isArray(parsed) ? parsed as TonePresetDraft[] : [];
      const next = [visiblePreset, ...current.filter((item) => item.id !== visiblePreset.id)].slice(0, 50);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStatus(`${visiblePreset.title}을 휴대폰에 저장했습니다.`);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '톤을 저장하지 못했습니다.');
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>EXPLAINABLE TONE MASTER LAB</Text>
      <Text style={styles.title}>{mode === 'acoustic' ? '통기타' : '일렉기타'} 톤 메이킹 개인 수업</Text>
      <Text style={styles.subtitle}>앱이 앰프를 직접 조작하거나 실제 소리를 들었다고 가장하지 않습니다. 장비·픽업·곡 역할에 맞는 시작값을 세 가지로 만들고, 직접 들은 증상에 따라 수정값·이유·청음 기준을 제공합니다.</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. 사용하는 장비</Text>
        <View style={styles.wrap}>{DEVICES.map((item) => <Choice key={item.id} label={item.label} active={deviceId === item.id} onPress={() => setDeviceId(item.id)} />)}</View>
        <Text style={styles.helper}>{device.brand} {device.model} · {device.description}</Text>
        <Text style={styles.chain}>지원 체인 · {device.effectBlocks.join(' → ')}</Text>

        <Text style={styles.sectionTitle}>2. 픽업</Text>
        <View style={styles.wrap}>{PICKUPS.filter((item) => mode === 'acoustic' ? item.id === 'acoustic-piezo' || item.id === 'unknown' : item.id !== 'acoustic-piezo').map((item) => <Choice key={item.id} label={item.label} active={pickup === item.id} onPress={() => setPickup(item.id)} />)}</View>

        <Text style={styles.sectionTitle}>3. 곡에서 맡는 역할</Text>
        <View style={styles.wrap}>{ROLES.map((item) => <Choice key={item.id} label={item.label} active={role === item.id} onPress={() => setRole(item.id)} />)}</View>

        <Text style={styles.sectionTitle}>4. 장르</Text>
        <View style={styles.wrap}>{GENRES.filter((item) => mode === 'acoustic' ? ['acoustic', 'pop', 'ballad', 'ambient', 'indie'].includes(item.id) : item.id !== 'acoustic').map((item) => <Choice key={item.id} label={item.label} active={genre === item.id} onPress={() => setGenre(item.id)} />)}</View>

        <Text style={styles.sectionTitle}>5. 원하는 성격</Text>
        {CHARACTERS.map((item) => (
          <Pressable key={item.id} onPress={() => setCharacter(item.id)} style={[styles.characterRow, character === item.id && styles.characterRowActive]}>
            <Text style={[styles.characterTitle, character === item.id && styles.characterTitleActive]}>{item.label}</Text>
            <Text style={styles.characterDetail}>{item.detail}</Text>
          </Pressable>
        ))}

        <Text style={styles.sectionTitle}>6. 기본 양 조절</Text>
        <View style={styles.adjustGrid}>
          <Adjust label="밝기" value={brightness} onMinus={() => setBrightness((value) => Math.max(0, value - 5))} onPlus={() => setBrightness((value) => Math.min(100, value + 5))} />
          <Adjust label="게인" value={gainAmount} onMinus={() => setGainAmount((value) => Math.max(0, value - 5))} onPlus={() => setGainAmount((value) => Math.min(100, value + 5))} />
          <Adjust label="공간감" value={ambience} onMinus={() => setAmbience((value) => Math.max(0, value - 5))} onPlus={() => setAmbience((value) => Math.min(100, value + 5))} />
        </View>

        <Pressable onPress={generate} style={styles.generateButton}><Text style={styles.generateText}>A/B/C 톤 조합 만들기</Text></Pressable>
      </View>

      {variations.length ? (
        <>
          <Text style={styles.sectionHeading}>A/B/C 비교</Text>
          {variations.map((variation) => (
            <Pressable key={variation.id} onPress={() => chooseVariation(variation.id)} style={[styles.variationCard, selectedId === variation.id && !corrected && styles.variationCardActive]}>
              <View style={styles.variationId}><Text style={styles.variationIdText}>{variation.id}</Text></View>
              <View style={styles.variationTextWrap}>
                <Text style={styles.variationTitle}>{variation.preset.title}</Text>
                <Text style={styles.variationPurpose}>{variation.purpose}</Text>
              </View>
            </Pressable>
          ))}
        </>
      ) : null}

      {visiblePreset ? (
        <View style={styles.resultCard}>
          <View style={styles.resultTopRow}>
            <View style={styles.resultTextWrap}>
              <Text style={styles.resultEyebrow}>{visiblePreset.deviceId}</Text>
              <Text style={styles.resultTitle}>{visiblePreset.title}</Text>
              <Text style={styles.resultChain}>{visiblePreset.chain.join(' → ')}</Text>
            </View>
            <Pressable onPress={() => void savePreset()} style={styles.saveButton}><Text style={styles.saveText}>저장</Text></Pressable>
          </View>
          <PresetParameters preset={visiblePreset} />

          <Text style={styles.sectionTitle}>소리를 직접 듣고 가장 가까운 문제 선택</Text>
          <View style={styles.wrap}>{PROBLEMS.map((item) => <Choice key={item.id} label={item.label} active={false} onPress={() => correctProblem(item.id)} />)}</View>

          {correctionText ? (
            <View style={styles.correctionCard}>
              <Text style={styles.correctionTitle}>왜 이렇게 바꿨나</Text>
              <Text style={styles.correctionText}>{correctionText}</Text>
              <Text style={styles.listeningTitle}>귀로 확인할 것</Text>
              <Text style={styles.listeningText}>{listeningCheck}</Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>선생님과 맞추는 순서</Text>
          {lesson.map((item) => <Text key={item} style={styles.lessonText}>{item}</Text>)}

          <View style={styles.truthCard}>
            <Text style={styles.truthTitle}>현재 자동 판정 범위</Text>
            <Text style={styles.truthText}>카메라·마이크만으로 앰프의 주파수 응답, 스피커 질감, 실제 EQ를 정밀 청음했다고 표시하지 않습니다. 현재는 장비 설정 추천과 사용자가 들은 증상 기반 교정까지 실제 연결되어 있습니다.</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.statusCard}><Text style={styles.statusText}>{status}</Text></View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

function Adjust({ label, value, onMinus, onPlus }: { label: string; value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={styles.adjustCard}>
      <Text style={styles.adjustLabel}>{label}</Text>
      <View style={styles.adjustRow}>
        <Pressable onPress={onMinus} style={styles.adjustButton}><Text style={styles.adjustButtonText}>-5</Text></Pressable>
        <Text style={styles.adjustValue}>{value}</Text>
        <Pressable onPress={onPlus} style={styles.adjustButton}><Text style={styles.adjustButtonText}>+5</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 12, paddingBottom: 100 },
  eyebrow: { color: '#a371f7', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '900', marginTop: 4 },
  subtitle: { color: '#8b949e', fontSize: 9, lineHeight: 15, marginTop: 5 },
  card: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, padding: 12, marginTop: 12 },
  sectionTitle: { color: '#f0f6fc', fontSize: 10, fontWeight: '900', marginTop: 12, marginBottom: 7 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  choice: { minHeight: 35, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  choiceActive: { backgroundColor: '#6e40c9', borderColor: '#a371f7' },
  choiceText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  choiceTextActive: { color: '#ffffff' },
  helper: { color: '#8b949e', fontSize: 8, lineHeight: 13, marginTop: 7 },
  chain: { color: '#79c0ff', fontSize: 7, lineHeight: 12, marginTop: 4 },
  characterRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', padding: 9, marginBottom: 5 },
  characterRowActive: { borderColor: '#a371f7', backgroundColor: '#21153d' },
  characterTitle: { width: 62, color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  characterTitleActive: { color: '#d2a8ff' },
  characterDetail: { flex: 1, color: '#8b949e', fontSize: 7, lineHeight: 11 },
  adjustGrid: { flexDirection: 'row', gap: 6 },
  adjustCard: { flex: 1, backgroundColor: '#0d1117', borderRadius: 11, padding: 8, alignItems: 'center' },
  adjustLabel: { color: '#8b949e', fontSize: 7, fontWeight: '900' },
  adjustRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  adjustButton: { width: 30, height: 28, borderRadius: 8, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  adjustButtonText: { color: '#f0f6fc', fontSize: 7, fontWeight: '900' },
  adjustValue: { color: '#d2a8ff', fontSize: 15, fontWeight: '900', minWidth: 30, textAlign: 'center' },
  generateButton: { minHeight: 46, borderRadius: 13, backgroundColor: '#6e40c9', alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  generateText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  sectionHeading: { color: '#f0f6fc', fontSize: 14, fontWeight: '900', marginTop: 17, marginBottom: 8 },
  variationCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 10, marginBottom: 6 },
  variationCardActive: { borderColor: '#a371f7', backgroundColor: '#21153d' },
  variationId: { width: 35, height: 35, borderRadius: 18, backgroundColor: '#6e40c9', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  variationIdText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  variationTextWrap: { flex: 1 },
  variationTitle: { color: '#f0f6fc', fontSize: 10, fontWeight: '900' },
  variationPurpose: { color: '#8b949e', fontSize: 7, lineHeight: 11, marginTop: 3 },
  resultCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 18, padding: 12, marginTop: 11 },
  resultTopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  resultTextWrap: { flex: 1, paddingRight: 8 },
  resultEyebrow: { color: '#79c0ff', fontSize: 7, fontWeight: '900' },
  resultTitle: { color: '#ffffff', fontSize: 16, fontWeight: '900', marginTop: 3 },
  resultChain: { color: '#b6d8ff', fontSize: 7, lineHeight: 12, marginTop: 4 },
  saveButton: { minWidth: 47, height: 35, borderRadius: 10, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#ffffff', fontSize: 8, fontWeight: '900' },
  parameterList: { marginTop: 10 },
  parameterRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#30363d', paddingVertical: 9 },
  parameterTextWrap: { flex: 1, paddingRight: 8 },
  parameterLabel: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  parameterExplain: { color: '#8b949e', fontSize: 7, lineHeight: 11, marginTop: 2 },
  parameterValue: { color: '#7ee787', fontSize: 13, fontWeight: '900' },
  correctionCard: { borderRadius: 13, backgroundColor: '#251f08', borderWidth: 1, borderColor: '#9e6a03', padding: 11, marginTop: 10 },
  correctionTitle: { color: '#f2cc60', fontSize: 9, fontWeight: '900' },
  correctionText: { color: '#fff3bf', fontSize: 8, lineHeight: 13, marginTop: 4 },
  listeningTitle: { color: '#79c0ff', fontSize: 8, fontWeight: '900', marginTop: 9 },
  listeningText: { color: '#b6d8ff', fontSize: 8, lineHeight: 13, marginTop: 3 },
  lessonText: { color: '#b1bac4', fontSize: 8, lineHeight: 14, marginTop: 5 },
  truthCard: { borderRadius: 12, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', padding: 10, marginTop: 12 },
  truthTitle: { color: '#8b949e', fontSize: 8, fontWeight: '900' },
  truthText: { color: '#6e7681', fontSize: 7, lineHeight: 12, marginTop: 4 },
  statusCard: { backgroundColor: '#102418', borderWidth: 1, borderColor: '#2ea043', borderRadius: 12, padding: 9, marginTop: 10 },
  statusText: { color: '#b9e6c5', fontSize: 8, lineHeight: 13 },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 13, marginTop: 7 },
});
