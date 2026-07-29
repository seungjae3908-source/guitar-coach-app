import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import LiveCoachTestAppV058 from './LiveCoachTestAppV058';
import GuitarModeSelectScreen from './components/GuitarModeSelectScreen';
import {
  getGuitarModeProfile,
  GuitarModeId,
  PracticeCategoryId,
} from './config/guitar-mode-profiles';
import {
  getPracticePresetsForMode,
  PERSONAL_PRACTICE_PRESETS,
  PracticePreset,
} from './config/personal-practice-presets';
import { getToneDeviceProfile } from './config/tone-device-profiles';
import { visibleFeaturesForMode } from './config/complete-feature-registry';
import { useGuitarModePreference } from './hooks/use-guitar-mode-preference';
import {
  loadPracticeSessions,
  PracticeSessionRecord,
  summarizePracticeSessions,
} from './services/practice-session-store';
import {
  generateTonePresetDraft,
  GuitarPickup,
  ToneGenre,
  TonePresetDraft,
  ToneRole,
} from './services/tone-preset-engine';

export type CompleteBetaTab = 'home' | 'practice' | 'coach' | 'tone' | 'records';

const TAB_LABELS: Record<CompleteBetaTab, string> = {
  home: '홈',
  practice: '연습',
  coach: 'AI 코치',
  tone: '장비·톤',
  records: '기록',
};

function SectionCard({
  title,
  detail,
  onPress,
  badge,
}: {
  title: string;
  detail: string;
  onPress?: () => void;
  badge?: string;
}) {
  const content = (
    <View style={styles.sectionCard}>
      <View style={styles.sectionTextWrap}>
        <Text style={styles.sectionCardTitle}>{title}</Text>
        <Text style={styles.sectionCardDetail}>{detail}</Text>
      </View>
      {badge ? <Text style={styles.sectionBadge}>{badge}</Text> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {content}
    </Pressable>
  );
}

function HomeScreen({
  mode,
  onOpenTab,
  onChangeMode,
}: {
  mode: GuitarModeId;
  onOpenTab: (tab: CompleteBetaTab) => void;
  onChangeMode: () => void;
}) {
  const profile = getGuitarModeProfile(mode);
  const presets = getPracticePresetsForMode(mode);
  const features = visibleFeaturesForMode(mode);
  const primaryPreset = presets[0];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.hero, mode === 'acoustic' ? styles.heroAcoustic : styles.heroElectric]}>
        <Text style={styles.heroEyebrow}>GUITAR COACH AI 0.6.0</Text>
        <Text style={styles.heroTitle}>{profile.title}</Text>
        <Text style={styles.heroDetail}>{profile.subtitle}</Text>
        <View style={styles.heroActions}>
          <Pressable onPress={() => onOpenTab('coach')} style={({ pressed }) => [styles.heroPrimary, pressed && styles.pressed]}>
            <Text style={styles.heroPrimaryText}>카메라 AI 시작</Text>
          </Pressable>
          <Pressable onPress={onChangeMode} style={({ pressed }) => [styles.heroSecondary, pressed && styles.pressed]}>
            <Text style={styles.heroSecondaryText}>기타 변경</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.heading}>오늘의 우선 연습</Text>
      {primaryPreset ? (
        <SectionCard
          title={primaryPreset.title}
          detail={`${primaryPreset.startBpm}→${primaryPreset.targetBpm} BPM · ${Math.round(primaryPreset.durationSeconds / 60)}분 · ${primaryPreset.goal}`}
          badge="개인 루틴"
          onPress={() => onOpenTab('practice')}
        />
      ) : null}

      <Text style={styles.heading}>빠른 실행</Text>
      <SectionCard
        title="고급 메트로놈 + 상세 AI"
        detail="클릭 음원, 사람 음성, 전신·오른손·왼손 분석을 동시에 사용합니다."
        badge="실행 가능"
        onPress={() => onOpenTab('coach')}
      />
      <SectionCard
        title={mode === 'electric' ? 'THR30·GT-1 톤 연구실' : '통기타 연습 설정'}
        detail={mode === 'electric'
          ? 'Clean·Rhythm·Lead 시작값을 만들고 실제 장비에 맞춰 수정합니다.'
          : '통기타 루틴과 카메라 촬영 기준을 연습별로 확인합니다.'}
        badge={mode === 'electric' ? '톤 생성' : '연습 기준'}
        onPress={() => onOpenTab(mode === 'electric' ? 'tone' : 'practice')}
      />
      <SectionCard
        title="최근 기록과 다음 과제"
        detail="통기타와 일렉기타 기록을 분리하고 반복 문제와 BPM 성장을 확인합니다."
        badge="오프라인 저장"
        onPress={() => onOpenTab('records')}
      />

      <Text style={styles.heading}>현재 연결된 기능</Text>
      <View style={styles.featureWrap}>
        {features.map((feature) => (
          <View key={feature.id} style={styles.featureChip}>
            <Text style={styles.featureChipText}>{feature.title}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function PracticeScreen({
  mode,
  onOpenCoach,
}: {
  mode: GuitarModeId;
  onOpenCoach: () => void;
}) {
  const profile = getGuitarModeProfile(mode);
  const presets = getPracticePresetsForMode(mode);
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? '');
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];

  useEffect(() => {
    setSelectedPresetId(presets[0]?.id ?? '');
  }, [mode]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageTitle}>{profile.title} 개인 연습</Text>
      <Text style={styles.pageSubtitle}>실제 반복 문제와 목표 BPM을 기준으로 만든 루틴입니다.</Text>

      <Text style={styles.heading}>개인 교정 루틴</Text>
      {presets.map((preset) => (
        <Pressable
          key={preset.id}
          onPress={() => setSelectedPresetId(preset.id)}
          style={({ pressed }) => [
            styles.presetCard,
            selectedPreset?.id === preset.id && styles.presetCardActive,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.sectionTextWrap}>
            <Text style={styles.presetTitle}>{preset.title}</Text>
            <Text style={styles.presetDetail}>{preset.pattern ? `${preset.pattern} · ` : ''}{preset.startBpm}→{preset.targetBpm} BPM</Text>
          </View>
          <Text style={styles.presetFocus}>{preset.cameraFocus === 'right-hand' ? '오른손' : preset.cameraFocus === 'left-hand' ? '왼손' : '전신'}</Text>
        </Pressable>
      ))}

      {selectedPreset ? <PracticeDetail preset={selectedPreset} onOpenCoach={onOpenCoach} /> : null}

      <Text style={styles.heading}>전체 연습 종류</Text>
      {profile.practiceDefinitions.map((practice) => (
        <SectionCard
          key={practice.id}
          title={practice.title}
          detail={`${practice.description} · 권장 촬영: ${practice.framing}`}
          badge={`${practice.defaultBpm} BPM`}
        />
      ))}
    </ScrollView>
  );
}

function PracticeDetail({ preset, onOpenCoach }: { preset: PracticePreset; onOpenCoach: () => void }) {
  return (
    <View style={styles.detailCard}>
      <Text style={styles.detailEyebrow}>선택한 루틴</Text>
      <Text style={styles.detailTitle}>{preset.title}</Text>
      <Text style={styles.detailText}>{preset.goal}</Text>
      <Text style={styles.detailSubTitle}>확인 항목</Text>
      {preset.checkpoints.map((checkpoint) => (
        <Text key={checkpoint} style={styles.checkpoint}>• {checkpoint}</Text>
      ))}
      <Text style={styles.detailSubTitle}>자동 피드백 규칙</Text>
      {preset.automaticFeedbackRules.map((rule) => (
        <Text key={rule} style={styles.checkpoint}>• {rule}</Text>
      ))}
      <Pressable onPress={onOpenCoach} style={({ pressed }) => [styles.fullButton, pressed && styles.pressed]}>
        <Text style={styles.fullButtonText}>이 루틴으로 AI 코치 열기</Text>
      </Pressable>
    </View>
  );
}

const TONE_GENRES: ToneGenre[] = ['pop', 'rock', 'blues', 'ballad', 'metal', 'ambient', 'indie'];
const TONE_ROLES: ToneRole[] = ['clean', 'rhythm', 'lead'];
const PICKUPS: GuitarPickup[] = ['single-coil', 'humbucker', 'p90', 'unknown'];

function ToneScreen({ mode }: { mode: GuitarModeId }) {
  const [deviceId, setDeviceId] = useState<'yamaha-thr30' | 'boss-gt1'>('yamaha-thr30');
  const [genre, setGenre] = useState<ToneGenre>('rock');
  const [role, setRole] = useState<ToneRole>('rhythm');
  const [pickup, setPickup] = useState<GuitarPickup>('humbucker');
  const [preset, setPreset] = useState<TonePresetDraft | null>(null);

  if (mode !== 'electric') {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
        <Text style={styles.pageTitle}>통기타 장비 설정</Text>
        <Text style={styles.pageSubtitle}>THR30 Acoustic·Clean 계열과 기본 EQ 메모는 완성형 장비 화면에서 제공합니다.</Text>
        <SectionCard title="Yamaha THR30" detail="Acoustic 또는 Clean, 낮은 Gain, 과하지 않은 Reverb부터 시작합니다." badge="사용자 보유" />
      </ScrollView>
    );
  }

  const device = getToneDeviceProfile(deviceId);
  const generate = () => {
    setPreset(generateTonePresetDraft({
      deviceId,
      genre,
      role,
      pickup,
      brightness: genre === 'metal' ? 55 : 45,
      gainAmount: role === 'clean' ? 20 : role === 'rhythm' ? 55 : 70,
      ambience: genre === 'ambient' ? 80 : role === 'lead' ? 45 : 20,
      notes: '0.6.0 완성형 베타 자동 생성 초안',
    }));
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageTitle}>일렉 장비·톤 연구실</Text>
      <Text style={styles.pageSubtitle}>실제 장비를 직접 제어하지 않고 시작값을 생성·저장·비교하는 구조입니다.</Text>

      <Text style={styles.heading}>장비</Text>
      <View style={styles.choiceRow}>
        {(['yamaha-thr30', 'boss-gt1'] as const).map((id) => (
          <ChoiceButton key={id} label={id === 'yamaha-thr30' ? 'THR30' : 'GT-1'} active={deviceId === id} onPress={() => setDeviceId(id)} />
        ))}
      </View>
      <Text style={styles.helperText}>{device.brand} {device.model} · {device.description}</Text>

      <Text style={styles.heading}>역할</Text>
      <View style={styles.choiceRow}>{TONE_ROLES.map((value) => <ChoiceButton key={value} label={value} active={role === value} onPress={() => setRole(value)} />)}</View>
      <Text style={styles.heading}>장르</Text>
      <View style={styles.choiceRow}>{TONE_GENRES.map((value) => <ChoiceButton key={value} label={value} active={genre === value} onPress={() => setGenre(value)} />)}</View>
      <Text style={styles.heading}>픽업</Text>
      <View style={styles.choiceRow}>{PICKUPS.map((value) => <ChoiceButton key={value} label={value} active={pickup === value} onPress={() => setPickup(value)} />)}</View>

      <Pressable onPress={generate} style={({ pressed }) => [styles.fullButton, pressed && styles.pressed]}>
        <Text style={styles.fullButtonText}>톤 초안 생성</Text>
      </Pressable>

      {preset ? (
        <View style={styles.detailCard}>
          <Text style={styles.detailEyebrow}>{preset.deviceId}</Text>
          <Text style={styles.detailTitle}>{preset.title}</Text>
          <Text style={styles.detailText}>{preset.chain.join(' → ')}</Text>
          {preset.parameters.map((parameter) => (
            <View key={parameter.id} style={styles.parameterRow}>
              <Text style={styles.parameterLabel}>{parameter.label}</Text>
              <Text style={styles.parameterValue}>{parameter.value}</Text>
            </View>
          ))}
          {preset.warnings.map((warning) => <Text key={warning} style={styles.warningText}>주의 · {warning}</Text>)}
        </View>
      ) : null}
    </ScrollView>
  );
}

function ChoiceButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.choiceButton, active && styles.choiceButtonActive, pressed && styles.pressed]}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function RecordsScreen({ mode }: { mode: GuitarModeId }) {
  const [sessions, setSessions] = useState<PracticeSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadPracticeSessions()
      .then((items) => { if (!cancelled) setSessions(items); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : '기록을 불러오지 못했습니다.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const summary = useMemo(() => summarizePracticeSessions(sessions, mode), [mode, sessions]);
  const modeSessions = sessions.filter((session) => session.guitarMode === mode).slice(0, 10);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageTitle}>{mode === 'acoustic' ? '통기타' : '일렉기타'} 연습 기록</Text>
      <Text style={styles.pageSubtitle}>신뢰도가 낮은 분석은 점수에서 제외하고 기록합니다.</Text>
      {loading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.statsRow}>
        <StatCard label="세션" value={`${summary.sessionCount}`} />
        <StatCard label="연습" value={`${summary.totalMinutes}분`} />
        <StatCard label="평균" value={summary.averageScore == null ? '-' : `${summary.averageScore}`} />
        <StatCard label="BPM" value={`${summary.bpmGrowth >= 0 ? '+' : ''}${summary.bpmGrowth}`} />
      </View>

      <SectionCard title="다음 과제" detail={summary.latestAssignment} badge={`${summary.averageConfidencePercent}% 신뢰도`} />
      {summary.topIssues.map((issue) => (
        <SectionCard key={issue.id} title={issue.title} detail={`${issue.count}회 반복 · 신뢰도 ${issue.confidencePercent}%`} badge={issue.severity} />
      ))}

      <Text style={styles.heading}>최근 세션</Text>
      {modeSessions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>저장된 세션이 없습니다.</Text>
          <Text style={styles.emptyText}>0.6.0 세션 연결이 완료되면 연습 결과가 여기에 쌓입니다.</Text>
        </View>
      ) : modeSessions.map((session) => (
        <SectionCard
          key={session.id}
          title={session.title}
          detail={`${Math.round(session.durationSeconds / 60)}분 · ${session.bpmStart}→${session.bpmEnd} BPM · 실수 ${session.manualMistakes + session.aiMistakes}`}
          badge={session.averageScore == null ? '판정 제외' : `${session.averageScore}점`}
        />
      ))}
    </ScrollView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MainNavigation({ mode, onChangeMode }: { mode: GuitarModeId; onChangeMode: () => void }) {
  const [tab, setTab] = useState<CompleteBetaTab>('home');
  const tabs: CompleteBetaTab[] = ['home', 'practice', 'coach', 'tone', 'records'];

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.appBody}>
        {tab === 'home' ? <HomeScreen mode={mode} onOpenTab={setTab} onChangeMode={onChangeMode} /> : null}
        {tab === 'practice' ? <PracticeScreen mode={mode} onOpenCoach={() => setTab('coach')} /> : null}
        {tab === 'coach' ? <LiveCoachTestAppV058 /> : null}
        {tab === 'tone' ? <ToneScreen mode={mode} /> : null}
        {tab === 'records' ? <RecordsScreen mode={mode} /> : null}
      </View>
      <View style={styles.bottomBar}>
        {tabs.map((item) => (
          <Pressable key={item} onPress={() => setTab(item)} style={({ pressed }) => [styles.tabButton, tab === item && styles.tabButtonActive, pressed && styles.pressed]}>
            <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{TAB_LABELS[item]}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function CompleteBetaAppV060() {
  const { mode, loading, error, setMode, clearMode } = useGuitarModePreference();
  const [selectionError, setSelectionError] = useState('');

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingRoot}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>기타 모드와 연습 기록 준비 중</Text>
      </SafeAreaView>
    );
  }

  if (!mode) {
    return (
      <View style={styles.root}>
        <GuitarModeSelectScreen
          onSelect={(next) => {
            setSelectionError('');
            void setMode(next).catch((caught) => setSelectionError(caught instanceof Error ? caught.message : '기타 모드를 저장하지 못했습니다.'));
          }}
        />
        {error || selectionError ? <Text style={styles.floatingError}>{error || selectionError}</Text> : null}
      </View>
    );
  }

  return <MainNavigation mode={mode} onChangeMode={() => { void clearMode(); }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  appBody: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#0d1117' },
  screenContent: { padding: 14, paddingBottom: 40 },
  loadingRoot: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#8b949e', marginTop: 12, fontWeight: '800' },
  hero: { borderRadius: 23, padding: 18, borderWidth: 1 },
  heroAcoustic: { backgroundColor: '#2a210d', borderColor: '#9e6a03' },
  heroElectric: { backgroundColor: '#111d2f', borderColor: '#1f6feb' },
  heroEyebrow: { color: '#7ee787', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  heroTitle: { color: '#ffffff', fontSize: 25, fontWeight: '900', marginTop: 6 },
  heroDetail: { color: '#d0d7de', fontSize: 12, lineHeight: 19, marginTop: 7 },
  heroActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  heroPrimary: { flex: 1, minHeight: 47, borderRadius: 14, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  heroPrimaryText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  heroSecondary: { minWidth: 90, minHeight: 47, borderRadius: 14, borderWidth: 1, borderColor: '#8b949e', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  heroSecondaryText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  heading: { color: '#f0f6fc', fontSize: 15, fontWeight: '900', marginTop: 18, marginBottom: 9 },
  sectionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 14, marginBottom: 8 },
  sectionTextWrap: { flex: 1 },
  sectionCardTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900' },
  sectionCardDetail: { color: '#8b949e', fontSize: 10, lineHeight: 16, marginTop: 4 },
  sectionBadge: { color: '#79c0ff', fontSize: 9, fontWeight: '900', marginLeft: 10, textAlign: 'right' },
  featureWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  featureChip: { backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', borderRadius: 11, paddingHorizontal: 9, paddingVertical: 7 },
  featureChipText: { color: '#b1bac4', fontSize: 9, fontWeight: '800' },
  pageTitle: { color: '#f0f6fc', fontSize: 23, fontWeight: '900' },
  pageSubtitle: { color: '#8b949e', fontSize: 12, lineHeight: 19, marginTop: 6 },
  presetCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 15, padding: 13, marginBottom: 7 },
  presetCardActive: { borderColor: '#2ea043', backgroundColor: '#14251a' },
  presetTitle: { color: '#f0f6fc', fontSize: 12, fontWeight: '900' },
  presetDetail: { color: '#8b949e', fontSize: 10, marginTop: 4 },
  presetFocus: { color: '#7ee787', fontSize: 9, fontWeight: '900', marginLeft: 8 },
  detailCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 18, padding: 15, marginTop: 12 },
  detailEyebrow: { color: '#79c0ff', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  detailTitle: { color: '#ffffff', fontSize: 17, fontWeight: '900', marginTop: 5 },
  detailText: { color: '#b6d8ff', fontSize: 11, lineHeight: 18, marginTop: 7 },
  detailSubTitle: { color: '#f0f6fc', fontSize: 11, fontWeight: '900', marginTop: 13, marginBottom: 4 },
  checkpoint: { color: '#b1bac4', fontSize: 10, lineHeight: 17, marginTop: 2 },
  fullButton: { minHeight: 48, borderRadius: 14, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', marginTop: 15, paddingHorizontal: 12 },
  fullButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choiceButton: { minHeight: 39, borderRadius: 12, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, paddingVertical: 7 },
  choiceButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  choiceText: { color: '#b1bac4', fontSize: 10, fontWeight: '900' },
  choiceTextActive: { color: '#ffffff' },
  helperText: { color: '#8b949e', fontSize: 10, lineHeight: 16, marginTop: 8 },
  parameterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#30363d', paddingVertical: 9, marginTop: 4 },
  parameterLabel: { color: '#b1bac4', fontSize: 11, fontWeight: '800' },
  parameterValue: { color: '#7ee787', fontSize: 12, fontWeight: '900' },
  warningText: { color: '#f2cc60', fontSize: 9, lineHeight: 15, marginTop: 7 },
  statsRow: { flexDirection: 'row', gap: 6, marginTop: 14 },
  statCard: { flex: 1, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  statValue: { color: '#7ee787', fontSize: 17, fontWeight: '900' },
  statLabel: { color: '#8b949e', fontSize: 9, marginTop: 3 },
  emptyCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 16 },
  emptyTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900' },
  emptyText: { color: '#8b949e', fontSize: 10, lineHeight: 16, marginTop: 5 },
  bottomBar: { flexDirection: 'row', backgroundColor: '#161b22', borderTopWidth: 1, borderTopColor: '#30363d', paddingHorizontal: 5, paddingTop: 6, paddingBottom: 7 },
  tabButton: { flex: 1, minHeight: 43, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabButtonActive: { backgroundColor: '#238636' },
  tabText: { color: '#8b949e', fontSize: 10, fontWeight: '900' },
  tabTextActive: { color: '#ffffff' },
  floatingError: { position: 'absolute', left: 14, right: 14, bottom: 18, color: '#ffffff', backgroundColor: '#da3633', borderRadius: 13, padding: 12, textAlign: 'center', fontSize: 11, fontWeight: '800' },
  errorText: { color: '#ff7b72', fontSize: 11, marginTop: 10 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
});

export const COMPLETE_BETA_PERSONAL_PRESET_COUNT = PERSONAL_PRACTICE_PRESETS.length;
export type CompleteBetaPracticeCategory = PracticeCategoryId;
