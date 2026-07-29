import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import {
  getAdvancedMetronomeTimingStateAsync,
  isAdvancedMetronomeAvailable,
  startAdvancedMetronomeAsync,
  stopAdvancedMetronomeAsync,
} from '../modules/guitar-coach-metronome';
import {
  deleteSongProject,
  duplicateSongProject,
  loadSongProjects,
  saveSongProject,
} from '../services/song-project-store';
import {
  generateSongSheetDraft,
  nextChordInPalette,
  replaceSongBarChord,
  SongKey,
  SongPracticeStyle,
  SongSheetDraft,
} from '../services/song-sheet-engine';

const KEYS: SongKey[] = ['C', 'G', 'D', 'A', 'E', 'F', 'Am', 'Em', 'Dm'];
const STYLES: Array<{ id: SongPracticeStyle; label: string }> = [
  { id: 'strum', label: '스트럼' },
  { id: 'arpeggio', label: '아르페지오' },
  { id: 'riff', label: '리프·TAB 초안' },
];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;

function SmallButton({
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
      style={[styles.smallButton, active && styles.smallButtonActive, disabled && styles.disabled]}
    >
      <Text style={[styles.smallButtonText, active && styles.smallButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function SongPracticePanel({ mode }: { mode: GuitarModeId }) {
  const [projects, setProjects] = useState<SongSheetDraft[]>([]);
  const [draft, setDraft] = useState<SongSheetDraft | null>(null);
  const [title, setTitle] = useState('나의 연습곡');
  const [artist, setArtist] = useState('');
  const [keyName, setKeyName] = useState<SongKey>(mode === 'acoustic' ? 'G' : 'E');
  const [style, setStyle] = useState<SongPracticeStyle>(mode === 'acoustic' ? 'strum' : 'riff');
  const [bpm, setBpm] = useState(80);
  const [barCount, setBarCount] = useState(8);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(7);
  const [currentBarIndex, setCurrentBarIndex] = useState(0);
  const [currentBeat, setCurrentBeat] = useState(1);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('곡 정보를 입력하고 악보 초안을 만드세요.');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setProjects(await loadSongProjects());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '저장된 곡을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setKeyName(mode === 'acoustic' ? 'G' : 'E');
    setStyle(mode === 'acoustic' ? 'strum' : 'riff');
    setDraft(null);
    setCurrentBarIndex(0);
    setLoopStart(0);
    setLoopEnd(7);
    void stopAdvancedMetronomeAsync();
    setRunning(false);
  }, [mode]);

  useEffect(() => {
    if (!running || !draft) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const timing = await getAdvancedMetronomeTimingStateAsync();
        if (!cancelled && timing.running && timing.absolutePulseCount > 0) {
          const pulsesPerBar = Math.max(1, draft.beatsPerBar * timing.subdivision);
          const loopLength = Math.max(1, loopEnd - loopStart + 1);
          const completedPulses = Math.max(0, Math.floor(timing.absolutePulseCount - 1));
          const nextBar = loopStart + Math.floor(completedPulses / pulsesPerBar) % loopLength;
          const nextBeat = Math.floor((completedPulses % pulsesPerBar) / timing.subdivision) + 1;
          setCurrentBarIndex(nextBar);
          setCurrentBeat(nextBeat);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '곡 연습 위치를 읽지 못했습니다.');
      } finally {
        if (!cancelled) timer = setTimeout(poll, 80);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [draft, loopEnd, loopStart, running]);

  useEffect(() => () => {
    void stopAdvancedMetronomeAsync();
  }, []);

  const effectiveBpm = Math.max(35, Math.min(220, Math.round((draft?.bpm ?? bpm) * speed)));
  const currentBar = draft?.bars[currentBarIndex] ?? null;
  const nextBar = draft
    ? draft.bars[currentBarIndex >= loopEnd ? loopStart : currentBarIndex + 1]
    : null;

  const generate = () => {
    const next = generateSongSheetDraft({
      guitarMode: mode,
      title,
      artist,
      key: keyName,
      bpm,
      beatsPerBar: 4,
      style,
      barCount,
    });
    setDraft(next);
    setLoopStart(0);
    setLoopEnd(next.bars.length - 1);
    setCurrentBarIndex(0);
    setCurrentBeat(1);
    setStatus('연습용 악보 초안을 만들었습니다. 마디를 누르면 코드를 바꿀 수 있습니다.');
    setError('');
  };

  const save = async () => {
    if (!draft) return;
    const next: SongSheetDraft = {
      ...draft,
      title: title.trim() || draft.title,
      artist: artist.trim(),
      bpm,
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveSongProject(next);
      setDraft(next);
      await reload();
      setStatus('곡과 악보 초안을 휴대폰에 저장했습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '곡을 저장하지 못했습니다.');
    }
  };

  const loadProject = (project: SongSheetDraft) => {
    void stopAdvancedMetronomeAsync();
    setRunning(false);
    setDraft(project);
    setTitle(project.title);
    setArtist(project.artist);
    setKeyName(project.key);
    setStyle(project.style);
    setBpm(project.bpm);
    setBarCount(project.bars.length);
    setLoopStart(0);
    setLoopEnd(project.bars.length - 1);
    setCurrentBarIndex(0);
    setCurrentBeat(1);
    setStatus('저장된 악보를 불러왔습니다.');
  };

  const cycleChord = (barId: string, currentChord: string) => {
    if (!draft || running) return;
    setDraft(replaceSongBarChord(draft, barId, nextChordInPalette(draft, currentChord)));
  };

  const toggleRunning = async () => {
    if (!draft) {
      setError('먼저 악보 초안을 만드세요.');
      return;
    }
    setError('');
    try {
      if (running) {
        await stopAdvancedMetronomeAsync();
        setRunning(false);
        setStatus('곡 연습을 정지했습니다.');
        return;
      }
      if (!isAdvancedMetronomeAvailable) throw new Error('고급 메트로놈 모듈이 APK에 없습니다.');
      setCurrentBarIndex(loopStart);
      setCurrentBeat(1);
      await startAdvancedMetronomeAsync(effectiveBpm, draft.beatsPerBar, 1, true, false, 0);
      setRunning(true);
      setStatus(`${loopStart + 1}~${loopEnd + 1}마디 반복 · ${effectiveBpm} BPM`);
    } catch (caught) {
      setRunning(false);
      setError(caught instanceof Error ? caught.message : '곡 연습을 시작하지 못했습니다.');
    }
  };

  const removeProject = (project: SongSheetDraft) => {
    Alert.alert('곡 삭제', `${project.title}을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          void deleteSongProject(project.id)
            .then(async () => {
              if (draft?.id === project.id) setDraft(null);
              await reload();
            })
            .catch((caught) => setError(caught instanceof Error ? caught.message : '곡을 삭제하지 못했습니다.'));
        },
      },
    ]);
  };

  const duplicate = async () => {
    if (!draft) return;
    try {
      const copy = await duplicateSongProject(draft);
      await reload();
      loadProject(copy);
      setStatus('악보를 복제했습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '악보를 복제하지 못했습니다.');
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>OFFLINE SHEET & SONG PRACTICE</Text>
      <Text style={styles.title}>{mode === 'acoustic' ? '통기타' : '일렉기타'} 악보 초안·곡 연습</Text>
      <Text style={styles.subtitle}>입력한 조건으로 연습용 초안을 만드는 기능입니다. 원곡 음원을 분석한 결과나 원곡과 동일한 TAB이라고 표시하지 않습니다.</Text>

      <View style={styles.formCard}>
        <Text style={styles.label}>곡 제목</Text>
        <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="곡 제목" placeholderTextColor="#6e7681" />
        <Text style={styles.label}>가수·메모</Text>
        <TextInput value={artist} onChangeText={setArtist} style={styles.input} placeholder="가수 또는 연습 메모" placeholderTextColor="#6e7681" />

        <Text style={styles.label}>Key</Text>
        <View style={styles.wrapRow}>
          {KEYS.map((item) => <SmallButton key={item} label={item} active={keyName === item} onPress={() => setKeyName(item)} disabled={running} />)}
        </View>

        <Text style={styles.label}>연주 방식</Text>
        <View style={styles.wrapRow}>
          {STYLES.map((item) => <SmallButton key={item.id} label={item.label} active={style === item.id} onPress={() => setStyle(item.id)} disabled={running} />)}
        </View>

        <View style={styles.numberRow}>
          <View style={styles.numberBlock}>
            <Text style={styles.label}>BPM</Text>
            <View style={styles.stepRow}>
              <SmallButton label="-5" onPress={() => setBpm((value) => Math.max(35, value - 5))} disabled={running} />
              <Text style={styles.numberValue}>{bpm}</Text>
              <SmallButton label="+5" onPress={() => setBpm((value) => Math.min(220, value + 5))} disabled={running} />
            </View>
          </View>
          <View style={styles.numberBlock}>
            <Text style={styles.label}>마디 수</Text>
            <View style={styles.stepRow}>
              <SmallButton label="-4" onPress={() => setBarCount((value) => Math.max(4, value - 4))} disabled={running} />
              <Text style={styles.numberValue}>{barCount}</Text>
              <SmallButton label="+4" onPress={() => setBarCount((value) => Math.min(32, value + 4))} disabled={running} />
            </View>
          </View>
        </View>

        <View style={styles.mainActionRow}>
          <Pressable disabled={running} onPress={generate} style={[styles.primaryButton, running && styles.disabled]}><Text style={styles.primaryText}>악보 초안 만들기</Text></Pressable>
          <Pressable disabled={!draft || running} onPress={() => void save()} style={[styles.secondaryButton, (!draft || running) && styles.disabled]}><Text style={styles.secondaryText}>저장</Text></Pressable>
          <Pressable disabled={!draft || running} onPress={() => void duplicate()} style={[styles.secondaryButton, (!draft || running) && styles.disabled]}><Text style={styles.secondaryText}>복제</Text></Pressable>
        </View>
      </View>

      {draft ? (
        <View style={styles.practiceCard}>
          <View style={styles.songHeader}>
            <View style={styles.songHeaderText}>
              <Text style={styles.songTitle}>{draft.title}</Text>
              <Text style={styles.songMeta}>{draft.artist || '연습용 초안'} · Key {draft.key} · {draft.bpm} BPM · {draft.style}</Text>
            </View>
            <View style={styles.sourceBadge}><Text style={styles.sourceText}>오프라인 초안</Text></View>
          </View>

          <View style={styles.nowCard}>
            <View style={styles.nowBlock}>
              <Text style={styles.nowLabel}>현재 · {currentBarIndex + 1}마디 {currentBeat}박</Text>
              <Text style={styles.currentChord}>{currentBar?.chord ?? '-'}</Text>
              <Text style={styles.instruction}>{currentBar?.instruction}</Text>
            </View>
            <View style={styles.nextBlock}>
              <Text style={styles.nowLabel}>다음 코드</Text>
              <Text style={styles.nextChord}>{nextBar?.chord ?? '-'}</Text>
            </View>
          </View>

          <Text style={styles.label}>재생 속도 · 실제 {effectiveBpm} BPM</Text>
          <View style={styles.wrapRow}>
            {SPEEDS.map((item) => <SmallButton key={item} label={`${item.toFixed(2)}x`} active={speed === item} onPress={() => setSpeed(item)} disabled={running} />)}
          </View>

          <View style={styles.loopRow}>
            <View style={styles.loopBlock}>
              <Text style={styles.label}>A 시작 마디</Text>
              <View style={styles.stepRow}>
                <SmallButton label="-" onPress={() => setLoopStart((value) => Math.max(0, value - 1))} disabled={running} />
                <Text style={styles.numberValue}>{loopStart + 1}</Text>
                <SmallButton label="+" onPress={() => setLoopStart((value) => Math.min(loopEnd, value + 1))} disabled={running} />
              </View>
            </View>
            <View style={styles.loopBlock}>
              <Text style={styles.label}>B 끝 마디</Text>
              <View style={styles.stepRow}>
                <SmallButton label="-" onPress={() => setLoopEnd((value) => Math.max(loopStart, value - 1))} disabled={running} />
                <Text style={styles.numberValue}>{loopEnd + 1}</Text>
                <SmallButton label="+" onPress={() => setLoopEnd((value) => Math.min(draft.bars.length - 1, value + 1))} disabled={running} />
              </View>
            </View>
          </View>

          <Text style={styles.label}>마디 악보 · 정지 중 마디를 누르면 코드 변경</Text>
          <View style={styles.barGrid}>
            {draft.bars.map((bar, index) => (
              <Pressable
                key={bar.id}
                onPress={() => cycleChord(bar.id, bar.chord)}
                style={[
                  styles.barCard,
                  index >= loopStart && index <= loopEnd && styles.barInLoop,
                  index === currentBarIndex && running && styles.barCurrent,
                ]}
              >
                <Text style={styles.barNumber}>{index + 1}</Text>
                <Text style={styles.barChord}>{bar.chord}</Text>
                <Text style={styles.barInstruction} numberOfLines={2}>{bar.instruction}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable onPress={() => void toggleRunning()} style={[styles.playButton, running && styles.stopButton]}>
            <Text style={styles.playText}>{running ? '곡 연습 정지' : `${loopStart + 1}~${loopEnd + 1}마디 연습 시작`}</Text>
          </Pressable>
        </View>
      ) : null}

      {projects.length ? (
        <View style={styles.savedCard}>
          <Text style={styles.sectionTitle}>저장된 곡</Text>
          {projects.map((project) => (
            <View key={project.id} style={styles.projectRow}>
              <Pressable onPress={() => loadProject(project)} style={styles.projectMain}>
                <Text style={styles.projectTitle}>{project.title}</Text>
                <Text style={styles.projectMeta}>{project.guitarMode === 'acoustic' ? '통기타' : '일렉'} · {project.key} · {project.bpm} BPM · {project.bars.length}마디</Text>
              </Pressable>
              <Pressable onPress={() => removeProject(project)} style={styles.deleteButton}><Text style={styles.deleteText}>삭제</Text></Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.statusCard}><Text style={styles.statusText}>{status}</Text></View>
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
  formCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 11, marginTop: 12 },
  label: { color: '#b1bac4', fontSize: 8, fontWeight: '900', marginTop: 9, marginBottom: 5 },
  input: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', color: '#f0f6fc', fontSize: 11, paddingHorizontal: 11, marginBottom: 2 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  smallButton: { minHeight: 33, minWidth: 42, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  smallButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  smallButtonText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  smallButtonTextActive: { color: '#ffffff' },
  numberRow: { flexDirection: 'row', gap: 10 },
  numberBlock: { flex: 1 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  numberValue: { color: '#f0f6fc', fontSize: 17, fontWeight: '900', minWidth: 40, textAlign: 'center' },
  mainActionRow: { flexDirection: 'row', gap: 5, marginTop: 12 },
  primaryButton: { flex: 1.3, minHeight: 41, borderRadius: 11, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  secondaryButton: { flex: 0.75, minHeight: 41, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  practiceCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 17, padding: 11, marginTop: 11 },
  songHeader: { flexDirection: 'row', alignItems: 'center' },
  songHeaderText: { flex: 1, paddingRight: 7 },
  songTitle: { color: '#f0f6fc', fontSize: 17, fontWeight: '900' },
  songMeta: { color: '#8b949e', fontSize: 8, marginTop: 3 },
  sourceBadge: { backgroundColor: '#2d2208', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 5 },
  sourceText: { color: '#f2cc60', fontSize: 7, fontWeight: '900' },
  nowCard: { flexDirection: 'row', backgroundColor: '#0d1117', borderRadius: 13, padding: 10, marginTop: 9 },
  nowBlock: { flex: 1 },
  nextBlock: { width: 82, alignItems: 'flex-end' },
  nowLabel: { color: '#8b949e', fontSize: 7, fontWeight: '900' },
  currentChord: { color: '#7ee787', fontSize: 31, fontWeight: '900', marginTop: 2 },
  nextChord: { color: '#79c0ff', fontSize: 22, fontWeight: '900', marginTop: 5 },
  instruction: { color: '#b1bac4', fontSize: 8, marginTop: 2 },
  loopRow: { flexDirection: 'row', gap: 10 },
  loopBlock: { flex: 1 },
  barGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  barCard: { width: '23.5%', minHeight: 80, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', padding: 7 },
  barInLoop: { borderColor: '#1f6feb' },
  barCurrent: { backgroundColor: '#238636', borderColor: '#7ee787' },
  barNumber: { color: '#6e7681', fontSize: 6, fontWeight: '900' },
  barChord: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', marginTop: 3 },
  barInstruction: { color: '#8b949e', fontSize: 6, lineHeight: 9, marginTop: 3 },
  playButton: { minHeight: 45, borderRadius: 12, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', marginTop: 11 },
  stopButton: { backgroundColor: '#da3633' },
  playText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  savedCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 11, marginTop: 11 },
  sectionTitle: { color: '#f0f6fc', fontSize: 12, fontWeight: '900', marginBottom: 6 },
  projectRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  projectMain: { flex: 1, paddingRight: 7 },
  projectTitle: { color: '#f0f6fc', fontSize: 10, fontWeight: '900' },
  projectMeta: { color: '#8b949e', fontSize: 7, marginTop: 2 },
  deleteButton: { minWidth: 42, height: 32, borderRadius: 9, borderWidth: 1, borderColor: '#da3633', backgroundColor: '#2d1618', alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#ff7b72', fontSize: 7, fontWeight: '900' },
  statusCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 12, padding: 9, marginTop: 10 },
  statusText: { color: '#b6d8ff', fontSize: 8, lineHeight: 13 },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 13, marginTop: 7 },
  disabled: { opacity: 0.4 },
});
