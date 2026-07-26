import { useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type TabKey =
  | 'home'
  | 'camera'
  | 'sheet'
  | 'focus'
  | 'tone'
  | 'study'
  | 'records'
  | 'videos'
  | 'web'
  | 'settings';

type TabItem = {
  key: TabKey;
  label: string;
  icon: string;
};

const TABS: TabItem[] = [
  { key: 'home', label: '홈', icon: '⌂' },
  { key: 'camera', label: '카메라 연습', icon: '◉' },
  { key: 'sheet', label: '악보', icon: '♬' },
  { key: 'focus', label: '집중 연습', icon: '◎' },
  { key: 'tone', label: '톤메이킹', icon: '≋' },
  { key: 'study', label: '공부하기', icon: '▤' },
  { key: 'records', label: '연습 기록', icon: '▥' },
  { key: 'videos', label: '촬영 영상', icon: '▶' },
  { key: 'web', label: '웹 연결', icon: '⌁' },
  { key: 'settings', label: '설정', icon: '⚙' },
];

const FOCUS_MODES = ['코드', '핑거링', '아르페지오', '스트럼', '피킹'];

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

function HomeScreen({ onMove }: { onMove: (tab: TabKey) => void }) {
  return (
    <View>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>오늘의 코칭</Text>
        <Text style={styles.heroTitle}>검지 복귀 속도를 먼저 잡아볼까요?</Text>
        <Text style={styles.heroDescription}>
          아르페지오 P-I-P 구간에서 검지가 앞으로 많이 나가는 습관을 5분만 집중합니다.
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => onMove('focus')}>
          <Text style={styles.primaryButtonText}>5분 집중 연습 시작</Text>
        </Pressable>
      </View>

      <SectionTitle title="바로 연습" />
      <View style={styles.quickGrid}>
        <Pressable style={styles.quickCard} onPress={() => onMove('camera')}>
          <Text style={styles.quickIcon}>◉</Text>
          <Text style={styles.quickTitle}>카메라 코칭</Text>
          <Text style={styles.quickText}>화면·음성 피드백</Text>
        </Pressable>
        <Pressable style={styles.quickCard} onPress={() => onMove('sheet')}>
          <Text style={styles.quickIcon}>♬</Text>
          <Text style={styles.quickTitle}>악보 연습</Text>
          <Text style={styles.quickText}>현재 마디 강조</Text>
        </Pressable>
      </View>

      <SectionTitle title="최근 연습 요약" action="기록 보기" />
      <View style={styles.summaryCard}>
        <View style={styles.scoreRing}>
          <Text style={styles.scoreNumber}>74</Text>
          <Text style={styles.scoreUnit}>점</Text>
        </View>
        <View style={styles.summaryBody}>
          <Text style={styles.summaryTitle}>아르페지오 · 12분</Text>
          <Text style={styles.summaryLine}>좋아진 점  엄지 음량이 일정해졌어요.</Text>
          <Text style={styles.warningLine}>교정  검지 복귀가 평균 0.18초 늦어요.</Text>
        </View>
      </View>

      <SectionTitle title="이번 주 목표" />
      <View style={styles.goalCard}>
        <View style={styles.goalRow}>
          <Text style={styles.goalTitle}>4박 75 BPM 안정화</Text>
          <Text style={styles.goalPercent}>68%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>
        <Text style={styles.goalCaption}>이번 주 3회 중 2회 완료</Text>
      </View>
    </View>
  );
}

function CameraScreen() {
  return (
    <View>
      <View style={styles.cameraFrame}>
        <View style={styles.cameraTopRow}>
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>UI 초안 · 카메라 미연결</Text>
          </View>
          <Text style={styles.timerText}>00:00</Text>
        </View>
        <View style={styles.handGuide}>
          <Text style={styles.handGuideText}>손이 이 영역에 들어오도록 맞춰주세요</Text>
        </View>
        <View style={styles.feedbackOverlay}>
          <Text style={styles.feedbackLabel}>가장 중요한 교정</Text>
          <Text style={styles.feedbackTitle}>피크가 줄 안쪽으로 너무 깊게 들어가요</Text>
          <Text style={styles.feedbackHint}>다음 한 마디가 끝나면 다시 확인합니다.</Text>
        </View>
      </View>

      <View style={styles.cameraStats}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>--</Text>
          <Text style={styles.statLabel}>실시간 점수</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statValue}>0</Text>
          <Text style={styles.statLabel}>교정 횟수</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statValue}>대기</Text>
          <Text style={styles.statLabel}>마이크 분석</Text>
        </View>
      </View>

      <Pressable style={styles.recordButton}>
        <View style={styles.recordDot} />
        <Text style={styles.recordButtonText}>연습 시작</Text>
      </Pressable>
      <Text style={styles.notReadyText}>
        현재 버튼은 화면 확인용입니다. 카메라·마이크·저장 기능은 아직 연결하지 않았습니다.
      </Text>
    </View>
  );
}

function ChordBox({ name, frets }: { name: string; frets: string }) {
  return (
    <View style={styles.chordBox}>
      <Text style={styles.chordName}>{name}</Text>
      <Text style={styles.chordDiagram}>{frets}</Text>
    </View>
  );
}

function SheetScreen() {
  return (
    <View>
      <View style={styles.searchBox}>
        <Text style={styles.searchPlaceholder}>곡 제목 또는 가수 검색</Text>
        <Text style={styles.searchIcon}>⌕</Text>
      </View>
      <View style={styles.paper}>
        <View style={styles.paperHeader}>
          <View>
            <Text style={styles.songTitle}>Photograph</Text>
            <Text style={styles.songMeta}>Ed Sheeran · 기타 연습용 AI 초안</Text>
          </View>
          <View style={styles.draftBadge}>
            <Text style={styles.draftBadgeText}>검증 중</Text>
          </View>
        </View>
        <View style={styles.chordRow}>
          <ChordBox name="G" frets="● ○ ○ ● ● ●" />
          <ChordBox name="Em" frets="○ ● ● ○ ○ ○" />
          <ChordBox name="C" frets="○ ● ○ ● ● ○" />
          <ChordBox name="D" frets="× × ○ ● ● ●" />
        </View>
        <View style={styles.measureActive}>
          <Text style={styles.measureNumber}>01</Text>
          <Text style={styles.measureChord}>G                 Em</Text>
          <Text style={styles.rhythmLine}>↓  ↓↑  ↑↓↑    ↓  ↓↑  ↑↓↑</Text>
          <Text style={styles.lyricLine}>Loving can hurt, loving can hurt sometimes</Text>
          <Text style={styles.tabLine}>e|---3-----3-----0-----0---|</Text>
          <Text style={styles.tabLine}>B|-----3-----3-----0-----0-|</Text>
        </View>
        <View style={styles.measureNormal}>
          <Text style={styles.measureNumber}>02</Text>
          <Text style={styles.measureChord}>C                  D</Text>
          <Text style={styles.rhythmLine}>↓  ↓↑  ↑↓↑    ↓  ↓↑  ↑↓↑</Text>
          <Text style={styles.lyricLine}>But it's the only thing that I know</Text>
        </View>
      </View>
      <Text style={styles.notReadyText}>
        음원 재생, 현재 마디 동기화, 자동 스크롤은 아직 연결하지 않았습니다.
      </Text>
    </View>
  );
}

function FocusScreen() {
  const [mode, setMode] = useState('아르페지오');
  return (
    <View>
      <Text style={styles.screenLead}>오늘 가장 필요한 동작만 짧게 반복합니다.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modeScroller}>
        {FOCUS_MODES.map((item) => (
          <Pressable
            key={item}
            onPress={() => setMode(item)}
            style={[styles.modeChip, mode === item && styles.modeChipActive]}
          >
            <Text style={[styles.modeChipText, mode === item && styles.modeChipTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.drillCard}>
        <Text style={styles.eyebrow}>{mode} 모드</Text>
        <Text style={styles.drillTitle}>P-I-P에서 검지 복귀 훈련</Text>
        <Text style={styles.drillPattern}>P  ·  I  ·  P  ·  M</Text>
        <View style={styles.drillInfoRow}>
          <View style={styles.drillInfoBox}>
            <Text style={styles.drillInfoValue}>60</Text>
            <Text style={styles.drillInfoLabel}>시작 BPM</Text>
          </View>
          <View style={styles.drillInfoBox}>
            <Text style={styles.drillInfoValue}>5분</Text>
            <Text style={styles.drillInfoLabel}>목표 시간</Text>
          </View>
          <View style={styles.drillInfoBox}>
            <Text style={styles.drillInfoValue}>3회</Text>
            <Text style={styles.drillInfoLabel}>반복 세트</Text>
          </View>
        </View>
        <Pressable style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>카운트 후 시작</Text>
        </Pressable>
      </View>
      <View style={styles.issueCard}>
        <Text style={styles.issueTitle}>저장된 틀린 구간</Text>
        <Text style={styles.issueMain}>Photograph · 00:42 · 2마디</Text>
        <Text style={styles.issueDetail}>원인: 업스트로크 피크 걸림 · 이전 점수 61점</Text>
      </View>
      <Text style={styles.notReadyText}>메트로놈, 녹음, 점수 비교 기능은 아직 연결하지 않았습니다.</Text>
    </View>
  );
}

const GENERIC_CONTENT: Record<Exclude<TabKey, 'home' | 'camera' | 'sheet' | 'focus'>, {
  title: string;
  description: string;
  cards: string[];
}> = {
  tone: {
    title: '톤메이킹',
    description: '원곡 톤과 현재 장비에서 가능한 설정을 구분해서 안내합니다.',
    cards: ['Yamaha THR30', 'BOSS GT-1', '일반 앰프·사용자 장비'],
  },
  study: {
    title: '공부하기',
    description: '연습 중 발견된 문제와 필요한 이론을 바로 연결합니다.',
    cards: ['리듬·타브 읽기', '아르페지오·피킹', '스케일·톤메이킹'],
  },
  records: {
    title: '연습 기록',
    description: '시간, 점수, 문제 원인과 이전 기록 비교가 표시될 영역입니다.',
    cards: ['이번 주 2회', '총 연습 24분', '주요 문제: 검지 복귀'],
  },
  videos: {
    title: '촬영 영상',
    description: '원본은 휴대폰 내부에 유지하고 서버에는 기본 업로드하지 않습니다.',
    cards: ['전체 연주 영상', '1분 자동 분할', '틀린 구간 자동 클립'],
  },
  web: {
    title: '웹 연결',
    description: 'QR 연결 후 점수·악보·교정 데이터만 컴퓨터로 전송할 예정입니다.',
    cards: ['연결 상태: 미연결', '영상 스트리밍: 사용 안 함', '피드백 출력: 휴대폰'],
  },
  settings: {
    title: '설정',
    description: '개인용 앱에 필요한 최소 설정만 제공합니다.',
    cards: ['음성 피드백', '장비 등록', '로컬 저장 공간'],
  },
};

function GenericScreen({ tab }: { tab: keyof typeof GENERIC_CONTENT }) {
  const content = GENERIC_CONTENT[tab];
  return (
    <View>
      <View style={styles.genericHero}>
        <Text style={styles.genericTitle}>{content.title}</Text>
        <Text style={styles.genericDescription}>{content.description}</Text>
      </View>
      {content.cards.map((card, index) => (
        <View style={styles.listCard} key={card}>
          <View style={styles.listNumber}>
            <Text style={styles.listNumberText}>{String(index + 1).padStart(2, '0')}</Text>
          </View>
          <Text style={styles.listCardText}>{card}</Text>
          <Text style={styles.listArrow}>›</Text>
        </View>
      ))}
      <Text style={styles.notReadyText}>현재 화면은 UI 초안이며 실제 기능은 아직 연결하지 않았습니다.</Text>
    </View>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const active = useMemo(() => TABS.find((tab) => tab.key === activeTab) ?? TABS[0], [activeTab]);

  const screen = (() => {
    if (activeTab === 'home') return <HomeScreen onMove={setActiveTab} />;
    if (activeTab === 'camera') return <CameraScreen />;
    if (activeTab === 'sheet') return <SheetScreen />;
    if (activeTab === 'focus') return <FocusScreen />;
    return <GenericScreen tab={activeTab} />;
  })();

  const bottomTabs = TABS.filter((tab) => ['home', 'camera', 'sheet', 'focus', 'settings'].includes(tab.key));

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.brand}>GUITAR COACH AI</Text>
          <Text style={styles.pageTitle}>{active.label}</Text>
        </View>
        <View style={styles.prototypeBadge}>
          <Text style={styles.prototypeBadgeText}>PROTOTYPE</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroller} contentContainerStyle={styles.tabScrollerContent}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={[styles.topTab, activeTab === tab.key && styles.topTabActive]}
          >
            <Text style={[styles.topTabText, activeTab === tab.key && styles.topTabTextActive]}>
              {tab.icon} {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        {screen}
      </ScrollView>

      <View style={styles.bottomNav}>
        {bottomTabs.map((tab) => (
          <Pressable key={tab.key} style={styles.bottomNavItem} onPress={() => setActiveTab(tab.key)}>
            <Text style={[styles.bottomIcon, activeTab === tab.key && styles.bottomIconActive]}>{tab.icon}</Text>
            <Text style={[styles.bottomLabel, activeTab === tab.key && styles.bottomLabelActive]}>{tab.label.replace(' 연습', '')}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0d1117' },
  appHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { color: '#7ee787', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  pageTitle: { color: '#f0f6fc', fontSize: 25, fontWeight: '800', marginTop: 4 },
  prototypeBadge: { backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  prototypeBadgeText: { color: '#8b949e', fontSize: 10, fontWeight: '800' },
  tabScroller: { maxHeight: 48 },
  tabScrollerContent: { paddingHorizontal: 16, paddingBottom: 8 },
  topTab: { paddingHorizontal: 13, paddingVertical: 8, marginRight: 8, borderRadius: 18, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d' },
  topTabActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  topTabText: { color: '#8b949e', fontSize: 12, fontWeight: '700' },
  topTabTextActive: { color: '#ffffff' },
  content: { flex: 1, backgroundColor: '#0d1117' },
  contentContainer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 108 },
  heroCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 22, padding: 20 },
  eyebrow: { color: '#7ee787', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginBottom: 8 },
  heroTitle: { color: '#f0f6fc', fontSize: 22, fontWeight: '800', lineHeight: 30 },
  heroDescription: { color: '#8b949e', fontSize: 14, lineHeight: 21, marginTop: 10 },
  primaryButton: { backgroundColor: '#2ea043', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  sectionHeader: { marginTop: 24, marginBottom: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: '#f0f6fc', fontSize: 17, fontWeight: '800' },
  sectionAction: { color: '#58a6ff', fontSize: 12, fontWeight: '700' },
  quickGrid: { flexDirection: 'row' },
  quickCard: { flex: 1, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, padding: 16, marginRight: 8 },
  quickIcon: { color: '#7ee787', fontSize: 24, fontWeight: '800' },
  quickTitle: { color: '#f0f6fc', fontSize: 15, fontWeight: '800', marginTop: 12 },
  quickText: { color: '#8b949e', fontSize: 12, marginTop: 4 },
  summaryCard: { backgroundColor: '#161b22', borderRadius: 18, borderWidth: 1, borderColor: '#30363d', padding: 16, flexDirection: 'row', alignItems: 'center' },
  scoreRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 7, borderColor: '#2ea043', justifyContent: 'center', alignItems: 'center' },
  scoreNumber: { color: '#f0f6fc', fontSize: 23, fontWeight: '900' },
  scoreUnit: { color: '#8b949e', fontSize: 10 },
  summaryBody: { flex: 1, marginLeft: 15 },
  summaryTitle: { color: '#f0f6fc', fontSize: 15, fontWeight: '800', marginBottom: 8 },
  summaryLine: { color: '#b1bac4', fontSize: 12, lineHeight: 18 },
  warningLine: { color: '#f2cc60', fontSize: 12, lineHeight: 18 },
  goalCard: { backgroundColor: '#161b22', borderRadius: 18, borderWidth: 1, borderColor: '#30363d', padding: 16 },
  goalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  goalTitle: { color: '#f0f6fc', fontSize: 14, fontWeight: '800' },
  goalPercent: { color: '#7ee787', fontSize: 14, fontWeight: '900' },
  progressTrack: { height: 8, backgroundColor: '#30363d', borderRadius: 5, marginTop: 13, overflow: 'hidden' },
  progressFill: { width: '68%', height: '100%', backgroundColor: '#2ea043', borderRadius: 5 },
  goalCaption: { color: '#8b949e', fontSize: 11, marginTop: 8 },
  cameraFrame: { height: 455, backgroundColor: '#030608', borderRadius: 24, borderWidth: 1, borderColor: '#30363d', padding: 16, justifyContent: 'space-between', overflow: 'hidden' },
  cameraTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liveBadge: { backgroundColor: '#3d1f24', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6 },
  liveBadgeText: { color: '#ff7b72', fontSize: 10, fontWeight: '800' },
  timerText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  handGuide: { alignSelf: 'center', width: '78%', height: 210, borderWidth: 2, borderColor: '#2ea043', borderStyle: 'dashed', borderRadius: 100, alignItems: 'center', justifyContent: 'center' },
  handGuideText: { color: '#7ee787', fontSize: 12, fontWeight: '700', textAlign: 'center', paddingHorizontal: 30 },
  feedbackOverlay: { backgroundColor: 'rgba(22,27,34,0.94)', borderRadius: 16, padding: 15, borderLeftWidth: 4, borderLeftColor: '#f2cc60' },
  feedbackLabel: { color: '#f2cc60', fontSize: 11, fontWeight: '800' },
  feedbackTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '800', marginTop: 5, lineHeight: 22 },
  feedbackHint: { color: '#8b949e', fontSize: 11, marginTop: 6 },
  cameraStats: { backgroundColor: '#161b22', borderRadius: 18, borderWidth: 1, borderColor: '#30363d', marginTop: 12, paddingVertical: 15, flexDirection: 'row', alignItems: 'center' },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { color: '#f0f6fc', fontSize: 17, fontWeight: '900' },
  statLabel: { color: '#8b949e', fontSize: 10, marginTop: 4 },
  statDivider: { height: 28, width: 1, backgroundColor: '#30363d' },
  recordButton: { backgroundColor: '#f85149', borderRadius: 16, paddingVertical: 15, marginTop: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  recordDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#ffffff', marginRight: 9 },
  recordButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  notReadyText: { color: '#6e7681', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 12, paddingHorizontal: 10 },
  searchBox: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 14, paddingHorizontal: 15, paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between' },
  searchPlaceholder: { color: '#8b949e', fontSize: 13 },
  searchIcon: { color: '#58a6ff', fontSize: 18 },
  paper: { backgroundColor: '#fffdf7', borderRadius: 4, padding: 18, marginTop: 14 },
  paperHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  songTitle: { color: '#181818', fontSize: 25, fontWeight: '900' },
  songMeta: { color: '#66625c', fontSize: 10, marginTop: 4 },
  draftBadge: { backgroundColor: '#fff1c2', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 },
  draftBadgeText: { color: '#765900', fontSize: 9, fontWeight: '900' },
  chordRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, marginBottom: 18 },
  chordBox: { width: '23%', alignItems: 'center' },
  chordName: { color: '#151515', fontSize: 15, fontWeight: '900' },
  chordDiagram: { color: '#48433d', fontSize: 7, textAlign: 'center', lineHeight: 11, marginTop: 5 },
  measureActive: { backgroundColor: '#e8f5e9', borderLeftWidth: 4, borderLeftColor: '#2ea043', padding: 12, marginHorizontal: -4 },
  measureNormal: { padding: 12, marginTop: 4 },
  measureNumber: { color: '#8b8177', fontSize: 9, fontWeight: '800' },
  measureChord: { color: '#b23b2a', fontSize: 13, fontWeight: '900', marginTop: 4 },
  rhythmLine: { color: '#1d1d1d', fontSize: 12, letterSpacing: 1, marginTop: 5 },
  lyricLine: { color: '#27231f', fontSize: 12, lineHeight: 19, marginTop: 6 },
  tabLine: { color: '#37322e', fontSize: 10, fontFamily: 'monospace', marginTop: 4 },
  screenLead: { color: '#8b949e', fontSize: 13, lineHeight: 20, marginBottom: 12 },
  modeScroller: { maxHeight: 44 },
  modeChip: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, paddingHorizontal: 15, paddingVertical: 9, marginRight: 8 },
  modeChipActive: { backgroundColor: '#1f6feb', borderColor: '#58a6ff' },
  modeChipText: { color: '#8b949e', fontSize: 12, fontWeight: '800' },
  modeChipTextActive: { color: '#ffffff' },
  drillCard: { backgroundColor: '#161b22', borderRadius: 22, borderWidth: 1, borderColor: '#30363d', padding: 20, marginTop: 16 },
  drillTitle: { color: '#f0f6fc', fontSize: 20, fontWeight: '900' },
  drillPattern: { color: '#58a6ff', fontSize: 25, fontWeight: '900', letterSpacing: 6, textAlign: 'center', marginVertical: 22 },
  drillInfoRow: { flexDirection: 'row' },
  drillInfoBox: { flex: 1, backgroundColor: '#0d1117', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginRight: 6 },
  drillInfoValue: { color: '#f0f6fc', fontSize: 16, fontWeight: '900' },
  drillInfoLabel: { color: '#8b949e', fontSize: 9, marginTop: 4 },
  issueCard: { backgroundColor: '#241f16', borderWidth: 1, borderColor: '#6e5b22', borderRadius: 16, padding: 15, marginTop: 14 },
  issueTitle: { color: '#f2cc60', fontSize: 11, fontWeight: '900' },
  issueMain: { color: '#f0f6fc', fontSize: 14, fontWeight: '800', marginTop: 7 },
  issueDetail: { color: '#b1a77c', fontSize: 11, marginTop: 5 },
  genericHero: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 22, padding: 20, marginBottom: 13 },
  genericTitle: { color: '#f0f6fc', fontSize: 25, fontWeight: '900' },
  genericDescription: { color: '#8b949e', fontSize: 13, lineHeight: 20, marginTop: 8 },
  listCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 15, padding: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center' },
  listNumber: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#21262d', justifyContent: 'center', alignItems: 'center' },
  listNumberText: { color: '#7ee787', fontSize: 11, fontWeight: '900' },
  listCardText: { color: '#f0f6fc', fontSize: 14, fontWeight: '700', marginLeft: 12, flex: 1 },
  listArrow: { color: '#6e7681', fontSize: 24 },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 78, backgroundColor: '#161b22', borderTopWidth: 1, borderTopColor: '#30363d', flexDirection: 'row', paddingBottom: 8 },
  bottomNavItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottomIcon: { color: '#6e7681', fontSize: 20, fontWeight: '900' },
  bottomIconActive: { color: '#7ee787' },
  bottomLabel: { color: '#6e7681', fontSize: 9, fontWeight: '700', marginTop: 4 },
  bottomLabelActive: { color: '#f0f6fc' },
});
