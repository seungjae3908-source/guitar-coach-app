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
  loadSongProjects,
  saveSongProject,
} from '../services/song-project-store';
import {
  boardChordPalette,
  clampBoardIndex,
  cloneBoardSongProject,
  duplicateBoardBar,
  ensureSongBoard,
  moveBoardBar,
  removeBoardBar,
  replaceBoardBarChord,
  replaceBoardBarPattern,
  replaceBoardBarSection,
  setBoardBeatsPerBar,
  setBoardCapo,
  songBarPattern,
  SONG_BOARD_METERS,
  SONG_BOARD_SECTIONS,
  type SongBoardMode,
  type SongBoardPattern,
  type SongBoardSection,
} from '../services/song-sheet-board';
import {
  compactBarNotation,
  eventsAtBeat,
  generateSongSheetDraft,
  SONG_KEYS,
  type SongBeatEvent,
  type SongKey,
  type SongPracticeStyle,
  type SongSheetDraft,
} from '../services/song-sheet-engine';

const STYLES: Array<{ id: SongPracticeStyle; label: string; detail: string }> = [
  { id: 'strum', label: '스트럼', detail: '다운·업과 쉼표' },
  { id: 'arpeggio', label: '아르페지오', detail: 'P·i·m 손가락' },
  { id: 'riff', label: '리프·TAB', detail: '줄·프렛 초안' },
];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;

function Chip({
  label,
  active,
  disabled,
  onPress,
  compact,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        compact && styles.chipCompact,
        active && styles.chipActive,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  disabled,
  suffix,
}: {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  disabled?: boolean;
  suffix?: string;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <Chip label="−" onPress={onMinus} disabled={disabled} compact />
        <Text style={styles.stepperValue}>{value}{suffix ?? ''}</Text>
        <Chip label="+" onPress={onPlus} disabled={disabled} compact />
      </View>
    </View>
  );
}

function sectionLabel(section: SongBoardSection) {
  return SONG_BOARD_SECTIONS.find((item) => item.id === section)?.label ?? section;
}

function eventMainText(event: SongBeatEvent | null) {
  if (!event) return '쉼';
  if (event.kind === 'tab') return `${event.strings[0]}번 줄 · ${event.frets[0]}프렛`;
  if (event.kind === 'finger') return `${event.label} 손가락 · ${event.strings[0]}번 줄`;
  if (event.kind === 'hold') return '유지';
  return event.label === 'D' ? '다운 스트럼' : '업 스트럼';
}

function eventTargetText(event: SongBeatEvent | null) {
  if (!event) return '현재 박은 새로 치지 않습니다.';
  if (event.kind === 'tab') return `${event.strings[0]}번 줄 ${event.frets[0]}프렛${event.accent ? ' · 악센트' : ''}`;
  if (event.kind === 'finger') return `${event.label}로 ${event.strings[0]}번 줄을 탄현하세요.`;
  if (event.kind === 'hold') return '직전 소리를 유지하세요.';
  return event.label === 'D'
    ? `저음에서 고음 방향 · ${event.strings.join('·')}번 줄`
    : `고음줄 중심 복귀 · ${event.strings.join('·')}번 줄`;
}

function eventCellText(event: SongBeatEvent) {
  if (event.kind === 'tab') return `${event.strings[0]}-${event.frets[0]}`;
  return event.label;
}

export default function SongPracticePanel({ mode }: { mode: GuitarModeId }) {
  const [projects, setProjects] = useState<SongSheetDraft[]>([]);
  const [draft, setDraft] = useState<SongSheetDraft | null>(null);
  const [boardMode, setBoardMode] = useState<SongBoardMode>('edit');
  const [title, setTitle] = useState('나의 연습곡');
  const [artist, setArtist] = useState('');
  const [keyName, setKeyName] = useState<SongKey>(mode === 'acoustic' ? 'G' : 'E');
  const [style, setStyle] = useState<SongPracticeStyle>(mode === 'acoustic' ? 'strum' : 'riff');
  const [bpm, setBpm] = useState(80);
  const [capo, setCapo] = useState(0);
  const [beatsPerBar, setBeatsPerBar] = useState<3 | 4>(4);
  const [barCount, setBarCount] = useState(8);
  const [selectedBarIndex, setSelectedBarIndex] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(7);
  const [currentBarIndex, setCurrentBarIndex] = useState(0);
  const [currentBeat, setCurrentBeat] = useState(1);
  const [currentSubdivision, setCurrentSubdivision] = useState<1 | 2>(1);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('새 악보를 만들거나 저장된 악보를 불러오세요.');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const loaded = (await loadSongProjects()).map(ensureSongBoard);
      setProjects(loaded);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '저장된 악보를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setKeyName(mode === 'acoustic' ? 'G' : 'E');
    setStyle(mode === 'acoustic' ? 'strum' : 'riff');
    setCapo(0);
    setBeatsPerBar(4);
    setDraft(null);
    setBoardMode('edit');
    setSelectedBarIndex(0);
    setLoopStart(0);
    setLoopEnd(7);
    setCurrentBarIndex(0);
    setCurrentBeat(1);
    setCurrentSubdivision(1);
    setRunning(false);
    void stopAdvancedMetronomeAsync();
  }, [mode]);

  useEffect(() => () => {
    void stopAdvancedMetronomeAsync();
  }, []);

  useEffect(() => {
    if (!draft) return;
    const last = Math.max(0, draft.bars.length - 1);
    setSelectedBarIndex((value) => Math.min(last, value));
    setCurrentBarIndex((value) => Math.min(last, value));
    setLoopStart((value) => Math.min(last, value));
    setLoopEnd((value) => Math.max(Math.min(last, value), Math.min(last, loopStart)));
  }, [draft?.bars.length, loopStart]);

  useEffect(() => {
    if (!draft || running || draft.capo === capo) return;
    setDraft((current) => current ? setBoardCapo(current, capo) : current);
  }, [capo, draft?.capo, running]);

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
          const pulseInBar = completedPulses % pulsesPerBar;
          const nextBar = loopStart + Math.floor(completedPulses / pulsesPerBar) % loopLength;
          const nextBeat = Math.floor(pulseInBar / timing.subdivision) + 1;
          const nextSubdivision = Math.min(2, pulseInBar % timing.subdivision + 1) as 1 | 2;
          setCurrentBarIndex(nextBar);
          setCurrentBeat(nextBeat);
          setCurrentSubdivision(nextSubdivision);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '연주 위치를 읽지 못했습니다.');
      } finally {
        if (!cancelled) timer = setTimeout(poll, 60);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [draft, loopEnd, loopStart, running]);

  const modeProjects = useMemo(
    () => projects.filter((project) => project.guitarMode === mode),
    [mode, projects],
  );
  const selectedIndex = clampBoardIndex(draft, selectedBarIndex);
  const selectedBar = draft?.bars[selectedIndex] ?? null;
  const currentBar = draft?.bars[currentBarIndex] ?? null;
  const nextBarIndex = draft
    ? currentBarIndex >= loopEnd ? loopStart : Math.min(draft.bars.length - 1, currentBarIndex + 1)
    : 0;
  const nextBar = draft?.bars[nextBarIndex] ?? null;
  const currentBeatEvents = useMemo(
    () => eventsAtBeat(currentBar, currentBeat),
    [currentBar, currentBeat],
  );
  const currentEvent = currentBeatEvents.find((event) => event.subdivision === currentSubdivision)
    ?? currentBeatEvents[0]
    ?? null;
  const effectiveBpm = Math.max(35, Math.min(220, Math.round(bpm * speed)));
  const chordPalette = useMemo(() => draft ? boardChordPalette(draft) : [], [draft]);

  const generate = () => {
    const next = ensureSongBoard(generateSongSheetDraft({
      guitarMode: mode,
      title,
      artist,
      key: keyName,
      capo,
      bpm,
      beatsPerBar,
      style,
      barCount,
    }));
    setDraft(next);
    setSelectedBarIndex(0);
    setCurrentBarIndex(0);
    setCurrentBeat(1);
    setCurrentSubdivision(1);
    setLoopStart(0);
    setLoopEnd(next.bars.length - 1);
    setBoardMode('edit');
    setStatus(`${beatsPerBar}/4 · ${next.bars.length}마디 악보판을 만들었습니다.`);
    setError('');
  };

  const save = async () => {
    if (!draft) return;
    const next = ensureSongBoard({
      ...draft,
      title: title.trim() || draft.title,
      artist: artist.trim(),
      bpm,
      updatedAt: new Date().toISOString(),
    });
    try {
      await saveSongProject(next);
      setDraft(next);
      await reload();
      setStatus('악보판과 마디별 편집 내용을 휴대폰에 저장했습니다.');
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '악보를 저장하지 못했습니다.');
    }
  };

  const duplicateProject = async () => {
    if (!draft) return;
    try {
      const copy = cloneBoardSongProject(draft);
      await saveSongProject(copy);
      await reload();
      loadProject(copy);
      setStatus('마디와 이벤트 ID까지 분리한 악보 복사본을 만들었습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '악보를 복제하지 못했습니다.');
    }
  };

  const loadProject = (project: SongSheetDraft) => {
    const next = ensureSongBoard(project);
    void stopAdvancedMetronomeAsync();
    setRunning(false);
    setDraft(next);
    setTitle(next.title);
    setArtist(next.artist);
    setKeyName(next.key);
    setStyle(next.style);
    setBpm(next.bpm);
    setCapo(next.capo ?? 0);
    setBeatsPerBar(next.beatsPerBar === 3 ? 3 : 4);
    setBarCount(next.bars.length);
    setSelectedBarIndex(0);
    setCurrentBarIndex(0);
    setCurrentBeat(1);
    setCurrentSubdivision(1);
    setLoopStart(0);
    setLoopEnd(next.bars.length - 1);
    setBoardMode('edit');
    setStatus('저장된 악보판을 불러왔습니다.');
    setError('');
  };

  const removeProject = (project: SongSheetDraft) => {
    Alert.alert('악보 삭제', `${project.title} 악보를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          void deleteSongProject(project.id)
            .then(async () => {
              if (draft?.id === project.id) setDraft(null);
              await reload();
              setStatus('저장된 악보를 삭제했습니다.');
            })
            .catch((caught) => setError(caught instanceof Error ? caught.message : '악보를 삭제하지 못했습니다.'));
        },
      },
    ]);
  };

  const changeBpm = (delta: number) => {
    const next = Math.max(35, Math.min(220, bpm + delta));
    setBpm(next);
    if (!running) setDraft((current) => current ? { ...current, bpm: next } : current);
  };

  const changeMeter = (meter: 3 | 4) => {
    if (running) return;
    setBeatsPerBar(meter);
    setCurrentBeat(1);
    setCurrentSubdivision(1);
    setDraft((current) => current ? setBoardBeatsPerBar(current, meter) : current);
    setStatus(`${meter}/4 박자로 악보 전체를 다시 정렬했습니다.`);
  };

  const selectBar = (index: number) => {
    setSelectedBarIndex(index);
    if (!running) {
      setCurrentBarIndex(index);
      setCurrentBeat(1);
      setCurrentSubdivision(1);
    }
  };

  const applyChord = (chord: string) => {
    if (!draft || !selectedBar || running) return;
    setDraft(replaceBoardBarChord(draft, selectedBar.id, chord));
    setStatus(`${selectedIndex + 1}마디 코드를 ${chord}(으)로 바꿨습니다.`);
  };

  const applySection = (section: SongBoardSection) => {
    if (!draft || !selectedBar || running) return;
    setDraft(replaceBoardBarSection(draft, selectedBar.id, section));
    setStatus(`${selectedIndex + 1}마디를 ${sectionLabel(section)} 구간으로 지정했습니다.`);
  };

  const applyPattern = (pattern: SongBoardPattern) => {
    if (!draft || !selectedBar || running) return;
    setDraft(replaceBoardBarPattern(draft, selectedBar.id, pattern));
    setStatus(`${selectedIndex + 1}마디에 패턴 ${pattern === 0 ? 'A' : 'B'}를 적용했습니다.`);
  };

  const duplicateSelectedBar = () => {
    if (!draft || running) return;
    const next = duplicateBoardBar(draft, selectedIndex);
    setDraft(next);
    setSelectedBarIndex(Math.min(next.bars.length - 1, selectedIndex + 1));
    setLoopEnd(next.bars.length - 1);
    setBarCount(next.bars.length);
    setStatus(`${selectedIndex + 1}마디를 바로 뒤에 복제했습니다.`);
  };

  const deleteSelectedBar = () => {
    if (!draft || running) return;
    if (draft.bars.length <= 4) {
      setError('악보는 최소 4마디를 유지해야 합니다.');
      return;
    }
    const next = removeBoardBar(draft, selectedIndex);
    setDraft(next);
    setSelectedBarIndex(Math.min(next.bars.length - 1, selectedIndex));
    setLoopEnd(next.bars.length - 1);
    setBarCount(next.bars.length);
    setStatus('선택 마디를 삭제했습니다.');
    setError('');
  };

  const moveSelectedBar = (direction: -1 | 1) => {
    if (!draft || running) return;
    const nextIndex = selectedIndex + direction;
    if (nextIndex < 0 || nextIndex >= draft.bars.length) return;
    setDraft(moveBoardBar(draft, selectedIndex, direction));
    setSelectedBarIndex(nextIndex);
    setStatus(`선택 마디를 ${direction < 0 ? '앞' : '뒤'}으로 이동했습니다.`);
  };

  const movePlayback = (direction: -1 | 1) => {
    if (!draft || running) return;
    const loopLength = Math.max(1, loopEnd - loopStart + 1);
    const relative = (currentBarIndex - loopStart + direction + loopLength) % loopLength;
    const next = loopStart + relative;
    setCurrentBarIndex(next);
    setSelectedBarIndex(next);
    setCurrentBeat(1);
    setCurrentSubdivision(1);
  };

  const toggleRunning = async () => {
    if (!draft) {
      setError('먼저 악보를 만들거나 불러오세요.');
      return;
    }
    setError('');
    try {
      if (running) {
        await stopAdvancedMetronomeAsync();
        setRunning(false);
        setStatus('연주판을 정지했습니다.');
        return;
      }
      if (!isAdvancedMetronomeAvailable) throw new Error('고급 메트로놈 모듈이 APK에 없습니다.');
      setCurrentBarIndex(loopStart);
      setSelectedBarIndex(loopStart);
      setCurrentBeat(1);
      setCurrentSubdivision(1);
      await startAdvancedMetronomeAsync(effectiveBpm, draft.beatsPerBar, 2, true, false, 0);
      setRunning(true);
      setStatus(`${loopStart + 1}~${loopEnd + 1}마디 · ${effectiveBpm} BPM 연주를 시작했습니다.`);
    } catch (caught) {
      setRunning(false);
      setError(caught instanceof Error ? caught.message : '연주판을 시작하지 못했습니다.');
    }
  };

  const openPlayBoard = () => {
    if (!draft) {
      setError('먼저 악보를 만들거나 불러오세요.');
      return;
    }
    setBoardMode('play');
    setCurrentBarIndex(selectedIndex);
    setCurrentBeat(1);
    setCurrentSubdivision(1);
    setStatus('큰 글씨 연주판을 열었습니다.');
    setError('');
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>SCORE BOARD V4 · OFFLINE</Text>
        <Text style={styles.title}>{mode === 'acoustic' ? '통기타' : '일렉기타'} 악보판</Text>
        <Text style={styles.subtitle}>
          편집할 때는 마디를 선택해 코드·구간·패턴을 고치고, 연주할 때는 현재 코드와 다음 코드를 큰 글씨로 봅니다.
        </Text>
        <View style={styles.modeTabs}>
          <Pressable
            onPress={() => !running && setBoardMode('edit')}
            disabled={running}
            style={[styles.modeTab, boardMode === 'edit' && styles.modeTabActive, running && styles.disabled]}
          >
            <Text style={[styles.modeTabText, boardMode === 'edit' && styles.modeTabTextActive]}>편집판</Text>
            <Text style={styles.modeTabHint}>마디·코드 수정</Text>
          </Pressable>
          <Pressable
            onPress={openPlayBoard}
            style={[styles.modeTab, boardMode === 'play' && styles.modeTabActive]}
          >
            <Text style={[styles.modeTabText, boardMode === 'play' && styles.modeTabTextActive]}>연주판</Text>
            <Text style={styles.modeTabHint}>큰 글씨·A-B 반복</Text>
          </Pressable>
        </View>
      </View>

      {boardMode === 'edit' ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>새 악보 설정</Text>
            <Text style={styles.sectionDescription}>현재 악보를 편집 중이어도 ‘악보 만들기’를 누르기 전까지 덮어쓰지 않습니다.</Text>

            <Text style={styles.fieldLabel}>곡 제목</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              editable={!running}
              style={styles.input}
              placeholder="곡 제목"
              placeholderTextColor="#6e7681"
            />
            <Text style={styles.fieldLabel}>가수·연습 메모</Text>
            <TextInput
              value={artist}
              onChangeText={setArtist}
              editable={!running}
              style={styles.input}
              placeholder="가수 또는 연습 메모"
              placeholderTextColor="#6e7681"
            />

            <Text style={styles.fieldLabel}>원키</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalChips}>
              {SONG_KEYS.map((item) => (
                <Chip key={item} label={item} active={keyName === item} onPress={() => setKeyName(item)} disabled={running} />
              ))}
            </ScrollView>

            <Text style={styles.fieldLabel}>악보 종류</Text>
            <View style={styles.styleGrid}>
              {STYLES.map((item) => (
                <Pressable
                  key={item.id}
                  disabled={running}
                  onPress={() => setStyle(item.id)}
                  style={[styles.styleCard, style === item.id && styles.styleCardActive, running && styles.disabled]}
                >
                  <Text style={[styles.styleLabel, style === item.id && styles.styleLabelActive]}>{item.label}</Text>
                  <Text style={styles.styleDetail}>{item.detail}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.settingsGrid}>
              <Stepper label="BPM" value={bpm} onMinus={() => changeBpm(-1)} onPlus={() => changeBpm(1)} disabled={running} />
              <Stepper label="카포" value={capo} onMinus={() => setCapo((value) => Math.max(0, value - 1))} onPlus={() => setCapo((value) => Math.min(11, value + 1))} disabled={running} />
              <Stepper label="마디" value={barCount} onMinus={() => setBarCount((value) => Math.max(4, value - 1))} onPlus={() => setBarCount((value) => Math.min(32, value + 1))} disabled={running} />
            </View>

            <Text style={styles.fieldLabel}>박자</Text>
            <View style={styles.rowWrap}>
              {SONG_BOARD_METERS.map((meter) => (
                <Chip
                  key={meter}
                  label={`${meter}/4`}
                  active={beatsPerBar === meter}
                  onPress={() => changeMeter(meter)}
                  disabled={running}
                />
              ))}
            </View>

            <View style={styles.actionRow}>
              <Pressable disabled={running} onPress={generate} style={[styles.primaryButton, running && styles.disabled]}>
                <Text style={styles.primaryButtonText}>새 악보 만들기</Text>
              </Pressable>
              <Pressable disabled={!draft || running} onPress={() => void save()} style={[styles.secondaryButton, (!draft || running) && styles.disabled]}>
                <Text style={styles.secondaryButtonText}>저장</Text>
              </Pressable>
              <Pressable disabled={!draft || running} onPress={() => void duplicateProject()} style={[styles.secondaryButton, (!draft || running) && styles.disabled]}>
                <Text style={styles.secondaryButtonText}>복사본</Text>
              </Pressable>
            </View>
          </View>

          {draft && selectedBar ? (
            <>
              <View style={styles.summaryCard}>
                <View style={styles.summaryText}>
                  <Text style={styles.summaryTitle}>{draft.title}</Text>
                  <Text style={styles.summaryMeta}>
                    원키 {draft.key} · 폼 {draft.shapeKey ?? draft.key} · 카포 {draft.capo ?? 0} · {draft.beatsPerBar}/4 · {draft.bars.length}마디
                  </Text>
                </View>
                <View style={styles.versionBadge}><Text style={styles.versionText}>악보판 V4</Text></View>
              </View>

              <View style={styles.card}>
                <View style={styles.editorHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>선택 마디 편집</Text>
                    <Text style={styles.selectedBarTitle}>{selectedIndex + 1}마디 · {selectedBar.chord}</Text>
                  </View>
                  <Text style={styles.selectedSection}>{sectionLabel(selectedBar.section)}</Text>
                </View>

                <Text style={styles.fieldLabel}>코드 선택</Text>
                <View style={styles.rowWrap}>
                  {chordPalette.map((chord) => (
                    <Chip
                      key={chord}
                      label={chord}
                      active={selectedBar.chord === chord}
                      onPress={() => applyChord(chord)}
                      disabled={running}
                    />
                  ))}
                </View>

                <Text style={styles.fieldLabel}>곡 구간</Text>
                <View style={styles.rowWrap}>
                  {SONG_BOARD_SECTIONS.map((item) => (
                    <Chip
                      key={item.id}
                      label={item.label}
                      active={selectedBar.section === item.id}
                      onPress={() => applySection(item.id)}
                      disabled={running}
                    />
                  ))}
                </View>

                <Text style={styles.fieldLabel}>리듬·핑거링 패턴</Text>
                <View style={styles.patternRow}>
                  <Pressable
                    onPress={() => applyPattern(0)}
                    style={[styles.patternCard, songBarPattern(selectedBar, selectedIndex) === 0 && styles.patternCardActive]}
                  >
                    <Text style={styles.patternName}>패턴 A</Text>
                    <Text style={styles.patternNotation}>{compactBarNotation(replaceBoardBarPattern(draft, selectedBar.id, 0).bars[selectedIndex])}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => applyPattern(1)}
                    style={[styles.patternCard, songBarPattern(selectedBar, selectedIndex) === 1 && styles.patternCardActive]}
                  >
                    <Text style={styles.patternName}>패턴 B</Text>
                    <Text style={styles.patternNotation}>{compactBarNotation(replaceBoardBarPattern(draft, selectedBar.id, 1).bars[selectedIndex])}</Text>
                  </Pressable>
                </View>

                <View style={styles.barActionGrid}>
                  <Chip label="← 앞으로" onPress={() => moveSelectedBar(-1)} disabled={selectedIndex === 0 || running} />
                  <Chip label="뒤로 →" onPress={() => moveSelectedBar(1)} disabled={selectedIndex === draft.bars.length - 1 || running} />
                  <Chip label="마디 복제" onPress={duplicateSelectedBar} disabled={running} />
                  <Chip label="마디 삭제" onPress={deleteSelectedBar} disabled={running || draft.bars.length <= 4} />
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>전체 악보</Text>
                <Text style={styles.sectionDescription}>마디를 누르면 선택만 됩니다. 코드는 위의 팔레트에서 명확하게 바꿉니다.</Text>
                <View style={styles.barGrid}>
                  {draft.bars.map((bar, index) => {
                    const selected = index === selectedIndex;
                    return (
                      <Pressable
                        key={bar.id}
                        onPress={() => selectBar(index)}
                        style={[styles.barCard, selected && styles.barCardSelected]}
                      >
                        <View style={styles.barTopRow}>
                          <Text style={styles.barNumber}>{index + 1}</Text>
                          <Text style={styles.barSection}>{sectionLabel(bar.section)}</Text>
                        </View>
                        <Text style={styles.barChord}>{bar.chord}</Text>
                        <Text style={styles.barSounding}>울림 {bar.soundingChord ?? bar.chord}</Text>
                        <Text style={styles.barPattern}>패턴 {songBarPattern(bar, index) === 0 ? 'A' : 'B'}</Text>
                        <Text style={styles.barNotation} numberOfLines={2}>{compactBarNotation(bar)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable onPress={openPlayBoard} style={styles.openPlayButton}>
                  <Text style={styles.openPlayText}>선택한 {selectedIndex + 1}마디부터 큰 글씨 연주판 열기</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {modeProjects.length ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>저장된 {mode === 'acoustic' ? '통기타' : '일렉기타'} 악보</Text>
              {modeProjects.map((project) => (
                <View key={project.id} style={styles.projectRow}>
                  <Pressable onPress={() => loadProject(project)} style={styles.projectMain}>
                    <Text style={styles.projectTitle}>{project.title}</Text>
                    <Text style={styles.projectMeta}>
                      {project.key} · 카포 {project.capo ?? 0} · {project.beatsPerBar}/4 · {project.bpm} BPM · {project.bars.length}마디
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => removeProject(project)} style={styles.deleteButton}>
                    <Text style={styles.deleteText}>삭제</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : draft ? (
        <>
          <View style={styles.playHero}>
            <View style={styles.playTopRow}>
              <View>
                <Text style={styles.playSongTitle}>{draft.title}</Text>
                <Text style={styles.playMeta}>{effectiveBpm} BPM · {draft.beatsPerBar}/4 · {loopStart + 1}~{loopEnd + 1}마디 반복</Text>
              </View>
              <View style={[styles.playStateBadge, running && styles.playStateBadgeRunning]}>
                <Text style={styles.playStateText}>{running ? '재생 중' : '정지'}</Text>
              </View>
            </View>

            <Text style={styles.playPosition}>{currentBarIndex + 1}마디 · {currentBeat}{currentSubdivision === 1 ? '' : '&'}</Text>
            <Text style={styles.giantChord}>{currentBar?.chord ?? '-'}</Text>
            <Text style={styles.soundingChord}>실제 울림 {currentBar?.soundingChord ?? currentBar?.chord ?? '-'}</Text>

            <View style={styles.nextChordRow}>
              <Text style={styles.nextChordLabel}>다음</Text>
              <Text style={styles.nextChordValue}>{nextBar?.chord ?? '-'}</Text>
              <Text style={styles.nextChordSection}>{nextBar ? sectionLabel(nextBar.section) : '-'}</Text>
            </View>
          </View>

          <View style={styles.cueCard}>
            <Text style={styles.cueLabel}>지금 연주</Text>
            <Text style={styles.cueMain}>{eventMainText(currentEvent)}</Text>
            <Text style={styles.cueDetail}>{eventTargetText(currentEvent)}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>현재 마디</Text>
            <View style={styles.eventGrid}>
              {(currentBar?.events ?? []).map((event) => {
                const active = event.beat === currentBeat && event.subdivision === currentSubdivision;
                return (
                  <View key={event.id} style={[styles.eventCell, active && styles.eventCellActive]}>
                    <Text style={[styles.eventPosition, active && styles.eventTextActive]}>{event.beat}{event.subdivision === 1 ? '' : '&'}</Text>
                    <Text style={[styles.eventLabel, active && styles.eventTextActive]}>{eventCellText(event)}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.playNavigation}>
              <Pressable disabled={running} onPress={() => movePlayback(-1)} style={[styles.navButton, running && styles.disabled]}>
                <Text style={styles.navButtonText}>← 이전 마디</Text>
              </Pressable>
              <Pressable disabled={running} onPress={() => movePlayback(1)} style={[styles.navButton, running && styles.disabled]}>
                <Text style={styles.navButtonText}>다음 마디 →</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>악보 흐름</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeline}>
              {draft.bars.map((bar, index) => (
                <Pressable
                  key={bar.id}
                  disabled={running}
                  onPress={() => selectBar(index)}
                  style={[
                    styles.timelineBar,
                    index >= loopStart && index <= loopEnd && styles.timelineBarLoop,
                    index === currentBarIndex && styles.timelineBarCurrent,
                  ]}
                >
                  <Text style={styles.timelineNumber}>{index + 1}</Text>
                  <Text style={styles.timelineChord}>{bar.chord}</Text>
                  <Text style={styles.timelineSection}>{sectionLabel(bar.section)}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.fieldLabel}>재생 속도 · 실제 {effectiveBpm} BPM</Text>
            <View style={styles.rowWrap}>
              {SPEEDS.map((item) => (
                <Chip
                  key={item}
                  label={`${item.toFixed(2)}x`}
                  active={speed === item}
                  onPress={() => setSpeed(item)}
                  disabled={running}
                />
              ))}
            </View>

            <View style={styles.loopGrid}>
              <Stepper
                label="A 시작"
                value={loopStart + 1}
                onMinus={() => setLoopStart((value) => Math.max(0, value - 1))}
                onPlus={() => setLoopStart((value) => Math.min(loopEnd, value + 1))}
                disabled={running}
              />
              <Stepper
                label="B 끝"
                value={loopEnd + 1}
                onMinus={() => setLoopEnd((value) => Math.max(loopStart, value - 1))}
                onPlus={() => setLoopEnd((value) => Math.min(draft.bars.length - 1, value + 1))}
                disabled={running}
              />
            </View>

            <Pressable onPress={() => void toggleRunning()} style={[styles.playButton, running && styles.stopButton]}>
              <Text style={styles.playButtonText}>{running ? '연주 정지' : '카운트와 악보 커서 시작'}</Text>
            </Pressable>
            <Pressable disabled={running} onPress={() => setBoardMode('edit')} style={[styles.backToEditButton, running && styles.disabled]}>
              <Text style={styles.backToEditText}>편집판으로 돌아가기</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>연주할 악보가 없습니다</Text>
          <Text style={styles.emptyText}>편집판에서 새 악보를 만들거나 저장된 악보를 불러오세요.</Text>
          <Pressable onPress={() => setBoardMode('edit')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>편집판 열기</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.statusCard}><Text style={styles.statusText}>{status}</Text></View>
      {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 13, paddingBottom: 120 },
  hero: { borderRadius: 20, padding: 16, backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb' },
  eyebrow: { color: '#79c0ff', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#ffffff', fontSize: 26, fontWeight: '900', marginTop: 4 },
  subtitle: { color: '#b6d8ff', fontSize: 11, lineHeight: 18, marginTop: 7 },
  modeTabs: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modeTab: { flex: 1, minHeight: 64, borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 11, justifyContent: 'center' },
  modeTabActive: { borderColor: '#58a6ff', backgroundColor: '#16365f' },
  modeTabText: { color: '#b1bac4', fontSize: 15, fontWeight: '900' },
  modeTabTextActive: { color: '#ffffff' },
  modeTabHint: { color: '#8b949e', fontSize: 9, marginTop: 4 },
  card: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, padding: 14, marginTop: 12 },
  sectionTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '900' },
  sectionDescription: { color: '#8b949e', fontSize: 10, lineHeight: 16, marginTop: 5 },
  fieldLabel: { color: '#b1bac4', fontSize: 10, fontWeight: '900', marginTop: 13, marginBottom: 7 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', color: '#f0f6fc', fontSize: 13, paddingHorizontal: 12, marginBottom: 2 },
  horizontalChips: { gap: 6, paddingRight: 14 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { minHeight: 38, minWidth: 48, borderRadius: 11, borderWidth: 1, borderColor: '#3d444d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11 },
  chipCompact: { minWidth: 38, minHeight: 36, paddingHorizontal: 8 },
  chipActive: { backgroundColor: '#238636', borderColor: '#3fb950' },
  chipText: { color: '#c9d1d9', fontSize: 10, fontWeight: '900' },
  chipTextActive: { color: '#ffffff' },
  styleGrid: { flexDirection: 'row', gap: 7 },
  styleCard: { flex: 1, minHeight: 72, borderRadius: 13, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', padding: 10, justifyContent: 'center' },
  styleCardActive: { borderColor: '#2ea043', backgroundColor: '#14251a' },
  styleLabel: { color: '#c9d1d9', fontSize: 12, fontWeight: '900' },
  styleLabelActive: { color: '#7ee787' },
  styleDetail: { color: '#8b949e', fontSize: 8, lineHeight: 13, marginTop: 4 },
  settingsGrid: { flexDirection: 'row', gap: 8, marginTop: 4 },
  stepper: { flex: 1, minWidth: 96 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepperValue: { flex: 1, color: '#ffffff', fontSize: 18, fontWeight: '900', textAlign: 'center', minWidth: 38 },
  actionRow: { flexDirection: 'row', gap: 7, marginTop: 16 },
  primaryButton: { flex: 1.35, minHeight: 48, borderRadius: 13, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  secondaryButton: { flex: 0.75, minHeight: 48, borderRadius: 13, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#6e7681', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  summaryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#14251a', borderWidth: 1, borderColor: '#2ea043', borderRadius: 17, padding: 14, marginTop: 12 },
  summaryText: { flex: 1, paddingRight: 8 },
  summaryTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  summaryMeta: { color: '#aff5b4', fontSize: 9, lineHeight: 14, marginTop: 4 },
  versionBadge: { borderRadius: 10, backgroundColor: '#238636', paddingHorizontal: 9, paddingVertical: 7 },
  versionText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  editorHeader: { flexDirection: 'row', alignItems: 'center' },
  selectedBarTitle: { color: '#ffffff', fontSize: 24, fontWeight: '900', marginTop: 4 },
  selectedSection: { marginLeft: 'auto', color: '#79c0ff', fontSize: 11, fontWeight: '900', backgroundColor: '#111d2f', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  patternRow: { flexDirection: 'row', gap: 8 },
  patternCard: { flex: 1, minHeight: 76, borderRadius: 13, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', padding: 10 },
  patternCardActive: { borderColor: '#f2cc60', backgroundColor: '#282108' },
  patternName: { color: '#f2cc60', fontSize: 12, fontWeight: '900' },
  patternNotation: { color: '#f0f6fc', fontSize: 10, lineHeight: 16, marginTop: 7 },
  barActionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 15 },
  barGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  barCard: { width: '48.6%', minHeight: 142, borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', padding: 11 },
  barCardSelected: { borderColor: '#58a6ff', borderWidth: 2, backgroundColor: '#111d2f' },
  barTopRow: { flexDirection: 'row', alignItems: 'center' },
  barNumber: { color: '#79c0ff', fontSize: 10, fontWeight: '900' },
  barSection: { color: '#8b949e', fontSize: 8, fontWeight: '800', marginLeft: 'auto' },
  barChord: { color: '#ffffff', fontSize: 29, fontWeight: '900', marginTop: 7 },
  barSounding: { color: '#7ee787', fontSize: 9, fontWeight: '800', marginTop: 2 },
  barPattern: { color: '#f2cc60', fontSize: 9, fontWeight: '900', marginTop: 8 },
  barNotation: { color: '#b1bac4', fontSize: 9, lineHeight: 14, marginTop: 4 },
  openPlayButton: { minHeight: 50, borderRadius: 14, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center', marginTop: 14, paddingHorizontal: 12 },
  openPlayText: { color: '#ffffff', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  projectRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#30363d', paddingVertical: 11, marginTop: 7 },
  projectMain: { flex: 1, paddingRight: 8 },
  projectTitle: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  projectMeta: { color: '#8b949e', fontSize: 9, lineHeight: 14, marginTop: 4 },
  deleteButton: { minWidth: 54, minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: '#f85149', alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#ff7b72', fontSize: 9, fontWeight: '900' },
  playHero: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#58a6ff', borderRadius: 22, padding: 17, marginTop: 12 },
  playTopRow: { flexDirection: 'row', alignItems: 'center' },
  playSongTitle: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  playMeta: { color: '#b6d8ff', fontSize: 9, marginTop: 4 },
  playStateBadge: { marginLeft: 'auto', borderRadius: 10, backgroundColor: '#30363d', paddingHorizontal: 10, paddingVertical: 7 },
  playStateBadgeRunning: { backgroundColor: '#238636' },
  playStateText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  playPosition: { color: '#79c0ff', fontSize: 15, fontWeight: '900', textAlign: 'center', marginTop: 19 },
  giantChord: { color: '#ffffff', fontSize: 72, lineHeight: 82, fontWeight: '900', textAlign: 'center', marginTop: 2 },
  soundingChord: { color: '#7ee787', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  nextChordRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 15, backgroundColor: '#0d1117', padding: 12, marginTop: 17 },
  nextChordLabel: { color: '#8b949e', fontSize: 10, fontWeight: '900' },
  nextChordValue: { color: '#f2cc60', fontSize: 32, fontWeight: '900', marginLeft: 12 },
  nextChordSection: { color: '#b1bac4', fontSize: 10, fontWeight: '800', marginLeft: 'auto' },
  cueCard: { borderRadius: 18, borderWidth: 1, borderColor: '#9e6a03', backgroundColor: '#282108', padding: 15, marginTop: 12 },
  cueLabel: { color: '#f2cc60', fontSize: 9, fontWeight: '900' },
  cueMain: { color: '#ffffff', fontSize: 25, fontWeight: '900', marginTop: 5 },
  cueDetail: { color: '#fff3bf', fontSize: 11, lineHeight: 18, marginTop: 6 },
  eventGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11 },
  eventCell: { flexGrow: 1, flexBasis: '22%', minHeight: 70, borderRadius: 12, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center' },
  eventCellActive: { backgroundColor: '#1f6feb', borderColor: '#79c0ff' },
  eventPosition: { color: '#8b949e', fontSize: 9, fontWeight: '900' },
  eventLabel: { color: '#ffffff', fontSize: 17, fontWeight: '900', marginTop: 4 },
  eventTextActive: { color: '#ffffff' },
  playNavigation: { flexDirection: 'row', gap: 8, marginTop: 13 },
  navButton: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  navButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  timeline: { gap: 7, paddingTop: 11, paddingRight: 12 },
  timelineBar: { width: 88, minHeight: 91, borderRadius: 13, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', padding: 9 },
  timelineBarLoop: { borderColor: '#9e6a03' },
  timelineBarCurrent: { borderColor: '#58a6ff', borderWidth: 2, backgroundColor: '#111d2f' },
  timelineNumber: { color: '#8b949e', fontSize: 8, fontWeight: '900' },
  timelineChord: { color: '#ffffff', fontSize: 25, fontWeight: '900', marginTop: 5 },
  timelineSection: { color: '#b1bac4', fontSize: 8, marginTop: 5 },
  loopGrid: { flexDirection: 'row', gap: 10, marginTop: 3 },
  playButton: { minHeight: 56, borderRadius: 15, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', marginTop: 17 },
  stopButton: { backgroundColor: '#da3633' },
  playButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  backToEditButton: { minHeight: 45, borderRadius: 12, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  backToEditText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  emptyCard: { borderRadius: 18, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 20, marginTop: 12, alignItems: 'center' },
  emptyTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  emptyText: { color: '#8b949e', fontSize: 10, lineHeight: 17, textAlign: 'center', marginVertical: 10 },
  statusCard: { borderRadius: 13, backgroundColor: '#14251a', borderWidth: 1, borderColor: '#2ea043', padding: 12, marginTop: 12 },
  statusText: { color: '#aff5b4', fontSize: 10, lineHeight: 16, fontWeight: '700' },
  errorCard: { borderRadius: 13, backgroundColor: '#2d1518', borderWidth: 1, borderColor: '#f85149', padding: 12, marginTop: 8 },
  errorText: { color: '#ffb3ad', fontSize: 10, lineHeight: 16, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.76 },
});
