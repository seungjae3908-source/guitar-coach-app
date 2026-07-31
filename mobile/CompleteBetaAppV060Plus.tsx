import { useState } from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import CompleteBetaAppV060 from './CompleteBetaAppV060';
import AudioFileAnalysisPanel from './components/AudioFileAnalysisPanel';
import CalibrationHub from './components/CalibrationHub';
import ChordRecognitionController from './components/ChordRecognitionController';
import MasterSongStudioPanel from './components/MasterSongStudioPanel';
import MasteryAcademyPanel from './components/MasteryAcademyPanel';
import MetronomeProgramPanel from './components/MetronomeProgramPanel';
import PracticeRecordingPanel from './components/PracticeRecordingPanel';
import PracticeRecordsPanel from './components/PracticeRecordsPanel';
import PracticeSessionRunnerV2 from './components/PracticeSessionRunnerV2';
import PostureFeedbackController from './components/PostureFeedbackController';
import SongPracticePanel from './components/SongPracticePanel';
import SoundConsistencyController from './components/SoundConsistencyController';
import TechniqueFeedbackController from './components/TechniqueFeedbackController';
import ToneMasterLabPanel from './components/ToneMasterLabPanel';
import TunerPanel from './components/TunerPanel';
import VoiceCoachController from './components/VoiceCoachController';
import { getGuitarModeProfile, type GuitarModeId } from './config/guitar-mode-profiles';
import { getPracticePresetsForMode } from './config/personal-practice-presets';
import { useGuitarModePreference } from './hooks/use-guitar-mode-preference';

type GlobalTool =
  | 'app'
  | 'academy'
  | 'session'
  | 'song'
  | 'sheet'
  | 'tone'
  | 'program'
  | 'recording'
  | 'audio'
  | 'calibration'
  | 'records'
  | 'tuner';

const TOOL_LABELS: Array<{ id: GlobalTool; label: string }> = [
  { id: 'app', label: '홈' },
  { id: 'session', label: '집중교정' },
  { id: 'academy', label: '수제자수업' },
  { id: 'song', label: '곡스튜디오' },
  { id: 'sheet', label: '악보편집' },
  { id: 'calibration', label: '촬영보정' },
  { id: 'audio', label: '음원분석' },
  { id: 'recording', label: '영상' },
  { id: 'records', label: '상세기록' },
  { id: 'tuner', label: '튜너' },
  { id: 'tone', label: '톤연구실' },
  { id: 'program', label: '메트로놈' },
];

function toolTitle(tool: GlobalTool) {
  if (tool === 'academy') return '수준 진단·오늘 수업·맞춤곡·숙제';
  if (tool === 'session') return '실시간 자세·박자·톤 일관성 집중 교정';
  if (tool === 'song') return 'YouTube 재생 동기화·자동 스크롤 정밀 악보';
  if (tool === 'sheet') return '로컬 분석 악보·코드 수정·메트로놈 연습';
  if (tool === 'tone') return 'THR30·GT-1 A/B/C 톤 메이킹 수업';
  if (tool === 'program') return '카운트인·타이머·자동 BPM 프로그램';
  if (tool === 'recording') return '연습 영상 녹화·갤러리 저장·재생';
  if (tool === 'audio') return 'MP3·WAV 로컬 BPM·Key·코드 분석';
  if (tool === 'calibration') return '오른손 줄·피크 / 왼손 코드·지판 촬영 보정';
  if (tool === 'records') return '세션별 점수·박자·반복 문제 비교';
  if (tool === 'tuner') return '실시간 기타 튜너';
  return '통기타 · 일렉기타 AI 코치';
}

function DashboardCard({
  title,
  detail,
  badge,
  onPress,
}: {
  title: string;
  detail: string;
  badge: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.dashboardCard, pressed && styles.pressed]}
    >
      <View style={styles.dashboardCardText}>
        <Text style={styles.dashboardCardTitle}>{title}</Text>
        <Text style={styles.dashboardCardDetail}>{detail}</Text>
      </View>
      <Text style={styles.dashboardBadge}>{badge}</Text>
    </Pressable>
  );
}

function ProductHome({
  mode,
  onOpen,
  onChangeMode,
}: {
  mode: GuitarModeId;
  onOpen: (tool: GlobalTool) => void;
  onChangeMode: () => void;
}) {
  const profile = getGuitarModeProfile(mode);
  const presets = getPracticePresetsForMode(mode);
  const priority = presets[0];

  return (
    <ScrollView
      style={styles.homeScroll}
      contentContainerStyle={styles.homeContent}
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.homeHero, mode === 'acoustic' ? styles.homeHeroAcoustic : styles.homeHeroElectric]}>
        <Text style={styles.homeEyebrow}>GUITAR COACH AI 0.6.0</Text>
        <Text style={styles.homeTitle}>{profile.title}</Text>
        <Text style={styles.homeSubtitle}>{profile.subtitle}</Text>
        <View style={styles.homeActionRow}>
          <Pressable onPress={() => onOpen('session')} style={styles.homePrimaryButton}>
            <Text style={styles.homePrimaryText}>집중 연습 시작</Text>
          </Pressable>
          <Pressable onPress={onChangeMode} style={styles.homeSecondaryButton}>
            <Text style={styles.homeSecondaryText}>기타 변경</Text>
          </Pressable>
        </View>
      </View>

      {priority ? (
        <View style={styles.priorityCard}>
          <Text style={styles.priorityLabel}>오늘의 우선 연습</Text>
          <Text style={styles.priorityTitle}>{priority.title}</Text>
          <Text style={styles.priorityDetail}>{priority.goal}</Text>
          <Text style={styles.priorityMeta}>{priority.startBpm}→{priority.targetBpm} BPM · {Math.round(priority.durationSeconds / 60)}분</Text>
          <Pressable onPress={() => onOpen('session')} style={styles.priorityButton}>
            <Text style={styles.priorityButtonText}>이 루틴으로 실제 집중교정 열기</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.dashboardHeading}>실제 기능 바로가기</Text>
      <DashboardCard
        title="AI 집중교정"
        detail="카메라·마이크·메트로놈을 연결해 오른손, 왼손, 박자와 소리를 실시간으로 분석합니다."
        badge="연습"
        onPress={() => onOpen('session')}
      />
      <DashboardCard
        title="촬영 보정"
        detail="오른손 줄 기준과 왼손 지판·프렛 좌표를 저장해 판정 근거를 먼저 맞춥니다."
        badge="필수"
        onPress={() => onOpen('calibration')}
      />
      <DashboardCard
        title="수제자 수업"
        detail="신뢰 가능한 세션만 사용해 현재 수준, 오늘 수업과 다음 과제를 구성합니다."
        badge="수업"
        onPress={() => onOpen('academy')}
      />
      <DashboardCard
        title="곡 스튜디오"
        detail="YouTube 재생 위치와 구간 연습 악보를 동기화하고 A-B 반복과 음성 코칭을 사용합니다."
        badge="곡"
        onPress={() => onOpen('song')}
      />
      <DashboardCard
        title="악보 편집·곡 연습"
        detail="로컬 음원 분석 결과의 코드, 리듬, TAB 초안을 수정하고 연습용 악보로 사용합니다."
        badge="악보"
        onPress={() => onOpen('sheet')}
      />
      <DashboardCard
        title="튜너"
        detail="마이크 신뢰도와 클리핑을 확인하며 기타 줄 음정을 실시간으로 맞춥니다."
        badge="튜닝"
        onPress={() => onOpen('tuner')}
      />
      <DashboardCard
        title="상세 기록"
        detail="점수를 꾸며내지 않고 신뢰 표본, 반복 문제, BPM과 다음 과제를 비교합니다."
        badge="기록"
        onPress={() => onOpen('records')}
      />
      <DashboardCard
        title="메트로놈 프로그램"
        detail="카운트인, 연습 시간, 자동 BPM 증가와 음성 카운트를 설정합니다."
        badge="박자"
        onPress={() => onOpen('program')}
      />
    </ScrollView>
  );
}

export default function CompleteBetaAppV060Plus() {
  const [tool, setTool] = useState<GlobalTool>('app');
  const [voiceCoachEnabled, setVoiceCoachEnabled] = useState(true);
  const { mode, loading, clearMode } = useGuitarModePreference();

  const needsMode = tool === 'academy'
    || tool === 'session'
    || tool === 'song'
    || tool === 'sheet'
    || tool === 'tone'
    || tool === 'audio'
    || tool === 'calibration';

  const changeMode = async () => {
    await clearMode();
    setTool('app');
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#161b22" translucent={false} />
      <VoiceCoachController enabled={voiceCoachEnabled} />
      <TechniqueFeedbackController />
      <PostureFeedbackController />
      <ChordRecognitionController />
      <SoundConsistencyController enabled={voiceCoachEnabled} />

      <View style={styles.toolBar}>
        <View style={styles.toolTextWrap}>
          <Text style={styles.toolEyebrow}>0.6.0 PRODUCT QUALITY BUILD · {mode === 'acoustic' ? '통기타' : mode === 'electric' ? '일렉기타' : '모드 미선택'}</Text>
          <Text style={styles.toolTitle} numberOfLines={2}>{toolTitle(tool)}</Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: voiceCoachEnabled }}
          onPress={() => setVoiceCoachEnabled((value) => !value)}
          style={[styles.voiceButton, voiceCoachEnabled && styles.voiceButtonActive]}
        >
          <Text style={[styles.voiceButtonText, voiceCoachEnabled && styles.voiceButtonTextActive]}>
            음성 {voiceCoachEnabled ? '켜짐' : '꺼짐'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        style={styles.toolScroll}
        contentContainerStyle={styles.toolRow}
        showsHorizontalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
        {TOOL_LABELS.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => setTool(item.id)}
            style={({ pressed }) => [
              styles.toolButton,
              tool === item.id && styles.toolButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.toolButtonText, tool === item.id && styles.toolButtonTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.body}>
        {loading ? (
          <View style={styles.center}>
            <Text style={styles.infoText}>기타 모드를 불러오는 중입니다.</Text>
          </View>
        ) : needsMode && !mode ? (
          <View style={styles.center}>
            <Text style={styles.infoTitle}>먼저 통기타 또는 일렉기타를 선택하세요</Text>
            <Text style={styles.infoText}>홈 화면에서 모드를 선택하면 수준 진단·집중 교정·맞춤곡·톤 수업이 해당 기타 기준으로 실행됩니다.</Text>
            <Pressable onPress={() => setTool('app')} style={styles.modeButton}>
              <Text style={styles.modeButtonText}>홈에서 기타 선택</Text>
            </Pressable>
          </View>
        ) : tool === 'academy' && mode ? (
          <MasteryAcademyPanel
            mode={mode}
            onOpenSession={() => setTool('session')}
            onOpenSong={() => setTool('song')}
            onOpenTone={() => setTool('tone')}
          />
        ) : tool === 'program' ? (
          <MetronomeProgramPanel />
        ) : tool === 'recording' ? (
          <PracticeRecordingPanel mode={mode} />
        ) : tool === 'tuner' ? (
          <ScrollView
            style={styles.tunerScroll}
            contentContainerStyle={styles.tunerContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            <TunerPanel />
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>튜너 사용 순서</Text>
              <Text style={styles.infoText}>1. 시작을 누르고 마이크 권한을 허용합니다.</Text>
              <Text style={styles.infoText}>2. 원하는 튜닝과 A4 기준 주파수를 선택합니다.</Text>
              <Text style={styles.infoText}>3. 다른 줄을 뮤트하고 한 줄만 길게 튕깁니다.</Text>
              <Text style={styles.infoText}>4. 신뢰도가 낮거나 클리핑되면 음정 대신 개선 안내가 표시됩니다.</Text>
            </View>
          </ScrollView>
        ) : tool === 'session' && mode ? (
          <PracticeSessionRunnerV2
            mode={mode}
            voiceCoachEnabled={voiceCoachEnabled}
            onClose={() => setTool('records')}
          />
        ) : tool === 'audio' && mode ? (
          <AudioFileAnalysisPanel mode={mode} />
        ) : tool === 'song' && mode ? (
          <MasterSongStudioPanel mode={mode} voiceEnabled={voiceCoachEnabled} />
        ) : tool === 'sheet' && mode ? (
          <SongPracticePanel mode={mode} />
        ) : tool === 'tone' && mode ? (
          <ToneMasterLabPanel mode={mode} />
        ) : tool === 'calibration' && mode ? (
          <CalibrationHub
            mode={mode}
            onSaved={() => setTool('session')}
            onClose={() => setTool('app')}
          />
        ) : tool === 'records' ? (
          <PracticeRecordsPanel initialMode={mode} />
        ) : mode ? (
          <ProductHome mode={mode} onOpen={setTool} onChangeMode={() => void changeMode()} />
        ) : (
          <CompleteBetaAppV060 />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0d1117',
    paddingTop: Platform.OS === 'android' ? Math.max(0, StatusBar.currentHeight ?? 0) : 0,
  },
  toolBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: '#161b22',
    borderBottomWidth: 1,
    borderBottomColor: '#30363d',
  },
  toolTextWrap: { flex: 1, paddingRight: 7 },
  toolEyebrow: { color: '#7ee787', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  toolTitle: { color: '#f0f6fc', fontSize: 13, lineHeight: 17, fontWeight: '900', marginTop: 3 },
  voiceButton: {
    minWidth: 72,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#21262d',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  voiceButtonActive: { backgroundColor: '#1f6feb', borderColor: '#58a6ff' },
  voiceButtonText: { color: '#8b949e', fontSize: 8, fontWeight: '900' },
  voiceButtonTextActive: { color: '#ffffff' },
  toolScroll: { maxHeight: 56, backgroundColor: '#0d1117', borderBottomWidth: 1, borderBottomColor: '#30363d' },
  toolRow: { paddingHorizontal: 9, paddingVertical: 7, gap: 6, paddingRight: 28 },
  toolButton: {
    minWidth: 76,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#21262d',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  toolButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  toolButtonText: { color: '#b1bac4', fontSize: 9, fontWeight: '900' },
  toolButtonTextActive: { color: '#ffffff' },
  body: { flex: 1, minHeight: 0, backgroundColor: '#0d1117', paddingBottom: Platform.OS === 'android' ? 18 : 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  tunerScroll: { flex: 1, backgroundColor: '#0d1117' },
  tunerContent: { padding: 14, paddingBottom: 110 },
  infoCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 16, padding: 14, marginTop: 12 },
  infoTitle: { color: '#79c0ff', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  infoText: { color: '#b6d8ff', fontSize: 10, lineHeight: 17, marginTop: 5, textAlign: 'center' },
  modeButton: { minHeight: 43, borderRadius: 12, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 16 },
  modeButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  homeScroll: { flex: 1, backgroundColor: '#0d1117' },
  homeContent: { padding: 13, paddingBottom: 120 },
  homeHero: { borderRadius: 22, padding: 18, borderWidth: 1 },
  homeHeroAcoustic: { backgroundColor: '#182118', borderColor: '#2ea043' },
  homeHeroElectric: { backgroundColor: '#111d2f', borderColor: '#1f6feb' },
  homeEyebrow: { color: '#7ee787', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  homeTitle: { color: '#ffffff', fontSize: 25, fontWeight: '900', marginTop: 5 },
  homeSubtitle: { color: '#b1bac4', fontSize: 10, lineHeight: 17, marginTop: 7 },
  homeActionRow: { flexDirection: 'row', gap: 8, marginTop: 15 },
  homePrimaryButton: { flex: 1, minHeight: 46, borderRadius: 13, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  homePrimaryText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  homeSecondaryButton: { minWidth: 92, minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  homeSecondaryText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  priorityCard: { borderRadius: 18, borderWidth: 1, borderColor: '#9e6a03', backgroundColor: '#251f08', padding: 14, marginTop: 12 },
  priorityLabel: { color: '#f2cc60', fontSize: 8, fontWeight: '900' },
  priorityTitle: { color: '#ffffff', fontSize: 17, fontWeight: '900', marginTop: 4 },
  priorityDetail: { color: '#fff3bf', fontSize: 9, lineHeight: 15, marginTop: 5 },
  priorityMeta: { color: '#f2cc60', fontSize: 8, fontWeight: '800', marginTop: 7 },
  priorityButton: { minHeight: 42, borderRadius: 11, backgroundColor: '#9e6a03', alignItems: 'center', justifyContent: 'center', marginTop: 11 },
  priorityButtonText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  dashboardHeading: { color: '#f0f6fc', fontSize: 15, fontWeight: '900', marginTop: 18, marginBottom: 8 },
  dashboardCard: { flexDirection: 'row', alignItems: 'center', minHeight: 82, borderRadius: 16, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 13, marginBottom: 8 },
  dashboardCardText: { flex: 1, paddingRight: 10 },
  dashboardCardTitle: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  dashboardCardDetail: { color: '#8b949e', fontSize: 9, lineHeight: 14, marginTop: 4 },
  dashboardBadge: { minWidth: 44, textAlign: 'center', color: '#7ee787', backgroundColor: '#14251a', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 6, fontSize: 7, fontWeight: '900' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.985 }] },
});
