import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { isNativeAudioAnalysisAvailable } from '../modules/guitar-coach-audio';
import {
  analyzeHandAsync,
  isDetailedHandCoachAvailable,
  type PickColor,
} from '../modules/guitar-coach-hand';
import { isAdvancedMetronomeAvailable } from '../modules/guitar-coach-metronome';
import {
  analyzePoseAsync,
  inspectCameraFrameAsync,
  isLiveCoachNativeAvailable,
  type CameraFrameDiagnostic,
} from '../modules/guitar-coach-native';
import {
  buildRuntimeDiagnosticReport,
  clearRuntimeDiagnostics,
  recordRuntimeDiagnostic,
  updateRuntimeDiagnosticState,
} from '../services/runtime-diagnostics';

type DiagnosticPhase = 'idle' | 'right-hand' | 'left-hand' | 'full' | 'complete' | 'failed';

type PhaseResult = {
  phase: Exclude<DiagnosticPhase, 'idle' | 'complete' | 'failed'>;
  previewReady: boolean;
  capturedFrames: number;
  inspectedFrames: CameraFrameDiagnostic[];
  analysisCalls: number;
  analysisSuccesses: number;
  detectedTargets: number;
  errors: string[];
};

const PHASE_ORDER: Array<PhaseResult['phase']> = ['right-hand', 'left-hand', 'full'];

function phaseLabel(phase: DiagnosticPhase) {
  if (phase === 'right-hand') return '오른손 카메라';
  if (phase === 'left-hand') return '왼손 카메라';
  if (phase === 'full') return '전체 자세 카메라';
  if (phase === 'complete') return '자동 진단 완료';
  if (phase === 'failed') return '자동 진단 중단';
  return '진단 대기';
}

function facingForPhase(phase: PhaseResult['phase']): CameraType {
  return phase === 'full' ? 'front' : 'back';
}

function pickColorForPhase(phase: PhaseResult['phase']): PickColor {
  return phase === 'right-hand' ? 'auto' : 'none';
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function safeDelete(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Native analyzers normally delete temporary camera files.
  }
}

function newPhaseResult(phase: PhaseResult['phase']): PhaseResult {
  return {
    phase,
    previewReady: false,
    capturedFrames: 0,
    inspectedFrames: [],
    analysisCalls: 0,
    analysisSuccesses: 0,
    detectedTargets: 0,
    errors: [],
  };
}

export default function RuntimeDiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const cameraRef = useRef<CameraView | null>(null);
  const phaseExecutionRef = useRef<DiagnosticPhase | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<DiagnosticPhase>('idle');
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('밝은 곳에서 휴대폰을 세워 두고 자동 진단을 시작하세요.');
  const [error, setError] = useState('');
  const [results, setResults] = useState<PhaseResult[]>([]);
  const [lastReportText, setLastReportText] = useState('');

  const modules = useMemo(() => ({
    pose: isLiveCoachNativeAvailable,
    hand: isDetailedHandCoachAvailable,
    audio: isNativeAudioAnalysisAvailable,
    metronome: isAdvancedMetronomeAvailable,
  }), []);

  const running = phase === 'right-hand' || phase === 'left-hand' || phase === 'full';
  const totalCaptured = results.reduce((sum, item) => sum + item.capturedFrames, 0);
  const totalAnalyzed = results.reduce((sum, item) => sum + item.analysisSuccesses, 0);
  const blackFrameCount = results.reduce(
    (sum, item) => sum + item.inspectedFrames.filter((frame) => frame.blackFrameLikely).length,
    0,
  );

  const setDiagnosticPhase = (next: PhaseResult['phase']) => {
    phaseExecutionRef.current = null;
    setCameraReady(false);
    setFacing(facingForPhase(next));
    setPhase(next);
    setCameraKey((value) => value + 1);
    void updateRuntimeDiagnosticState({
      activeCameraMode: next,
      cameraFacing: facingForPhase(next),
      cameraPreviewReady: false,
    });
  };

  const updatePhaseResult = (phaseId: PhaseResult['phase'], update: (current: PhaseResult) => PhaseResult) => {
    setResults((current) => {
      const existing = current.find((item) => item.phase === phaseId) ?? newPhaseResult(phaseId);
      const next = update(existing);
      return [...current.filter((item) => item.phase !== phaseId), next]
        .sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));
    });
  };

  const startDiagnostics = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setResults([]);
    setLastReportText('');
    setStatus('카메라 권한과 네이티브 모듈을 확인하는 중입니다.');
    await clearRuntimeDiagnostics();
    await recordRuntimeDiagnostic('diagnostics', 'test_started', { modules });

    const resolvedPermission = permission?.granted ? permission : await requestPermission();
    await updateRuntimeDiagnosticState({
      cameraPermission: resolvedPermission.granted ? 'granted' : 'denied',
      cameraPermissionCanAskAgain: resolvedPermission.canAskAgain,
    });
    await recordRuntimeDiagnostic('camera', 'permission_result', {
      granted: resolvedPermission.granted,
      canAskAgain: resolvedPermission.canAskAgain,
    }, resolvedPermission.granted ? 'info' : 'error');

    if (!resolvedPermission.granted) {
      setPhase('failed');
      setError('카메라 권한이 허용되지 않아 자동 진단을 실행할 수 없습니다.');
      setStatus('권한 단계에서 진단이 중단됐습니다.');
      setBusy(false);
      return;
    }

    setDiagnosticPhase('right-hand');
    setStatus('1/3 오른손 카메라를 여는 중입니다.');
  };

  const completeDiagnostics = async () => {
    setPhase('complete');
    setCameraReady(false);
    setBusy(false);
    phaseExecutionRef.current = null;
    await updateRuntimeDiagnosticState({ activeCameraMode: 'none', cameraPreviewReady: false });
    await recordRuntimeDiagnostic('diagnostics', 'test_completed', {
      capturedFrames: totalCaptured + 2,
      analyzedFrames: totalAnalyzed,
      blackFrameCount,
    });
    setStatus('자동 진단이 끝났습니다. 아래에서 진단 파일을 내보내 이 채팅에 올리세요.');
  };

  const executePhase = async (phaseId: PhaseResult['phase']) => {
    if (!cameraRef.current || phaseExecutionRef.current === phaseId) return;
    phaseExecutionRef.current = phaseId;
    updatePhaseResult(phaseId, (current) => ({ ...current, previewReady: true }));
    await recordRuntimeDiagnostic('camera', 'preview_ready', { phase: phaseId, facing });
    await updateRuntimeDiagnosticState({
      cameraPreviewReady: true,
      cameraPreviewReadyCount: results.filter((item) => item.previewReady).length + 1,
    });

    try {
      for (let index = 0; index < 2; index += 1) {
        await wait(index === 0 ? 650 : 420);
        const photo = await cameraRef.current?.takePictureAsync({
          quality: 0.38,
          shutterSound: false,
          skipProcessing: false,
          mirror: facing === 'front',
        });
        if (!photo?.uri) throw new Error('카메라 프레임 URI가 생성되지 않았습니다.');

        const capturedAt = new Date().toISOString();
        updatePhaseResult(phaseId, (current) => ({ ...current, capturedFrames: current.capturedFrames + 1 }));
        await updateRuntimeDiagnosticState({
          capturedFrameCount: totalCaptured + index + 1,
          lastFrameAt: capturedAt,
        });
        await recordRuntimeDiagnostic('camera', 'frame_captured', {
          phase: phaseId,
          facing,
          sequence: index + 1,
          width: photo.width,
          height: photo.height,
        });

        try {
          const frame = await inspectCameraFrameAsync(photo.uri);
          updatePhaseResult(phaseId, (current) => ({
            ...current,
            inspectedFrames: [...current.inspectedFrames, frame],
            analysisCalls: current.analysisCalls + 1,
          }));
          await recordRuntimeDiagnostic('camera', 'frame_inspected', {
            phase: phaseId,
            sequence: index + 1,
            averageLuminance: Math.round(frame.averageLuminance * 10) / 10,
            contrast: Math.round(frame.contrast * 10) / 10,
            darkRatio: Math.round(frame.darkRatio * 1000) / 1000,
            blackFrameLikely: frame.blackFrameLikely,
            frameSignature: frame.frameSignature,
          }, frame.blackFrameLikely ? 'error' : 'info');

          if (phaseId === 'full') {
            if (!isLiveCoachNativeAvailable) throw new Error('자세 분석 네이티브 모듈이 없습니다.');
            const pose = await analyzePoseAsync(photo.uri);
            updatePhaseResult(phaseId, (current) => ({
              ...current,
              analysisSuccesses: current.analysisSuccesses + 1,
              detectedTargets: current.detectedTargets + (pose.hasPerson ? 1 : 0),
            }));
            await recordRuntimeDiagnostic('analysis', 'pose_call_success', {
              sequence: index + 1,
              hasPerson: pose.hasPerson,
              landmarkCount: pose.landmarks.length,
              latencyMs: pose.latencyMs,
            });
          } else {
            if (!isDetailedHandCoachAvailable) throw new Error('손 분석 네이티브 모듈이 없습니다.');
            const hand = await analyzeHandAsync(photo.uri, pickColorForPhase(phaseId));
            updatePhaseResult(phaseId, (current) => ({
              ...current,
              analysisSuccesses: current.analysisSuccesses + 1,
              detectedTargets: current.detectedTargets + (hand.hasHand ? 1 : 0),
            }));
            await recordRuntimeDiagnostic('analysis', 'hand_call_success', {
              phase: phaseId,
              sequence: index + 1,
              hasHand: hand.hasHand,
              landmarkCount: hand.landmarks.length,
              latencyMs: hand.latencyMs,
              pickDetected: hand.pick.detected,
            });
          }

          await updateRuntimeDiagnosticState({
            analyzedFrameCount: totalAnalyzed + index + 1,
            lastAnalysisError: null,
          });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : '프레임 분석에 실패했습니다.';
          updatePhaseResult(phaseId, (current) => ({
            ...current,
            analysisCalls: current.analysisCalls + 1,
            errors: [...current.errors, message],
          }));
          await updateRuntimeDiagnosticState({ lastAnalysisError: message });
          await recordRuntimeDiagnostic('analysis', 'frame_analysis_failed', { phase: phaseId, message }, 'error');
        } finally {
          await safeDelete(photo.uri);
        }
      }

      const currentIndex = PHASE_ORDER.indexOf(phaseId);
      const next = PHASE_ORDER[currentIndex + 1];
      if (next) {
        setStatus(`${currentIndex + 2}/3 ${phaseLabel(next)}를 여는 중입니다.`);
        setDiagnosticPhase(next);
      } else {
        await completeDiagnostics();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '카메라 자동 진단 중 오류가 발생했습니다.';
      updatePhaseResult(phaseId, (current) => ({ ...current, errors: [...current.errors, message] }));
      await updateRuntimeDiagnosticState({
        cameraPreviewReady: false,
        lastCameraError: message,
      });
      await recordRuntimeDiagnostic('camera', 'phase_failed', { phase: phaseId, message }, 'error');
      setPhase('failed');
      setCameraReady(false);
      setBusy(false);
      setError(message);
      setStatus(`${phaseLabel(phaseId)} 단계에서 진단이 중단됐습니다.`);
    }
  };

  useEffect(() => {
    if (!running || !cameraReady || phaseExecutionRef.current === phase) return;
    void executePhase(phase);
  }, [cameraReady, phase, running]);

  const exportReport = async () => {
    setError('');
    try {
      const report = await buildRuntimeDiagnosticReport({
        modules,
        test: {
          phase,
          results,
          totals: {
            capturedFrames: totalCaptured,
            analyzedFrames: totalAnalyzed,
            blackFrameCount,
          },
        },
      });
      const text = JSON.stringify(report, null, 2);
      setLastReportText(text);
      const filename = `guitar-coach-diagnostic-${Date.now()}.json`;
      const file = new File(Paths.cache, filename);
      file.create();
      file.write(text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          dialogTitle: '기타 코치 AI 진단 파일 공유',
          mimeType: 'application/json',
        });
      } else {
        await Share.share({ title: filename, message: text });
      }
      setStatus('진단 파일 공유창을 열었습니다. 파일을 저장하거나 이 채팅에 첨부하세요.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '진단 파일을 만들지 못했습니다.');
    }
  };

  const reset = () => {
    phaseExecutionRef.current = null;
    setPhase('idle');
    setCameraReady(false);
    setBusy(false);
    setError('');
    setResults([]);
    setLastReportText('');
    setStatus('밝은 곳에서 휴대폰을 세워 두고 자동 진단을 시작하세요.');
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>SAMSUNG PHONE SELF DIAGNOSTICS</Text>
          <Text style={styles.title}>카메라·기능 자동 진단</Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>닫기</Text></Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator>
        <View style={styles.statusCard}>
          <Text style={styles.phase}>{phaseLabel(phase)}</Text>
          <Text style={styles.status}>{status}</Text>
          <Text style={styles.notice}>사진 원본은 보고서에 포함하지 않습니다. 모델명·Android 버전·오류와 영상 밝기 수치만 저장합니다.</Text>
        </View>

        <View style={styles.moduleCard}>
          <Text style={styles.sectionTitle}>APK 네이티브 모듈</Text>
          <Text style={styles.moduleText}>자세 분석 {modules.pose ? '정상 등록' : '없음'}</Text>
          <Text style={styles.moduleText}>손 관절 분석 {modules.hand ? '정상 등록' : '없음'}</Text>
          <Text style={styles.moduleText}>마이크 분석 {modules.audio ? '정상 등록' : '없음'}</Text>
          <Text style={styles.moduleText}>메트로놈 {modules.metronome ? '정상 등록' : '없음'}</Text>
        </View>

        {running ? (
          <View style={styles.cameraFrame}>
            <CameraView
              key={`${phase}-${facing}-${cameraKey}`}
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              mirror={facing === 'front'}
              mode="picture"
              ratio="4:3"
              animateShutter={false}
              onCameraReady={() => {
                setCameraReady(true);
                setError('');
                void updateRuntimeDiagnosticState({ cameraPreviewReady: true });
              }}
              onMountError={(event) => {
                const message = event.message || '카메라를 열지 못했습니다.';
                setCameraReady(false);
                setError(message);
                setPhase('failed');
                setBusy(false);
                void updateRuntimeDiagnosticState({ cameraPreviewReady: false, lastCameraError: message });
                void recordRuntimeDiagnostic('camera', 'mount_failed', { phase, facing, message }, 'error');
              }}
            />
            <View pointerEvents="none" style={styles.cameraOverlay}>
              <Text style={styles.cameraBadge}>{phaseLabel(phase)}</Text>
              <Text style={styles.cameraBadge}>{cameraReady ? '영상 준비' : '연결 중'}</Text>
            </View>
            {!cameraReady ? (
              <View pointerEvents="none" style={styles.loadingOverlay}>
                <ActivityIndicator />
                <Text style={styles.loadingText}>실제 카메라 연결 중</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>진단 집계</Text>
          <Text style={styles.summaryText}>카메라 단계 {results.filter((item) => item.previewReady).length}/3</Text>
          <Text style={styles.summaryText}>실제 촬영 프레임 {totalCaptured}/6</Text>
          <Text style={styles.summaryText}>네이티브 분석 성공 {totalAnalyzed}/6</Text>
          <Text style={[styles.summaryText, blackFrameCount > 0 && styles.badText]}>검은 프레임 의심 {blackFrameCount}개</Text>
          {results.map((item) => (
            <View key={item.phase} style={styles.phaseResult}>
              <Text style={styles.phaseResultTitle}>{phaseLabel(item.phase)}</Text>
              <Text style={styles.phaseResultText}>프리뷰 {item.previewReady ? '성공' : '실패'} · 촬영 {item.capturedFrames}/2 · 분석 {item.analysisSuccesses}/2</Text>
              {item.inspectedFrames.map((frame, index) => (
                <Text key={`${item.phase}-${index}`} style={styles.frameText}>
                  프레임 {index + 1} · 밝기 {frame.averageLuminance.toFixed(1)} · 대비 {frame.contrast.toFixed(1)} · {frame.blackFrameLikely ? '검은 화면 의심' : '영상 데이터 있음'}
                </Text>
              ))}
              {item.errors.map((message, index) => <Text key={`${item.phase}-error-${index}`} style={styles.errorText}>{message}</Text>)}
            </View>
          ))}
        </View>

        <View style={styles.actionCard}>
          <Pressable disabled={busy} onPress={() => void startDiagnostics()} style={[styles.primaryButton, busy && styles.disabled]}>
            <Text style={styles.primaryText}>{busy ? '자동 진단 중…' : '자동 진단 시작'}</Text>
          </Pressable>
          <Pressable disabled={running} onPress={() => void exportReport()} style={[styles.exportButton, running && styles.disabled]}>
            <Text style={styles.exportText}>진단 JSON 파일 내보내기</Text>
          </Pressable>
          <Pressable disabled={running} onPress={reset} style={[styles.resetButton, running && styles.disabled]}>
            <Text style={styles.resetText}>진단 초기화</Text>
          </Pressable>
        </View>

        {lastReportText ? <Text style={styles.reportReady}>진단 보고서가 생성됐습니다 · {lastReportText.length.toLocaleString()}자</Text> : null}
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 62, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#30363d', backgroundColor: '#161b22' },
  headerText: { flex: 1, paddingRight: 10 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  title: { color: '#f0f6fc', fontSize: 17, fontWeight: '900', marginTop: 3 },
  closeButton: { minWidth: 54, minHeight: 40, borderRadius: 11, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  scroll: { flex: 1 },
  content: { padding: 12, paddingBottom: 80 },
  statusCard: { borderRadius: 17, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#111d2f', padding: 13 },
  phase: { color: '#79c0ff', fontSize: 15, fontWeight: '900' },
  status: { color: '#dbeafe', fontSize: 10, lineHeight: 16, marginTop: 5 },
  notice: { color: '#8b949e', fontSize: 8, lineHeight: 13, marginTop: 8 },
  moduleCard: { borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 12, marginTop: 10 },
  sectionTitle: { color: '#f0f6fc', fontSize: 12, fontWeight: '900', marginBottom: 6 },
  moduleText: { color: '#b1bac4', fontSize: 9, lineHeight: 15 },
  cameraFrame: { width: '100%', height: 360, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#484f58', marginTop: 10 },
  cameraOverlay: { position: 'absolute', left: 10, right: 10, top: 10, flexDirection: 'row', justifyContent: 'space-between' },
  cameraBadge: { color: '#ffffff', fontSize: 8, fontWeight: '900', backgroundColor: 'rgba(13,17,23,0.78)', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
  loadingText: { color: '#ffffff', fontSize: 9, fontWeight: '800', marginTop: 8 },
  summaryCard: { borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 12, marginTop: 10 },
  summaryText: { color: '#b1bac4', fontSize: 9, lineHeight: 15 },
  badText: { color: '#ff7b72' },
  phaseResult: { borderTopWidth: 1, borderTopColor: '#30363d', paddingTop: 8, marginTop: 8 },
  phaseResultTitle: { color: '#7ee787', fontSize: 10, fontWeight: '900' },
  phaseResultText: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 3 },
  frameText: { color: '#8b949e', fontSize: 7, lineHeight: 12, marginTop: 2 },
  errorText: { color: '#ffb4ad', fontSize: 8, lineHeight: 13, marginTop: 3 },
  actionCard: { borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 12, marginTop: 10, gap: 8 },
  primaryButton: { minHeight: 48, borderRadius: 13, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  exportButton: { minHeight: 46, borderRadius: 13, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center' },
  exportText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  resetButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  resetText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  reportReady: { color: '#7ee787', fontSize: 9, textAlign: 'center', marginTop: 10 },
  errorBanner: { color: '#ff7b72', fontSize: 9, lineHeight: 15, textAlign: 'center', marginTop: 10 },
});
