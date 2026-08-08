import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import type { PracticePreset } from '../config/personal-practice-presets';
import { getSongChordGuide } from '../config/song-chord-guides';
import {
  getTrainingSong,
  MASTERY_SONG_CATALOG,
  type TrainingSong,
  type TrainingSongSection,
} from '../config/mastery-song-catalog';
import {
  isCoachSpeechAvailable,
  prepareCoachSpeechAsync,
  speakCoachPhraseAsync,
  stopCoachSpeechAsync,
} from '../modules/guitar-coach-speech';
import { loadSelectedTrainingSongId, saveSelectedTrainingSongId } from '../services/mastery-selection-store';
import LiveTeacherPanel from './LiveTeacherPanel';
import SessionCoachCamera from './SessionCoachCamera';
import YouTubePracticePlayer, { type YouTubePlayerState, type YouTubeSeekRequest } from './YouTubePracticePlayer';
import YouTubeSearchPicker from './YouTubeSearchPicker';
import { normalizeYouTubeUrl } from '../services/youtube-url';
import { clearLiveCoachFeedback } from '../services/live-coach-feedback';
import { clearLivePracticeContext, setLivePracticeContext } from '../services/practice-session-context';

const STORAGE_KEY = 'guitar-coach:master-song-studio:v1';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;

type StoredSongStudio = Record<string, {
  youtubeUrl: string;
  syncOffsetSeconds: number;
  capo?: number;
  updatedAt: string;
}>;

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function sectionTimes(section: TrainingSongSection, duration: number, offset: number) {
  if (duration <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, duration * section.startRatio + offset);
  const end = Math.max(start + 1, Math.min(duration, duration * section.endRatio + offset));
  return { start, end };
}

function parseStored(raw: string | null): StoredSongStudio {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as StoredSongStudio : {};
  } catch {
    return {};
  }
}

export default function MasterSongStudioPanel({
  mode,
  voiceEnabled,
}: {
  mode: GuitarModeId;
  voiceEnabled: boolean;
}) {
  const songs = useMemo(() => MASTERY_SONG_CATALOG.filter((song) => song.guitarMode === mode), [mode]);
  const [songId, setSongId] = useState(songs[0]?.id ?? '');
  const song = getTrainingSong(songId) ?? songs[0] ?? null;
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [appliedYoutubeUrl, setAppliedYoutubeUrl] = useState('');
  const [youtubeSearchVisible, setYoutubeSearchVisible] = useState(false);
  const [seekRequest, setSeekRequest] = useState<YouTubeSeekRequest | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerState, setPlayerState] = useState<YouTubePlayerState>('unstarted');
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [syncOffsetSeconds, setSyncOffsetSeconds] = useState(0);
  const [capo, setCapo] = useState(0);
  const [manualChordIndex, setManualChordIndex] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopSectionId, setLoopSectionId] = useState('');
  const [sectionVoiceEnabled, setSectionVoiceEnabled] = useState(true);
  const [status, setStatus] = useState('추천곡을 고르고 YouTube 공유 URL을 붙여넣으세요.');
  const [error, setError] = useState('');
  const [coachRunning, setCoachRunning] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const sectionYRef = useRef(new Map<string, number>());
  const lastSpokenSectionRef = useRef('');
  const loadingSongRef = useRef(false);
  const lastSpokenChordRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    loadingSongRef.current = true;
    void Promise.all([
      loadSelectedTrainingSongId(),
      AsyncStorage.getItem(STORAGE_KEY),
    ]).then(([selectedId, raw]) => {
      if (cancelled) return;
      const selected = getTrainingSong(selectedId);
      const nextSong = selected?.guitarMode === mode ? selected : songs[0] ?? null;
      if (!nextSong) return;
      setSongId(nextSong.id);
      const stored = parseStored(raw)[nextSong.id];
      const loadedUrl = normalizeYouTubeUrl(stored?.youtubeUrl ?? '') ?? '';
      setYoutubeUrl(loadedUrl);
      setAppliedYoutubeUrl(loadedUrl);
      setSyncOffsetSeconds(stored?.syncOffsetSeconds ?? 0);
      setCapo(stored?.capo ?? getSongChordGuide(nextSong.id, nextSong.sections[0]?.id ?? 'verse', mode).defaultCapo);
      setLoopSectionId(nextSong.sections[0]?.id ?? '');
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : '곡 스튜디오 설정을 불러오지 못했습니다.');
    }).finally(() => {
      loadingSongRef.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [mode, songs]);

  useEffect(() => {
    setDuration(0);
    setCurrentTime(0);
    setPlayerState('unstarted');
    setAppliedYoutubeUrl('');
    setSeekRequest(null);
    setLoopEnabled(false);
    setManualChordIndex(0);
    setLoopSectionId(song?.sections[0]?.id ?? '');
    lastSpokenSectionRef.current = '';
    if (!song || loadingSongRef.current) return;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        const stored = parseStored(raw)[song.id];
        const loadedUrl = normalizeYouTubeUrl(stored?.youtubeUrl ?? '') ?? '';
        setYoutubeUrl(loadedUrl);
        setAppliedYoutubeUrl(loadedUrl);
        setSyncOffsetSeconds(stored?.syncOffsetSeconds ?? 0);
        setCapo(stored?.capo ?? getSongChordGuide(song.id, song.sections[0]?.id ?? 'verse', mode).defaultCapo);
      })
      .catch(() => undefined);
  }, [song?.id]);

  useEffect(() => () => {
    void stopCoachSpeechAsync();
  }, []);


  const timeline = useMemo(() => song?.sections.map((section) => ({
    section,
    ...sectionTimes(section, duration, syncOffsetSeconds),
  })) ?? [], [duration, song, syncOffsetSeconds]);

  const activeIndex = useMemo(() => {
    if (!timeline.length) return 0;
    const found = timeline.findIndex((item, index) => currentTime >= item.start && (
      currentTime < item.end || index === timeline.length - 1
    ));
    return found >= 0 ? found : 0;
  }, [currentTime, timeline]);
  const active = timeline[activeIndex] ?? null;
  const next = timeline[Math.min(timeline.length - 1, activeIndex + 1)] ?? null;
  const loop = timeline.find((item) => item.section.id === loopSectionId) ?? active;
  const activeSectionId = active?.section.id ?? song?.sections[0]?.id ?? 'intro';
  const chordGuide = useMemo(
    () => getSongChordGuide(song?.id ?? '', activeSectionId, mode, capo),
    [activeSectionId, capo, mode, song?.id],
  );
  const safeChordIndex = chordGuide.chords.length
    ? Math.max(0, Math.min(chordGuide.chords.length - 1, manualChordIndex))
    : 0;
  const chordState = {
    index: safeChordIndex,
    current: chordGuide.chords[safeChordIndex] ?? '-',
    next: chordGuide.chords[(safeChordIndex + 1) % Math.max(1, chordGuide.chords.length)] ?? '-',
  };
  const soundingChordState = {
    index: safeChordIndex,
    current: chordGuide.soundingChords[safeChordIndex] ?? '-',
    next: chordGuide.soundingChords[(safeChordIndex + 1) % Math.max(1, chordGuide.soundingChords.length)] ?? '-',
  };

  useEffect(() => {
    setManualChordIndex(0);
    lastSpokenChordRef.current = '';
  }, [activeSectionId, song?.id]);
  const studioPreset = useMemo<PracticePreset | null>(() => {
    if (!song || !active) return null;
    const category = song.targetCategories.includes('strumming')
      ? 'strumming'
      : song.targetCategories[0] ?? 'chords';
    return {
      id: `song-studio:${song.id}:${active.section.id}`,
      guitarMode: mode,
      category,
      title: `${song.title} · ${active.section.label} 실시간 코치`,
      goal: active.section.coachCue,
      startBpm: song.baseBpm,
      targetBpm: song.baseBpm,
      durationSeconds: 600,
      pattern: chordGuide.chords.join(' → '),
      cameraFocus: 'full-body',
      checkpoints: [
        '머리·양쪽 어깨·팔꿈치·손목·골반이 모두 보이는지',
        active.section.rightHand,
        active.section.leftHand,
        `현재 코드 진행 ${chordGuide.chords.join(' → ')}`,
      ],
      automaticFeedbackRules: [
        '자세 관절이 부족하면 판정 불가',
        '어깨 기울기·상체 쏠림·머리 위치·몸 흔들림을 구체적으로 지적',
        '문제가 없을 때만 잘한 점을 표시',
      ],
    };
  }, [active, chordGuide.chords, mode, song]);

  useEffect(() => {
    if (!coachRunning || !studioPreset) {
      clearLivePracticeContext();
      return;
    }
    clearLiveCoachFeedback();
    setLivePracticeContext({
      active: true,
      guitarMode: studioPreset.guitarMode,
      presetId: studioPreset.id,
      title: studioPreset.title,
      goal: studioPreset.goal,
      pattern: studioPreset.pattern,
      category: studioPreset.category,
      cameraFocus: studioPreset.cameraFocus,
      bpm: studioPreset.startBpm,
      targetBpm: studioPreset.targetBpm,
      pulsesPerBeat: 2,
      microphoneEnabled: false,
      calibrationConfidencePercent: null,
      startedAt: Date.now(),
    });
    return () => {
      clearLivePracticeContext();
      clearLiveCoachFeedback();
    };
  }, [coachRunning, studioPreset]);

  useEffect(() => {
    const id = active?.section.id;
    if (!id) return;
    const y = sectionYRef.current.get(id);
    if (typeof y === 'number') {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 190), animated: true });
    }
  }, [active?.section.id]);

  useEffect(() => {
    if (!voiceEnabled || !sectionVoiceEnabled || playerState !== 'playing' || !active?.section) return;
    if (lastSpokenSectionRef.current === active.section.id) return;
    lastSpokenSectionRef.current = active.section.id;
    if (!isCoachSpeechAvailable) return;
    void prepareCoachSpeechAsync()
      .then(() => speakCoachPhraseAsync(
        `${active.section.label}. ${active.section.technique}. ${active.section.coachCue}`,
        { interrupt: false, speechRate: 1.03 },
      ))
      .catch(() => undefined);
  }, [active?.section, playerState, sectionVoiceEnabled, voiceEnabled]);

  useEffect(() => {
    if (!coachRunning || !voiceEnabled || !sectionVoiceEnabled || playerState !== 'playing') return;
    const key = `${activeSectionId}:${chordState.index}`;
    if (lastSpokenChordRef.current === key) return;
    lastSpokenChordRef.current = key;
    if (!isCoachSpeechAvailable) return;
    void prepareCoachSpeechAsync()
      .then(() => speakCoachPhraseAsync(
        `현재 실제 울림 ${soundingChordState.current}, 카포 연주 폼 ${chordState.current}. 다음 울림 ${soundingChordState.next}입니다.`,
        { interrupt: false, speechRate: 1.02 },
      ))
      .catch(() => undefined);
  }, [activeSectionId, chordState.current, chordState.index, chordState.next, coachRunning, playerState, sectionVoiceEnabled, soundingChordState.current, voiceEnabled]);

  const selectSong = async (nextSong: TrainingSong) => {
    setError('');
    try {
      await saveSelectedTrainingSongId(nextSong.id);
      setSongId(nextSong.id);
      setStatus(`${nextSong.title} 연습 지도를 불러왔습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '곡을 선택하지 못했습니다.');
    }
  };

  const persistStudio = async (canonicalUrl: string) => {
    if (!song) return;
    const current = parseStored(await AsyncStorage.getItem(STORAGE_KEY));
    current[song.id] = {
      youtubeUrl: canonicalUrl,
      syncOffsetSeconds,
      capo,
      updatedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  };

  const applyYoutubeUrl = async (candidate = youtubeUrl) => {
    if (!song) return;
    setError('');
    const canonicalUrl = normalizeYouTubeUrl(candidate);
    if (!canonicalUrl) {
      setAppliedYoutubeUrl('');
      setError('유효한 YouTube 영상 링크가 아닙니다. 앱 안에서 검색해 영상을 선택하거나 공유 URL을 다시 붙여넣으세요.');
      return;
    }
    try {
      setYoutubeUrl(canonicalUrl);
      setAppliedYoutubeUrl(canonicalUrl);
      await persistStudio(canonicalUrl);
      setStatus('영상 링크를 정규화해 자동 입력·저장하고 재생 준비를 시작했습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '영상 링크를 저장하지 못했습니다.');
    }
  };

  const saveStudio = async () => {
    await applyYoutubeUrl(youtubeUrl);
  };

  const selectYouTubeVideo = (canonicalUrl: string) => {
    setYoutubeSearchVisible(false);
    setYoutubeUrl(canonicalUrl);
    setAppliedYoutubeUrl(canonicalUrl);
    setError('');
    void persistStudio(canonicalUrl)
      .then(() => setStatus('검색에서 선택한 영상을 자동 입력·저장했습니다.'))
      .catch((caught) => setError(caught instanceof Error ? caught.message : '선택한 영상을 저장하지 못했습니다.'));
  };

  const openSearch = () => {
    setError('');
    setYoutubeSearchVisible(true);
  };

  const seekBy = (deltaSeconds: number) => {
    const unclamped = currentTime + deltaSeconds;
    const target = Math.max(0, duration > 0 ? Math.min(duration, unclamped) : unclamped);
    setSeekRequest({ seconds: target, nonce: Date.now() });
    setCurrentTime(target);
  };

  const alignSectionStart = () => {
    if (!active || duration <= 0) return;
    const nextOffset = Math.round((currentTime - duration * active.section.startRatio) * 10) / 10;
    setSyncOffsetSeconds(nextOffset);
    setStatus(`${active.section.label} 시작을 현재 ${formatTime(currentTime)} 위치에 맞췄습니다.`);
  };

  if (!song) {
    return <View style={styles.center}><Text style={styles.errorText}>현재 모드에 등록된 연습곡이 없습니다.</Text></View>;
  }

  return (
    <ScrollView ref={scrollRef} style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>YOUTUBE SYNC MASTER SONG STUDIO</Text>
      <Text style={styles.title}>음악과 함께 움직이는 정밀 연습 악보</Text>
      <Text style={styles.subtitle}>YouTube의 실제 재생 시간으로 연습 구간을 강조합니다. 코드 초 단위 타이밍은 추측하지 않으며, 검증된 구간 진행을 코드 칩이나 이전·다음 버튼으로 직접 맞춥니다.</Text>

      <Text style={styles.sectionTitle}>연습곡 선택</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.songRow}>
        {songs.map((item) => (
          <Pressable key={item.id} onPress={() => void selectSong(item)} style={[styles.songChip, item.id === song.id && styles.songChipActive]}>
            <Text style={[styles.songChipTitle, item.id === song.id && styles.songChipTitleActive]}>{item.title}</Text>
            <Text style={styles.songChipMeta}>{item.level} · {item.baseBpm} BPM</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.songHeaderCard}>
        <View style={styles.songHeaderText}>
          <Text style={styles.songTitle}>{song.title}</Text>
          <Text style={styles.songArtist}>{song.artist} · 추천 {song.baseBpm} BPM</Text>
          <Text style={styles.songWhy}>{song.whyItHelps}</Text>
        </View>
        <View style={styles.levelBadge}><Text style={styles.levelText}>{song.level}</Text></View>
      </View>

      <View style={styles.chordCoachCard}>
        <View style={styles.chordTopRow}>
<View style={styles.currentChordWrap}>
  <Text style={styles.chordLabel}>현재 실제 울림</Text>
  <Text style={styles.currentChord}>{soundingChordState.current}</Text>
  <Text style={styles.chordLabel}>카포 {capo} · 연주 폼 {chordState.current}</Text>
</View>
<View style={styles.nextChordWrap}>
  <Text style={styles.chordLabel}>다음 실제 울림</Text>
  <Text style={styles.nextChord}>{soundingChordState.next}</Text>
  <Text style={styles.chordLabel}>연주 폼 {chordState.next}</Text>
</View>
        </View>
        <View style={styles.chordProgressionRow}>
{chordGuide.chords.map((chord, index) => (
  <Pressable
    key={`${activeSectionId}-${chord}-${index}`}
    onPress={() => setManualChordIndex(index)}
    style={[styles.chordChip, index === chordState.index && styles.chordChipActive]}
  >
    <Text style={[styles.chordChipText, index === chordState.index && styles.chordChipTextActive]}>
      {chordGuide.soundingChords[index] ?? chord}{chordGuide.soundingChords[index] !== chord ? ` · 폼 ${chord}` : ''}
    </Text>
  </Pressable>
))}
        </View>
        <View style={styles.syncRow}>
          <Pressable
            onPress={() => setManualChordIndex((value) => (value - 1 + chordGuide.chords.length) % Math.max(1, chordGuide.chords.length))}
            style={styles.syncButton}
          ><Text style={styles.syncText}>이전 코드</Text></Pressable>
          <View style={styles.syncValueWrap}>
            <Text style={styles.syncLabel}>코드 수동 맞춤</Text>
            <Text style={styles.syncValue}>{chordGuide.chords.length ? `${safeChordIndex + 1}/${chordGuide.chords.length}` : '-'}</Text>
          </View>
          <Pressable
            onPress={() => setManualChordIndex((value) => (value + 1) % Math.max(1, chordGuide.chords.length))}
            style={styles.syncButton}
          ><Text style={styles.syncText}>다음 코드</Text></Pressable>
        </View>
        <Text style={styles.chordGuideNote}>자동 코드 추측 OFF · 듣고 맞는 코드 칩을 누르면 그 위치를 유지합니다.</Text>
        <View style={styles.syncRow}>
          <Pressable onPress={() => setCapo((value) => Math.max(0, value - 1))} style={styles.syncButton}><Text style={styles.syncText}>카포 -1</Text></Pressable>
          <View style={styles.syncValueWrap}><Text style={styles.syncLabel}>카포</Text><Text style={styles.syncValue}>{capo}</Text></View>
          <Pressable onPress={() => setCapo((value) => Math.min(11, value + 1))} style={styles.syncButton}><Text style={styles.syncText}>카포 +1</Text></Pressable>
        </View>
        <Text style={styles.chordGuideNote}>폼 Key {chordGuide.shapeKey} · 실제 Key {chordGuide.soundingKey} · {chordGuide.tuning}</Text>
        <Text style={styles.chordGuideNote}>스트럼 {chordGuide.strumPattern}</Text>
        <Text style={styles.chordGuideNote}>{chordGuide.note}</Text>
      </View>

      <View style={styles.urlCard}>
        <Text style={styles.label}>YouTube 공유 URL</Text>
        <TextInput
          value={youtubeUrl}
          onChangeText={(value) => {
            setYoutubeUrl(value);
            setAppliedYoutubeUrl('');
          }}
          onSubmitEditing={() => void applyYoutubeUrl()}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://youtu.be/... 또는 YouTube 공유 URL"
          placeholderTextColor="#6e7681"
          style={styles.input}
        />
        <View style={styles.buttonRow}>
          <Pressable onPress={openSearch} style={styles.secondaryButton}><Text style={styles.secondaryText}>앱 안에서 YouTube 검색</Text></Pressable>
          <Pressable onPress={() => void saveStudio()} style={styles.primarySmall}><Text style={styles.primarySmallText}>링크 적용·저장</Text></Pressable>
        </View>
      </View>

      <YouTubePracticePlayer
        url={appliedYoutubeUrl}
        playbackRate={speed}
        loopEnabled={loopEnabled}
        loopStartSeconds={loop?.start ?? 0}
        loopEndSeconds={loop?.end ?? 0}
        seekRequest={seekRequest}
        onTimeChange={setCurrentTime}
        onDurationChange={setDuration}
        onStateChange={setPlayerState}
        onError={setError}
      />

      <View style={styles.studioCoachCard}>
        <View style={styles.studioCoachHeader}>
<View style={styles.studioCoachHeaderText}>
  <Text style={styles.studioCoachEyebrow}>LIVE POSTURE & PLAYING COACH</Text>
  <Text style={styles.studioCoachTitle}>곡을 들으면서 내 자세 실시간 지적</Text>
  <Text style={styles.studioCoachGuide}>카메라에서 어깨·머리·상체·팔꿈치·손목을 읽고, 잘못된 점과 잘된 점을 근거와 함께 표시하고 음성으로 안내합니다.</Text>
</View>
<Pressable
  onPress={() => setCoachRunning((value) => !value)}
  style={[styles.coachToggle, coachRunning && styles.coachToggleActive]}
>
  <Text style={[styles.coachToggleText, coachRunning && styles.coachToggleTextActive]}>{coachRunning ? '코치 종료' : '코치 시작'}</Text>
</Pressable>
        </View>
        {coachRunning && studioPreset ? (
<>
  <SessionCoachCamera running category={studioPreset.category} cameraFocus="full-body" />
  <LiveTeacherPanel preset={studioPreset} running voiceEnabled={voiceEnabled} />
</>
        ) : (
<View style={styles.coachReadyBox}>
  <Text style={styles.coachReadyTitle}>시작하면 이렇게 지적합니다</Text>
  <Text style={styles.coachReadyText}>• 잘못됨: 어깨 들림, 머리 쏠림, 상체 기울기, 몸 흔들림</Text>
  <Text style={styles.coachReadyText}>• 잘됨: 상체 중심 안정, 어깨 균형, 자세 유지 성공</Text>
  <Text style={styles.coachReadyText}>• 근거 부족: 관절이 가려지면 점수 대신 판정 불가</Text>
</View>
        )}
      </View>

      <View style={styles.transportCard}>
        <View style={styles.timeRow}>
          <View>
            <Text style={styles.timeLabel}>현재 재생</Text>
            <Text style={styles.timeValue}>{formatTime(currentTime)} / {duration > 0 ? formatTime(duration) : '--:--'}</Text>
          </View>
          <View style={styles.stateBadge}><Text style={styles.stateText}>{playerState}</Text></View>
        </View>


        <View style={styles.seekRow}>
<Pressable disabled={!appliedYoutubeUrl} onPress={() => seekBy(-5)} style={[styles.seekButton, !appliedYoutubeUrl && styles.disabled]}>
  <Text style={styles.seekText}>-5초</Text>
</Pressable>
<Pressable disabled={!appliedYoutubeUrl} onPress={() => seekBy(5)} style={[styles.seekButton, !appliedYoutubeUrl && styles.disabled]}>
  <Text style={styles.seekText}>+5초</Text>
</Pressable>
        </View>

        <Text style={styles.label}>재생 속도</Text>
        <View style={styles.optionRow}>
          {SPEEDS.map((value) => (
            <Pressable key={value} onPress={() => setSpeed(value)} style={[styles.optionButton, speed === value && styles.optionButtonActive]}>
              <Text style={[styles.optionText, speed === value && styles.optionTextActive]}>{value.toFixed(2)}x</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>구간 변경 음성 코치</Text>
            <Text style={styles.switchDetail}>현재 구간의 기술과 핵심 교정을 음성으로 설명</Text>
          </View>
          <Switch value={sectionVoiceEnabled} onValueChange={setSectionVoiceEnabled} />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>A-B 구간 반복</Text>
            <Text style={styles.switchDetail}>{loop?.section.label ?? '현재 구간'} {formatTime(loop?.start ?? 0)}~{formatTime(loop?.end ?? 0)}</Text>
          </View>
          <Switch value={loopEnabled} onValueChange={setLoopEnabled} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.loopRow}>
          {timeline.map((item) => (
            <Pressable key={item.section.id} onPress={() => setLoopSectionId(item.section.id)} style={[styles.loopChip, loopSectionId === item.section.id && styles.loopChipActive]}>
              <Text style={[styles.loopText, loopSectionId === item.section.id && styles.loopTextActive]}>{item.section.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.syncRow}>
          <Pressable onPress={() => setSyncOffsetSeconds((value) => value - 1)} style={styles.syncButton}><Text style={styles.syncText}>-1초</Text></Pressable>
          <View style={styles.syncValueWrap}><Text style={styles.syncLabel}>악보 보정</Text><Text style={styles.syncValue}>{syncOffsetSeconds >= 0 ? '+' : ''}{syncOffsetSeconds.toFixed(1)}초</Text></View>
          <Pressable onPress={() => setSyncOffsetSeconds((value) => value + 1)} style={styles.syncButton}><Text style={styles.syncText}>+1초</Text></Pressable>
        </View>
        <Pressable disabled={duration <= 0} onPress={alignSectionStart} style={[styles.alignButton, duration <= 0 && styles.disabled]}>
          <Text style={styles.alignText}>현재 재생 위치를 ‘{active?.section.label ?? '구간'} 시작’으로 맞춤</Text>
        </Pressable>
      </View>

      <View style={styles.nowCard}>
        <Text style={styles.nowEyebrow}>NOW PLAYING LESSON</Text>
        <Text style={styles.nowTitle}>{active?.section.label ?? '재생 대기'} · {active?.section.technique ?? '-'}</Text>
        <Text style={styles.nowCue}>{active?.section.coachCue ?? 'YouTube URL을 연결하면 현재 구간 코칭이 표시됩니다.'}</Text>
        <View style={styles.nowGrid}>
          <View style={styles.nowItem}><Text style={styles.nowItemLabel}>리듬</Text><Text style={styles.nowItemText}>{active?.section.rhythm ?? '-'}</Text></View>
          <View style={styles.nowItem}><Text style={styles.nowItemLabel}>오른손</Text><Text style={styles.nowItemText}>{active?.section.rightHand ?? '-'}</Text></View>
          <View style={styles.nowItem}><Text style={styles.nowItemLabel}>왼손</Text><Text style={styles.nowItemText}>{active?.section.leftHand ?? '-'}</Text></View>
          <View style={styles.nowItem}><Text style={styles.nowItemLabel}>톤</Text><Text style={styles.nowItemText}>{active?.section.toneHint ?? '-'}</Text></View>
        </View>
        <Text style={styles.nextText}>다음 · {next?.section.label ?? '-'} / {next?.section.technique ?? '-'}</Text>
      </View>

      <Text style={styles.sectionTitle}>자동 스크롤 상세 연습 악보</Text>
      {timeline.map((item, index) => {
        const current = index === activeIndex;
        return (
          <View
            key={item.section.id}
            onLayout={(event) => sectionYRef.current.set(item.section.id, event.nativeEvent.layout.y)}
            style={[styles.sheetCard, current && styles.sheetCardCurrent]}
          >
            <View style={styles.sheetTopRow}>
              <View style={styles.sheetNumber}><Text style={styles.sheetNumberText}>{index + 1}</Text></View>
              <View style={styles.sheetTitleWrap}>
                <Text style={styles.sheetTitle}>{item.section.label} · {item.section.technique}</Text>
                <Text style={styles.sheetTime}>{duration > 0 ? `${formatTime(item.start)}~${formatTime(item.end)}` : `${Math.round(item.section.startRatio * 100)}~${Math.round(item.section.endRatio * 100)}%`}</Text>
              </View>
              {current ? <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>현재</Text></View> : null}
            </View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>리듬</Text><Text style={styles.detailText}>{item.section.rhythm}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>오른손</Text><Text style={styles.detailText}>{item.section.rightHand}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>왼손</Text><Text style={styles.detailText}>{item.section.leftHand}</Text></View>
            <View style={styles.coachBox}><Text style={styles.coachLabel}>선생님 핵심</Text><Text style={styles.coachText}>{item.section.coachCue}</Text></View>
            <Text style={styles.toneText}>톤 힌트 · {item.section.toneHint}</Text>
          </View>
        );
      })}

      <YouTubeSearchPicker
        visible={youtubeSearchVisible}
        initialQuery={song.youtubeQuery}
        onClose={() => setYoutubeSearchVisible(false)}
        onSelect={selectYouTubeVideo}
      />

      <View style={styles.statusCard}><Text style={styles.statusText}>{status}</Text></View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  center: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 20 },
  content: { padding: 12, paddingBottom: 100 },
  eyebrow: { color: '#ff7b72', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '900', marginTop: 4 },
  subtitle: { color: '#8b949e', fontSize: 9, lineHeight: 15, marginTop: 5 },
  sectionTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', marginTop: 15, marginBottom: 7 },
  songRow: { gap: 6, paddingBottom: 2 },
  songChip: { minWidth: 130, maxWidth: 170, borderRadius: 13, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 10 },
  songChipActive: { borderColor: '#2ea043', backgroundColor: '#14251a' },
  songChipTitle: { color: '#b1bac4', fontSize: 9, fontWeight: '900' },
  songChipTitleActive: { color: '#ffffff' },
  songChipMeta: { color: '#6e7681', fontSize: 7, marginTop: 3 },
  songHeaderCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 17, padding: 13, marginTop: 10 },
  songHeaderText: { flex: 1, paddingRight: 8 },
  songTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  songArtist: { color: '#79c0ff', fontSize: 8, marginTop: 3 },
  songWhy: { color: '#b6d8ff', fontSize: 8, lineHeight: 13, marginTop: 5 },
  levelBadge: { borderRadius: 10, backgroundColor: '#1f6feb', paddingHorizontal: 8, paddingVertical: 6 },
  levelText: { color: '#ffffff', fontSize: 7, fontWeight: '900' },
  urlCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 15, padding: 11, marginVertical: 10 },
  label: { color: '#b1bac4', fontSize: 8, fontWeight: '900', marginBottom: 5, marginTop: 5 },
  input: { minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', color: '#f0f6fc', paddingHorizontal: 10, fontSize: 9 },
  buttonRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  secondaryButton: { flex: 1, minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#111d2f', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  primarySmall: { flex: 1, minHeight: 38, borderRadius: 10, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  primarySmallText: { color: '#ffffff', fontSize: 8, fontWeight: '900' },
  transportCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 11, marginTop: 9 },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  timeLabel: { color: '#8b949e', fontSize: 7, fontWeight: '900' },
  timeValue: { color: '#7ee787', fontSize: 19, fontWeight: '900', marginTop: 2 },
  stateBadge: { marginLeft: 'auto', borderRadius: 9, backgroundColor: '#21262d', paddingHorizontal: 8, paddingVertical: 5 },
  stateText: { color: '#b1bac4', fontSize: 7, fontWeight: '900' },
  seekRow: { flexDirection: 'row', gap: 7, marginTop: 9, marginBottom: 4 },
  seekButton: { flex: 1, minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: '#58a6ff', backgroundColor: '#111d2f', alignItems: 'center', justifyContent: 'center' },
  seekText: { color: '#79c0ff', fontSize: 9, fontWeight: '900' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  optionButton: { minWidth: 55, minHeight: 33, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  optionButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  optionText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  optionTextActive: { color: '#ffffff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#30363d', marginTop: 9, paddingTop: 8 },
  switchTextWrap: { flex: 1, paddingRight: 8 },
  switchTitle: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  switchDetail: { color: '#8b949e', fontSize: 7, lineHeight: 11, marginTop: 2 },
  loopRow: { gap: 5, paddingTop: 8 },
  loopChip: { minHeight: 32, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  loopChipActive: { backgroundColor: '#1f6feb', borderColor: '#58a6ff' },
  loopText: { color: '#b1bac4', fontSize: 7, fontWeight: '900' },
  loopTextActive: { color: '#ffffff' },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 },
  syncButton: { width: 54, height: 34, borderRadius: 9, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center' },
  syncText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  syncValueWrap: { minWidth: 80, alignItems: 'center' },
  syncLabel: { color: '#8b949e', fontSize: 6 },
  syncValue: { color: '#f2cc60', fontSize: 13, fontWeight: '900', marginTop: 2 },
  alignButton: { minHeight: 37, borderRadius: 10, backgroundColor: '#2d2208', borderWidth: 1, borderColor: '#9e6a03', alignItems: 'center', justifyContent: 'center', marginTop: 8, paddingHorizontal: 8 },
  alignText: { color: '#f2cc60', fontSize: 8, fontWeight: '900', textAlign: 'center' },
  disabled: { opacity: 0.42 },
  nowCard: { backgroundColor: '#102418', borderWidth: 1, borderColor: '#2ea043', borderRadius: 17, padding: 13, marginTop: 10 },
  nowEyebrow: { color: '#7ee787', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  nowTitle: { color: '#ffffff', fontSize: 16, fontWeight: '900', marginTop: 4 },
  nowCue: { color: '#b9e6c5', fontSize: 10, lineHeight: 16, fontWeight: '800', marginTop: 6 },
  nowGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  nowItem: { width: '48.8%', borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.24)', padding: 8 },
  nowItemLabel: { color: '#8fb99a', fontSize: 6, fontWeight: '900' },
  nowItemText: { color: '#f0f6fc', fontSize: 8, lineHeight: 12, marginTop: 3 },
  nextText: { color: '#79c0ff', fontSize: 8, fontWeight: '800', marginTop: 9 },
  sheetCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 12, marginBottom: 8 },
  sheetCardCurrent: { borderColor: '#7ee787', backgroundColor: '#14251a' },
  sheetTopRow: { flexDirection: 'row', alignItems: 'center' },
  sheetNumber: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  sheetNumberText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  sheetTitleWrap: { flex: 1 },
  sheetTitle: { color: '#f0f6fc', fontSize: 11, fontWeight: '900' },
  sheetTime: { color: '#79c0ff', fontSize: 7, marginTop: 2 },
  currentBadge: { borderRadius: 8, backgroundColor: '#238636', paddingHorizontal: 7, paddingVertical: 4 },
  currentBadgeText: { color: '#ffffff', fontSize: 6, fontWeight: '900' },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 },
  detailLabel: { width: 45, color: '#8b949e', fontSize: 7, fontWeight: '900' },
  detailText: { flex: 1, color: '#b1bac4', fontSize: 8, lineHeight: 12 },
  coachBox: { borderRadius: 10, backgroundColor: '#251f08', borderWidth: 1, borderColor: '#9e6a03', padding: 9, marginTop: 9 },
  coachLabel: { color: '#f2cc60', fontSize: 7, fontWeight: '900' },
  coachText: { color: '#fff3bf', fontSize: 9, lineHeight: 14, fontWeight: '800', marginTop: 3 },
  toneText: { color: '#8b949e', fontSize: 7, marginTop: 7 },
  statusCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 12, padding: 9, marginTop: 10 },
  statusText: { color: '#b6d8ff', fontSize: 8, lineHeight: 13 },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 13, marginTop: 7 },
  chordCoachCard: { borderRadius: 16, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#0d1d31', padding: 13, marginTop: 12 },
  chordTopRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  currentChordWrap: { flex: 1.25, borderRadius: 13, backgroundColor: '#1f6feb', padding: 12 },
  nextChordWrap: { flex: 1, borderRadius: 13, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', padding: 12 },
  chordLabel: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  currentChord: { color: '#ffffff', fontSize: 34, lineHeight: 39, fontWeight: '900', marginTop: 3 },
  nextChord: { color: '#79c0ff', fontSize: 25, lineHeight: 31, fontWeight: '900', marginTop: 5 },
  chordProgressionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 },
  chordChip: { minWidth: 48, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', paddingHorizontal: 10, paddingVertical: 8, alignItems: 'center' },
  chordChipActive: { backgroundColor: '#238636', borderColor: '#7ee787' },
  chordChipText: { color: '#b1bac4', fontSize: 12, fontWeight: '900' },
  chordChipTextActive: { color: '#ffffff' },
  chordGuideNote: { color: '#8b949e', fontSize: 7, lineHeight: 12, marginTop: 9 },
  studioCoachCard: { borderRadius: 16, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#0d2117', padding: 10, marginTop: 12 },
  studioCoachHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 3 },
  studioCoachHeaderText: { flex: 1 },
  studioCoachEyebrow: { color: '#7ee787', fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  studioCoachTitle: { color: '#ffffff', fontSize: 15, lineHeight: 20, fontWeight: '900', marginTop: 3 },
  studioCoachGuide: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 4 },
  coachToggle: { borderRadius: 10, borderWidth: 1, borderColor: '#2ea043', paddingHorizontal: 11, paddingVertical: 9 },
  coachToggleActive: { backgroundColor: '#da3633', borderColor: '#f85149' },
  coachToggleText: { color: '#7ee787', fontSize: 9, fontWeight: '900' },
  coachToggleTextActive: { color: '#ffffff' },
  coachReadyBox: { borderRadius: 12, backgroundColor: '#161b22', padding: 11, marginTop: 10 },
  coachReadyTitle: { color: '#f0f6fc', fontSize: 10, fontWeight: '900' },
  coachReadyText: { color: '#b1bac4', fontSize: 8, lineHeight: 14, marginTop: 4 },

});
