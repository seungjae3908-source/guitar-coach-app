import * as DocumentPicker from 'expo-document-picker';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import {
  analyzeLocalAudioFileAsync,
  AudioFileAnalysisResult,
  isAudioFileAnalysisAvailable,
} from '../modules/guitar-coach-audio-file';
import { saveSongProject } from '../services/song-project-store';
import type {
  SongBar,
  SongKey,
  SongPracticeStyle,
  SongSheetDraft,
} from '../services/song-sheet-engine';

const STYLES: Array<{ id: SongPracticeStyle; label: string }> = [
  { id: 'strum', label: '스트럼 악보' },
  { id: 'arpeggio', label: '아르페지오 악보' },
  { id: 'riff', label: '리프·TAB 초안' },
];

function confidenceLabel(value: number) {
  const percent = Math.round(value * 100);
  if (percent >= 70) return `${percent}% · 높음`;
  if (percent >= 45) return `${percent}% · 보통`;
  return `${percent}% · 낮음`;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function keyForDraft(detected: string): SongKey {
  const normalized = detected.trim();
  const root = normalized.split(' ')[0] ?? 'C';
  const minor = normalized.includes('minor');
  if (minor) {
    if (root === 'E' || root === 'F' || root === 'F#' || root === 'G') return 'Em';
    if (root === 'D' || root === 'D#') return 'Dm';
    return 'Am';
  }
  if (root === 'G' || root === 'G#') return 'G';
  if (root === 'D' || root === 'D#') return 'D';
  if (root === 'A' || root === 'A#') return 'A';
  if (root === 'E' || root === 'B') return 'E';
  if (root === 'F' || root === 'F#') return 'F';
  return 'C';
}

function instruction(style: SongPracticeStyle, mode: GuitarModeId, index: number) {
  if (style === 'arpeggio') return index % 2 === 0 ? 'P-i-m-i 반복' : 'P-i-p-m 반복';
  if (style === 'riff') return mode === 'electric' ? '8분 피킹 · 필요 시 팜뮤트' : '베이스음 + 짧은 스트럼';
  return index % 2 === 0 ? 'D · D U · U D U' : 'D · D U · D U D U';
}

function analysisToDraft(input: {
  result: AudioFileAnalysisResult;
  fileName: string;
  mode: GuitarModeId;
  style: SongPracticeStyle;
}): SongSheetDraft {
  const reliable = input.result.chords.filter((segment) => segment.chord !== 'N.C.' && segment.confidence >= 0.12);
  const source = reliable.length ? reliable : input.result.chords.filter((segment) => segment.chord !== 'N.C.');
  const stride = Math.max(1, Math.ceil(source.length / 32));
  const selected = source.filter((_, index) => index % stride === 0).slice(0, 32);
  const now = new Date().toISOString();
  const bars: SongBar[] = (selected.length ? selected : [{
    startSeconds: 0,
    endSeconds: 4,
    chord: keyForDraft(input.result.key),
    confidence: 0,
  }]).map((segment, index) => ({
    id: `bar-${index + 1}`,
    chord: segment.chord,
    beats: 4,
    instruction: `${instruction(input.style, input.mode, index)} · 원음 ${formatTime(segment.startSeconds)}~${formatTime(segment.endSeconds)} · 신뢰 ${Math.round(segment.confidence * 100)}%`,
    section: index < 2 ? 'intro' : index >= Math.floor(Math.max(1, selected.length) / 2) ? 'chorus' : 'verse',
  }));
  const cleanName = input.fileName.replace(/\.[^.]+$/, '') || '로컬 음원 분석';
  return {
    id: `song-${Date.now()}`,
    guitarMode: input.mode,
    title: cleanName,
    artist: `로컬 음원 분석 · ${formatTime(input.result.durationSeconds)}`,
    key: keyForDraft(input.result.key),
    bpm: input.result.bpm > 0 ? Math.min(220, Math.max(35, Math.round(input.result.bpm))) : 80,
    beatsPerBar: 4,
    style: input.style,
    bars,
    source: 'offline-draft',
    createdAt: now,
    updatedAt: now,
  };
}

export default function AudioFileAnalysisPanel({ mode }: { mode: GuitarModeId }) {
  const [fileName, setFileName] = useState('');
  const [fileUri, setFileUri] = useState('');
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [style, setStyle] = useState<SongPracticeStyle>(mode === 'acoustic' ? 'strum' : 'riff');
  const [result, setResult] = useState<AudioFileAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState('직접 보유한 MP3·WAV·M4A 파일을 선택하세요.');
  const [error, setError] = useState('');

  const draftPreview = useMemo(() => result && fileName
    ? analysisToDraft({ result, fileName, mode, style })
    : null, [fileName, mode, result, style]);

  const chooseFile = async () => {
    setError('');
    setSaved(false);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      setFileName(asset.name);
      setFileUri(asset.uri);
      setFileSize(asset.size ?? null);
      setResult(null);
      setStatus('파일 선택 완료 · 분석 시작을 누르세요.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '음원 파일을 선택하지 못했습니다.');
    }
  };

  const analyze = async () => {
    if (!fileUri || analyzing) return;
    setAnalyzing(true);
    setSaved(false);
    setError('');
    setStatus('휴대폰에서 음원을 디코딩하고 BPM·Key·코드 후보를 계산하는 중…');
    try {
      if (!isAudioFileAnalysisAvailable) throw new Error('이 APK에는 로컬 음원 분석 모듈이 없습니다.');
      const next = await analyzeLocalAudioFileAsync(fileUri, 120);
      setResult(next);
      setStatus(`분석 완료 · ${next.chords.length}개 코드 구간 후보`);
    } catch (caught) {
      setResult(null);
      setStatus('분석 실패');
      setError(caught instanceof Error ? caught.message : '음원 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  const saveDraft = async () => {
    if (!draftPreview) return;
    setError('');
    try {
      await saveSongProject(draftPreview);
      setSaved(true);
      setStatus('분석 악보를 저장했습니다. 곡연습 메뉴에서 불러올 수 있습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '분석 악보를 저장하지 못했습니다.');
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>LOCAL AUDIO ANALYSIS</Text>
      <Text style={styles.title}>MP3·WAV 음원 분석</Text>
      <Text style={styles.subtitle}>파일은 서버에 업로드하지 않고 Android 기기에서 최대 120초를 분석합니다. 완성 음원은 여러 악기가 섞여 있어 코드와 Key는 수정 가능한 연습용 추정치입니다.</Text>

      <View style={styles.fileCard}>
        <View style={styles.fileTextWrap}>
          <Text style={styles.fileName}>{fileName || '선택된 음원 없음'}</Text>
          <Text style={styles.fileMeta}>{fileSize == null ? 'MP3 · WAV · M4A' : `${(fileSize / 1024 / 1024).toFixed(1)} MB · 최대 120초 분석`}</Text>
        </View>
        <Pressable disabled={analyzing} onPress={() => void chooseFile()} style={[styles.fileButton, analyzing && styles.disabled]}>
          <Text style={styles.fileButtonText}>파일 선택</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>변환할 연습 악보</Text>
      <View style={styles.optionRow}>
        {STYLES.map((item) => (
          <Pressable key={item.id} disabled={analyzing} onPress={() => setStyle(item.id)} style={[styles.optionButton, style === item.id && styles.optionButtonActive]}>
            <Text style={[styles.optionText, style === item.id && styles.optionTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.actionRow}>
        <Pressable disabled={!fileUri || analyzing} onPress={() => void analyze()} style={[styles.primaryButton, (!fileUri || analyzing) && styles.disabled]}>
          <Text style={styles.primaryText}>{analyzing ? '음원 분석 중…' : '로컬 분석 시작'}</Text>
        </Pressable>
        <Pressable disabled={!draftPreview || analyzing} onPress={() => void saveDraft()} style={[styles.secondaryButton, (!draftPreview || analyzing) && styles.disabled]}>
          <Text style={styles.secondaryText}>{saved ? '저장 완료' : '곡연습에 저장'}</Text>
        </Pressable>
      </View>

      {result ? (
        <>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCard}><Text style={styles.summaryValue}>{Math.round(result.bpm) || '-'}</Text><Text style={styles.summaryLabel}>BPM</Text><Text style={styles.summaryDetail}>{confidenceLabel(result.bpmConfidence)}</Text></View>
            <View style={styles.summaryCard}><Text style={styles.summaryValueSmall}>{result.key}</Text><Text style={styles.summaryLabel}>Key</Text><Text style={styles.summaryDetail}>{confidenceLabel(result.keyConfidence)}</Text></View>
            <View style={styles.summaryCard}><Text style={styles.summaryValue}>{formatTime(result.durationSeconds)}</Text><Text style={styles.summaryLabel}>분석 길이</Text><Text style={styles.summaryDetail}>{result.sourceSampleRate}Hz · {result.sourceChannels}ch</Text></View>
          </View>

          <View style={styles.noticeCard}>
            {result.notes.map((note) => <Text key={note} style={styles.noticeText}>• {note}</Text>)}
          </View>

          <Text style={styles.sectionTitle}>시간별 코드 후보</Text>
          <View style={styles.chordGrid}>
            {result.chords.slice(0, 48).map((segment, index) => (
              <View key={`${segment.startSeconds}-${index}`} style={[styles.chordCard, segment.confidence < 0.35 && styles.chordCardLow]}>
                <Text style={styles.chordTime}>{formatTime(segment.startSeconds)}~{formatTime(segment.endSeconds)}</Text>
                <Text style={styles.chordName}>{segment.chord}</Text>
                <Text style={styles.chordConfidence}>{Math.round(segment.confidence * 100)}%</Text>
              </View>
            ))}
          </View>

          {draftPreview ? (
            <View style={styles.draftCard}>
              <Text style={styles.draftTitle}>저장될 연습 악보</Text>
              <Text style={styles.draftMeta}>{draftPreview.title} · {draftPreview.key} · {draftPreview.bpm} BPM · {draftPreview.bars.length}마디</Text>
              <Text style={styles.draftText}>{draftPreview.bars.slice(0, 16).map((bar) => bar.chord).join('  |  ')}</Text>
            </View>
          ) : null}
        </>
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
  fileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 15, padding: 11, marginTop: 12 },
  fileTextWrap: { flex: 1, paddingRight: 8 },
  fileName: { color: '#f0f6fc', fontSize: 11, fontWeight: '900' },
  fileMeta: { color: '#8b949e', fontSize: 8, marginTop: 3 },
  fileButton: { minWidth: 64, height: 39, borderRadius: 10, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center' },
  fileButtonText: { color: '#ffffff', fontSize: 8, fontWeight: '900' },
  sectionTitle: { color: '#f0f6fc', fontSize: 12, fontWeight: '900', marginTop: 13, marginBottom: 7 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optionButton: { minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', justifyContent: 'center', paddingHorizontal: 11 },
  optionButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  optionText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  optionTextActive: { color: '#ffffff' },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 11 },
  primaryButton: { flex: 1.2, minHeight: 43, borderRadius: 11, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  secondaryButton: { flex: 0.9, minHeight: 43, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  summaryGrid: { flexDirection: 'row', gap: 6, marginTop: 12 },
  summaryCard: { flex: 1, minHeight: 91, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 13, padding: 9 },
  summaryValue: { color: '#7ee787', fontSize: 20, fontWeight: '900' },
  summaryValueSmall: { color: '#79c0ff', fontSize: 13, lineHeight: 19, fontWeight: '900' },
  summaryLabel: { color: '#b1bac4', fontSize: 8, fontWeight: '900', marginTop: 3 },
  summaryDetail: { color: '#6e7681', fontSize: 7, marginTop: 3 },
  noticeCard: { backgroundColor: '#2d2208', borderWidth: 1, borderColor: '#9e6a03', borderRadius: 13, padding: 9, marginTop: 8 },
  noticeText: { color: '#f2cc60', fontSize: 8, lineHeight: 13, marginVertical: 1 },
  chordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chordCard: { width: '23.5%', minHeight: 70, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#2ea043', borderRadius: 10, padding: 7 },
  chordCardLow: { borderColor: '#9e6a03', opacity: 0.78 },
  chordTime: { color: '#6e7681', fontSize: 6 },
  chordName: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', marginTop: 4 },
  chordConfidence: { color: '#8b949e', fontSize: 7, marginTop: 3 },
  draftCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 13, padding: 10, marginTop: 10 },
  draftTitle: { color: '#79c0ff', fontSize: 9, fontWeight: '900' },
  draftMeta: { color: '#b6d8ff', fontSize: 8, marginTop: 3 },
  draftText: { color: '#f0f6fc', fontSize: 10, lineHeight: 18, fontWeight: '800', marginTop: 6 },
  statusCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 12, padding: 9, marginTop: 10 },
  statusText: { color: '#b1bac4', fontSize: 8, lineHeight: 13 },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 13, marginTop: 7 },
  disabled: { opacity: 0.42 },
});
