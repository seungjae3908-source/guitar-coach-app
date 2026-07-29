import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import { recommendTrainingSongs } from '../config/mastery-song-catalog';
import {
  buildMasteryProfile,
  buildTodayLesson,
  type MasterySkill,
} from '../services/mastery-skill-engine';
import { saveSelectedTrainingSongId } from '../services/mastery-selection-store';
import {
  loadPracticeSessions,
  type PracticeSessionRecord,
} from '../services/practice-session-store';

function SkillCard({ skill }: { skill: MasterySkill }) {
  const measured = skill.score != null;
  return (
    <View style={[styles.skillCard, !measured && styles.skillCardUnmeasured]}>
      <View style={styles.skillTopRow}>
        <View style={styles.skillTitleWrap}>
          <Text style={styles.skillTitle}>{skill.title}</Text>
          <Text style={styles.skillGrade}>{skill.gradeLabel}</Text>
        </View>
        <Text style={styles.skillScore}>{measured ? `${skill.score}` : '-'}</Text>
      </View>
      <View style={styles.skillMetricRow}>
        <Text style={styles.skillMetric}>신뢰 표본 {skill.reliableSessions}회</Text>
        <Text style={styles.skillMetric}>신뢰도 {skill.confidencePercent}%</Text>
        <Text style={styles.skillMetric}>현재 {skill.currentBpm ?? '-'} BPM</Text>
      </View>
      <Text style={styles.skillFocus}>{skill.nextFocus}</Text>
    </View>
  );
}

export default function MasteryAcademyPanel({
  mode,
  onOpenSession,
  onOpenSong,
  onOpenTone,
}: {
  mode: GuitarModeId;
  onOpenSession: () => void;
  onOpenSong: () => void;
  onOpenTone: () => void;
}) {
  const [sessions, setSessions] = useState<PracticeSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadPracticeSessions()
      .then((items) => {
        if (!cancelled) setSessions(items);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '연습 기록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const profile = useMemo(() => buildMasteryProfile(sessions, mode), [mode, sessions]);
  const lesson = useMemo(() => buildTodayLesson(profile), [profile]);
  const recommendations = useMemo(() => recommendTrainingSongs(profile, 4), [profile]);

  const openSong = async (songId: string) => {
    try {
      await saveSelectedTrainingSongId(songId);
      onOpenSong();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '추천곡을 선택하지 못했습니다.');
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>MASTER & DISCIPLE TRAINING SYSTEM</Text>
      <Text style={styles.title}>{mode === 'acoustic' ? '통기타' : '일렉기타'} 수제자 훈련실</Text>
      <Text style={styles.subtitle}>기록이 없는 기술은 초급으로 추측하지 않고 미측정으로 둡니다. 신뢰 가능한 카메라·마이크 표본이 쌓일 때만 수준과 다음 과제를 결정합니다.</Text>

      <View style={styles.heroCard}>
        <View style={styles.heroMain}>
          <Text style={styles.heroLabel}>현재 종합 수준</Text>
          <Text style={styles.heroGrade}>{profile.overallLabel}</Text>
          <Text style={styles.heroDetail}>
            {profile.overallScore == null
              ? `정확한 종합 등급에는 최소 3개 기술 진단이 필요합니다.`
              : `종합 ${profile.overallScore}점 · 신뢰 표본 ${profile.reliableSessionCount}회`}
          </Text>
        </View>
        <View style={styles.heroScoreBox}>
          <Text style={styles.heroScore}>{profile.overallScore ?? '-'}</Text>
          <Text style={styles.heroScoreLabel}>MASTER SCORE</Text>
        </View>
      </View>

      {loading ? <ActivityIndicator style={styles.loader} /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.lessonCard}>
        <Text style={styles.sectionEyebrow}>TODAY'S PRIVATE LESSON</Text>
        <Text style={styles.lessonTitle}>{lesson.title}</Text>
        <Text style={styles.lessonReason}>{lesson.reason}</Text>
        <View style={styles.lessonMetaRow}>
          <Text style={styles.lessonMeta}>{lesson.totalMinutes}분 수업</Text>
          <Text style={styles.lessonMeta}>{lesson.startBpm}→{lesson.targetBpm} BPM</Text>
          <Text style={styles.lessonMeta}>{profile.priority?.sampleStatus === 'unmeasured' ? '진단 우선' : '약점 우선'}</Text>
        </View>
        {lesson.stages.map((stage, index) => (
          <View key={stage.id} style={styles.stageRow}>
            <View style={styles.stageNumber}><Text style={styles.stageNumberText}>{index + 1}</Text></View>
            <View style={styles.stageTextWrap}>
              <Text style={styles.stageTitle}>{stage.title} · {stage.minutes}분</Text>
              <Text style={styles.stageInstruction}>{stage.instruction}</Text>
            </View>
          </View>
        ))}
        <Pressable onPress={onOpenSession} style={styles.primaryButton}>
          <Text style={styles.primaryText}>오늘 수업 집중연습 시작</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>기술별 정밀 수준</Text>
      <Text style={styles.sectionSubtitle}>점수는 자세·손 동작·박자·실수·BPM을 함께 보고, 신뢰도 65% 미만 세션은 수준 계산에서 제외합니다.</Text>
      {profile.skills.map((skill) => <SkillCard key={skill.category} skill={skill} />)}

      <Text style={styles.sectionTitle}>현재 수준에 맞는 재미있는 연습곡</Text>
      <Text style={styles.sectionSubtitle}>원곡 악보를 꾸며내지 않고, 곡에서 훈련할 기술·구간·코칭 포인트를 제공합니다. 유튜브 URL을 연결하면 실제 재생 시간에 맞춰 연습 지도가 이동합니다.</Text>
      {recommendations.map(({ song, reason }, index) => (
        <View key={song.id} style={styles.songCard}>
          <View style={styles.songRank}><Text style={styles.songRankText}>{index + 1}</Text></View>
          <View style={styles.songTextWrap}>
            <Text style={styles.songTitle}>{song.title}</Text>
            <Text style={styles.songArtist}>{song.artist} · {song.baseBpm} BPM · {song.level}</Text>
            <Text style={styles.songReason}>{reason}</Text>
            <Text style={styles.songWhy}>{song.whyItHelps}</Text>
          </View>
          <Pressable onPress={() => void openSong(song.id)} style={styles.songButton}>
            <Text style={styles.songButtonText}>연습</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.flowCard}>
        <Text style={styles.flowTitle}>수제자 성장 흐름</Text>
        <Text style={styles.flowText}>진단 → 오늘 수업 → 실시간 교정 → 추천곡 적용 → 세션 비교 → 다음 BPM·숙제 자동 배정</Text>
        <View style={styles.flowButtons}>
          <Pressable onPress={onOpenSong} style={styles.secondaryButton}><Text style={styles.secondaryText}>곡 스튜디오</Text></Pressable>
          <Pressable onPress={onOpenTone} style={styles.secondaryButton}><Text style={styles.secondaryText}>톤 연구실</Text></Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 13, paddingBottom: 90 },
  eyebrow: { color: '#f2cc60', fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  title: { color: '#ffffff', fontSize: 23, fontWeight: '900', marginTop: 4 },
  subtitle: { color: '#8b949e', fontSize: 10, lineHeight: 16, marginTop: 6 },
  heroCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 20, padding: 15, marginTop: 13 },
  heroMain: { flex: 1, paddingRight: 10 },
  heroLabel: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  heroGrade: { color: '#ffffff', fontSize: 20, fontWeight: '900', marginTop: 4 },
  heroDetail: { color: '#b6d8ff', fontSize: 8, lineHeight: 13, marginTop: 4 },
  heroScoreBox: { minWidth: 78, alignItems: 'center', borderRadius: 16, backgroundColor: '#0d1117', paddingVertical: 12, paddingHorizontal: 9 },
  heroScore: { color: '#7ee787', fontSize: 30, fontWeight: '900' },
  heroScoreLabel: { color: '#6e7681', fontSize: 6, fontWeight: '900', marginTop: 3 },
  loader: { marginTop: 12 },
  errorText: { color: '#ff7b72', fontSize: 9, lineHeight: 14, marginTop: 8 },
  lessonCard: { backgroundColor: '#182118', borderWidth: 1, borderColor: '#2ea043', borderRadius: 19, padding: 14, marginTop: 12 },
  sectionEyebrow: { color: '#7ee787', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  lessonTitle: { color: '#ffffff', fontSize: 17, fontWeight: '900', marginTop: 4 },
  lessonReason: { color: '#b9e6c5', fontSize: 9, lineHeight: 15, marginTop: 5 },
  lessonMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 9 },
  lessonMeta: { color: '#7ee787', backgroundColor: '#102418', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 5, fontSize: 7, fontWeight: '900' },
  stageRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  stageNumber: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  stageNumberText: { color: '#ffffff', fontSize: 8, fontWeight: '900' },
  stageTextWrap: { flex: 1 },
  stageTitle: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  stageInstruction: { color: '#8fb99a', fontSize: 8, lineHeight: 13, marginTop: 2 },
  primaryButton: { minHeight: 46, borderRadius: 13, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  primaryText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  sectionTitle: { color: '#f0f6fc', fontSize: 15, fontWeight: '900', marginTop: 18 },
  sectionSubtitle: { color: '#8b949e', fontSize: 8, lineHeight: 13, marginTop: 4, marginBottom: 8 },
  skillCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 15, padding: 11, marginBottom: 7 },
  skillCardUnmeasured: { borderColor: '#9e6a03', backgroundColor: '#211c10' },
  skillTopRow: { flexDirection: 'row', alignItems: 'center' },
  skillTitleWrap: { flex: 1 },
  skillTitle: { color: '#f0f6fc', fontSize: 11, fontWeight: '900' },
  skillGrade: { color: '#79c0ff', fontSize: 7, fontWeight: '800', marginTop: 2 },
  skillScore: { color: '#7ee787', fontSize: 22, fontWeight: '900' },
  skillMetricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  skillMetric: { color: '#8b949e', backgroundColor: '#0d1117', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, fontSize: 6 },
  skillFocus: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 7 },
  songCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 11, marginBottom: 8 },
  songRank: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  songRankText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  songTextWrap: { flex: 1, paddingRight: 6 },
  songTitle: { color: '#f0f6fc', fontSize: 11, fontWeight: '900' },
  songArtist: { color: '#79c0ff', fontSize: 7, marginTop: 2 },
  songReason: { color: '#b1bac4', fontSize: 8, lineHeight: 12, marginTop: 5 },
  songWhy: { color: '#6e7681', fontSize: 7, lineHeight: 11, marginTop: 3 },
  songButton: { minWidth: 45, height: 35, borderRadius: 10, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center' },
  songButtonText: { color: '#ffffff', fontSize: 8, fontWeight: '900' },
  flowCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 17, padding: 13, marginTop: 11 },
  flowTitle: { color: '#79c0ff', fontSize: 12, fontWeight: '900' },
  flowText: { color: '#b6d8ff', fontSize: 9, lineHeight: 15, marginTop: 5 },
  flowButtons: { flexDirection: 'row', gap: 7, marginTop: 10 },
  secondaryButton: { flex: 1, minHeight: 40, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
});
