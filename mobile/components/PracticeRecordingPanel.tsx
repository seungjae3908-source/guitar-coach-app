import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import {
  deletePracticeRecordingMetadata,
  loadPracticeRecordings,
  PracticeRecording,
  savePracticeRecording,
} from '../services/recording-store';

const MAX_DURATIONS = [60, 180, 300, 600];

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function VideoPlayback({ recording }: { recording: PracticeRecording }) {
  const player = useVideoPlayer(recording.uri, (instance) => {
    instance.loop = false;
  });

  return (
    <View style={styles.playbackCard}>
      <VideoView
        player={player}
        style={styles.videoView}
        nativeControls
        allowsFullscreen
        contentFit="contain"
        surfaceType="textureView"
      />
      <Text style={styles.playbackTitle}>{recording.filename}</Text>
      <Text style={styles.playbackMeta}>{dateLabel(recording.createdAt)} · {formatTime(recording.durationSeconds)} · {recording.facing === 'back' ? '후면' : '전면'}</Text>
      {recording.note ? <Text style={styles.playbackNote}>{recording.note}</Text> : null}
    </View>
  );
}

function DurationButton({
  value,
  active,
  disabled,
  onPress,
}: {
  value: number;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.durationButton, active && styles.durationButtonActive, disabled && styles.disabled]}>
      <Text style={[styles.durationText, active && styles.durationTextActive]}>{value / 60}분</Text>
    </Pressable>
  );
}

export default function PracticeRecordingPanel({ mode }: { mode: GuitarModeId | null }) {
  const cameraRef = useRef<CameraView | null>(null);
  const recordingStartedAtRef = useRef(0);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [maxDuration, setMaxDuration] = useState(180);
  const [note, setNote] = useState('');
  const [recordings, setRecordings] = useState<PracticeRecording[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState('카메라를 맞추고 녹화를 시작하세요. 녹화 중에는 AI 분석을 동시에 실행하지 않습니다.');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const next = await loadPracticeRecordings();
      setRecordings(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '최근 영상 목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)));
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && recording) {
        cameraRef.current?.stopRecording();
        setStatus('앱이 백그라운드로 이동해 녹화를 안전하게 종료합니다.');
      }
    });
    return () => subscription.remove();
  }, [recording]);

  useEffect(() => () => {
    if (recording) cameraRef.current?.stopRecording();
  }, [recording]);

  const requestAudioPermission = async () => {
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: '연습 영상 소리 권한',
        message: '기타 연주 소리를 영상에 함께 저장하기 위해 마이크 권한이 필요합니다.',
        buttonPositive: '허용',
        buttonNegative: '취소',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const ensureSavePermission = async () => {
    const current = await MediaLibrary.getPermissionsAsync(false);
    if (current.granted) return true;
    const requested = await MediaLibrary.requestPermissionsAsync(false);
    return requested.granted;
  };

  const finishRecordedVideo = async (video: { uri: string } | undefined, durationSeconds: number) => {
    setRecording(false);
    recordingPromiseRef.current = null;
    if (!video?.uri) {
      setStatus('녹화 결과 파일을 받지 못했습니다.');
      return;
    }
    setSaving(true);
    setStatus('연습 영상을 갤러리에 저장하는 중…');
    try {
      const asset = await MediaLibrary.createAssetAsync(video.uri);
      const albumName = 'Guitar Coach AI';
      const album = await MediaLibrary.getAlbumAsync(albumName);
      if (album) {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } else {
        await MediaLibrary.createAlbumAsync(albumName, asset, false);
      }
      const createdAt = new Date().toISOString();
      const record: PracticeRecording = {
        id: `recording-${Date.now()}`,
        assetId: asset.id,
        uri: asset.uri || video.uri,
        filename: asset.filename || `guitar-practice-${Date.now()}.mp4`,
        guitarMode: mode,
        facing,
        durationSeconds: Math.max(1, durationSeconds),
        createdAt,
        note: note.trim(),
      };
      await savePracticeRecording(record);
      setNote('');
      await reload();
      setSelectedId(record.id);
      setStatus(`저장 완료 · Guitar Coach AI 앨범 · ${formatTime(record.durationSeconds)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '연습 영상을 저장하지 못했습니다.');
      setStatus('영상 저장 실패');
    } finally {
      setSaving(false);
      setElapsedSeconds(0);
    }
  };

  const startRecording = async () => {
    if (!cameraRef.current || !cameraReady || recording || saving) return;
    setError('');
    try {
      const audioGranted = await requestAudioPermission();
      if (!audioGranted) throw new Error('연습 소리를 포함하려면 마이크 권한이 필요합니다.');
      const saveGranted = await ensureSavePermission();
      if (!saveGranted) throw new Error('연습 영상을 갤러리에 저장할 권한이 필요합니다.');
      recordingStartedAtRef.current = Date.now();
      setElapsedSeconds(0);
      setRecording(true);
      setStatus(`녹화 중 · 최대 ${maxDuration / 60}분 · AI 안전 모드`);
      const promise = cameraRef.current.recordAsync({ maxDuration });
      recordingPromiseRef.current = promise;
      const result = await promise;
      const duration = Math.max(1, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
      await finishRecordedVideo(result, duration);
    } catch (caught) {
      setRecording(false);
      recordingPromiseRef.current = null;
      setElapsedSeconds(0);
      setStatus('녹화 시작 또는 저장 실패');
      setError(caught instanceof Error ? caught.message : '연습 영상 녹화 중 오류가 발생했습니다.');
    }
  };

  const stopRecording = () => {
    if (!recording) return;
    setStatus('녹화를 종료하고 파일을 처리하는 중…');
    cameraRef.current?.stopRecording();
  };

  const removeFromList = async (id: string) => {
    try {
      await deletePracticeRecordingMetadata(id);
      await reload();
      setStatus('앱의 최근 영상 목록에서 제거했습니다. 갤러리 원본은 유지됩니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '영상 목록에서 제거하지 못했습니다.');
    }
  };

  const remountCamera = (nextFacing = facing) => {
    setCameraReady(false);
    setCameraError('');
    setError('');
    setStatus(`${nextFacing === 'back' ? '후면' : '전면'} 카메라를 다시 연결하는 중입니다.`);
    setCameraKey((value) => value + 1);
  };

  const switchCamera = () => {
    if (recording || saving) return;
    const nextFacing: CameraType = facing === 'back' ? 'front' : 'back';
    setFacing(nextFacing);
    remountCamera(nextFacing);
  };

  const selected = recordings.find((item) => item.id === selectedId) ?? null;

  if (!cameraPermission) {
    return <View style={styles.center}><Text style={styles.centerText}>카메라 권한을 확인하는 중입니다.</Text></View>;
  }

  if (!cameraPermission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>연습 영상 녹화에 카메라 권한이 필요합니다</Text>
        <Text style={styles.centerText}>영상은 휴대폰 갤러리에만 저장되며 서버로 업로드하지 않습니다.</Text>
        <Pressable onPress={() => void requestCameraPermission()} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>카메라 권한 허용</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator nestedScrollEnabled keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>SAFE PRACTICE RECORDING</Text>
      <Text style={styles.title}>연습 영상 녹화·재생</Text>
      <Text style={styles.subtitle}>녹화 중에는 카메라 AI와 마이크 박자 분석을 동시에 실행하지 않는 안전 모드입니다. 녹화 후 영상과 AI 집중 연습을 따로 비교하세요.</Text>

      <View style={styles.cameraCard}>
        <CameraView
          key={`${facing}-${cameraKey}`}
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          mode="video"
          onCameraReady={() => {
            setCameraReady(true);
            setCameraError('');
            setError('');
            setStatus('카메라 준비 완료 · 녹화 시간을 선택하고 시작하세요.');
          }}
          onMountError={(event) => {
            setCameraReady(false);
            setCameraError(event.message);
            setError(event.message);
            setStatus('카메라 연결 실패');
          }}
        />
        <View pointerEvents="none" style={styles.bodyGuide} />
        <View pointerEvents="none" style={styles.recordBadgeWrap}>
          <Text style={[styles.recordBadge, recording && styles.recordBadgeActive]}>{recording ? `● REC ${formatTime(elapsedSeconds)}` : cameraReady ? '촬영 준비 완료' : '카메라 준비 중'}</Text>
          <Text style={styles.recordBadge}>{facing === 'back' ? '후면' : '전면'}</Text>
        </View>
        {!cameraReady ? (
          <View style={styles.cameraOverlay}>
            {cameraError ? (
              <>
                <Text style={styles.cameraErrorTitle}>카메라를 열지 못했습니다</Text>
                <Text style={styles.cameraErrorText}>{cameraError}</Text>
                <Pressable onPress={() => remountCamera()} style={styles.retryButton}>
                  <Text style={styles.retryText}>카메라 다시 연결</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.cameraWaitingText}>카메라 준비 중</Text>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.controlCard}>
        <Text style={styles.sectionTitle}>최대 녹화 시간</Text>
        <View style={styles.durationRow}>
          {MAX_DURATIONS.map((value) => <DurationButton key={value} value={value} active={maxDuration === value} disabled={recording || saving} onPress={() => setMaxDuration(value)} />)}
        </View>

        <Text style={styles.sectionTitle}>영상 메모</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          editable={!recording && !saving}
          placeholder="예: 80 BPM 업스트로크 점검"
          placeholderTextColor="#6e7681"
          style={styles.noteInput}
        />

        <View style={styles.actionRow}>
          <Pressable disabled={recording || saving} onPress={switchCamera} style={[styles.switchCameraButton, (recording || saving) && styles.disabled]}>
            <Text style={styles.switchCameraText}>카메라 전환</Text>
          </Pressable>
          <Pressable disabled={!cameraReady || saving} onPress={() => recording ? stopRecording() : void startRecording()} style={[styles.recordButton, recording && styles.stopButton, (!cameraReady || saving) && styles.disabled]}>
            <Text style={styles.recordButtonText}>{saving ? '저장 중…' : recording ? '녹화 종료' : '녹화 시작'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.statusCard}><Text style={styles.statusText}>{status}</Text></View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {selected ? <VideoPlayback key={selected.id} recording={selected} /> : null}

      {recordings.length ? (
        <View style={styles.listCard}>
          <Text style={styles.sectionTitle}>최근 연습 영상</Text>
          {recordings.map((item) => (
            <View key={item.id} style={styles.recordingRow}>
              <Pressable onPress={() => setSelectedId(item.id)} style={styles.recordingMain}>
                <Text style={styles.recordingTitle}>{item.note || item.filename}</Text>
                <Text style={styles.recordingMeta}>{dateLabel(item.createdAt)} · {formatTime(item.durationSeconds)} · {item.guitarMode === 'acoustic' ? '통기타' : item.guitarMode === 'electric' ? '일렉' : '공통'}</Text>
              </Pressable>
              <Pressable onPress={() => void removeFromList(item.id)} style={styles.removeButton}>
                <Text style={styles.removeText}>목록 제거</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 12, paddingBottom: 110 },
  center: { flex: 1, minHeight: 420, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 24 },
  centerText: { color: '#8b949e', fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 7 },
  permissionTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  permissionButton: { minHeight: 43, borderRadius: 12, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 14 },
  permissionButtonText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 20, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#8b949e', fontSize: 9, lineHeight: 15, marginTop: 5 },
  cameraCard: { height: 470, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d', marginTop: 12 },
  camera: { flex: 1 },
  bodyGuide: { position: 'absolute', left: '11%', right: '11%', top: '10%', bottom: '7%', borderWidth: 1.5, borderColor: 'rgba(126,231,135,0.72)', borderStyle: 'dashed', borderRadius: 70 },
  recordBadgeWrap: { position: 'absolute', left: 8, right: 8, top: 8, flexDirection: 'row', justifyContent: 'space-between' },
  recordBadge: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 5, fontSize: 7, fontWeight: '900' },
  recordBadgeActive: { backgroundColor: 'rgba(218,54,51,0.92)' },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.78)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  cameraWaitingText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  cameraErrorTitle: { color: '#ff7b72', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  cameraErrorText: { color: '#b1bac4', fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 6 },
  retryButton: { minHeight: 40, borderRadius: 11, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 12 },
  retryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  controlCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 15, padding: 11, marginTop: 9 },
  sectionTitle: { color: '#f0f6fc', fontSize: 10, fontWeight: '900', marginTop: 7, marginBottom: 6 },
  durationRow: { flexDirection: 'row', gap: 5 },
  durationButton: { flex: 1, minHeight: 35, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  durationButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  durationText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  durationTextActive: { color: '#ffffff' },
  noteInput: { minHeight: 41, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', color: '#f0f6fc', fontSize: 10, paddingHorizontal: 10 },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  switchCameraButton: { flex: 0.75, minHeight: 43, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  switchCameraText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  recordButton: { flex: 1.25, minHeight: 43, borderRadius: 11, backgroundColor: '#da3633', alignItems: 'center', justifyContent: 'center' },
  stopButton: { backgroundColor: '#8b1a1a' },
  recordButtonText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  statusCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 12, padding: 9, marginTop: 8 },
  statusText: { color: '#b6d8ff', fontSize: 8, lineHeight: 13 },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 13, marginTop: 7 },
  playbackCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 9, marginTop: 10 },
  videoView: { width: '100%', aspectRatio: 9 / 16, backgroundColor: '#000000', borderRadius: 11, overflow: 'hidden' },
  playbackTitle: { color: '#f0f6fc', fontSize: 11, fontWeight: '900', marginTop: 8 },
  playbackMeta: { color: '#8b949e', fontSize: 7, marginTop: 3 },
  playbackNote: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 5 },
  listCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 10, marginTop: 10 },
  recordingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  recordingMain: { flex: 1, paddingRight: 7 },
  recordingTitle: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  recordingMeta: { color: '#8b949e', fontSize: 7, marginTop: 3 },
  removeButton: { minWidth: 53, height: 32, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#ff7b72', fontSize: 7, fontWeight: '900' },
  disabled: { opacity: 0.42 },
});
