import { Component, type ComponentType, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type FocusAiRecord = {
  id: string;
  createdAt: string;
  mode: '코드' | '핑거링' | '아르페지오' | '스트럼' | '피킹';
  durationSeconds: number;
  source: '집중 코치';
  bpm: number;
  mistakes: number;
  coachScore: number;
  feedback: string;
  analysis?: {
    rhythmAccuracy: number;
    timingConsistency: number;
    dynamicStability: number;
    noiseControl: number;
    detectedAttacks: number;
    matchedBeats: number;
    expectedBeats: number;
    averageOffsetMs: number;
    confidence: number;
  };
};

type Props = {
  settings: {
    haptics: boolean;
    voiceFeedback?: boolean;
  };
  onSaveRecord: (record: FocusAiRecord) => void;
};

type BoundaryProps = {
  children: ReactNode;
  onError: (message: string) => void;
};

type BoundaryState = {
  failed: boolean;
};

class AudioFeatureBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Focus AI audio screen failed safely', error, info.componentStack);
    this.props.onError(error.message || '오디오 분석 화면을 실행하지 못했습니다.');
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function FailurePanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>AI 소리 분석을 안전하게 중단했습니다.</Text>
      <Text style={styles.body}>{message}</Text>
      <Text style={styles.body}>홈·카메라·기록 기능은 계속 사용할 수 있습니다.</Text>
      <Pressable style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>AI 분석 다시 불러오기</Text>
      </Pressable>
    </View>
  );
}

export default function SafeFocusAiScreen(props: Props) {
  const [Screen, setScreen] = useState<ComponentType<Props> | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setScreen(null);
    setError('');

    import('./FocusAiPracticeScreen')
      .then((module) => {
        if (active) setScreen(() => module.default);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : '오디오 분석 모듈을 불러오지 못했습니다.');
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  if (error) {
    return <FailurePanel message={error} onRetry={() => setAttempt((value) => value + 1)} />;
  }

  if (!Screen) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#7ee787" />
        <Text style={styles.loadingText}>AI 소리 분석 엔진을 준비하는 중</Text>
        <Text style={styles.subText}>이 화면을 열었을 때만 마이크 분석 모듈이 시작됩니다.</Text>
      </View>
    );
  }

  return (
    <AudioFeatureBoundary onError={setError}>
      <Screen {...props} />
    </AudioFeatureBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161b22',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 24,
  },
  loadingText: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', marginTop: 16 },
  subText: { color: '#8b949e', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#f85149',
    padding: 18,
  },
  title: { color: '#f0f6fc', fontSize: 17, fontWeight: '900' },
  body: { color: '#b1bac4', fontSize: 13, lineHeight: 20, marginTop: 8 },
  button: { backgroundColor: '#2ea043', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#ffffff', fontWeight: '900' },
});
