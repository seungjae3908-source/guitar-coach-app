import { Component, lazy, Suspense, type ErrorInfo, type ReactNode, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import App from './App';

const LazyFocusAiScreen = lazy(() => import('./FocusAiScreen'));

type BoundaryProps = {
  children: ReactNode;
  onClose: () => void;
};

type BoundaryState = {
  failed: boolean;
};

class FocusErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Focus AI screen failed to load', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <View style={styles.failureScreen}>
          <Text style={styles.failureTitle}>AI 집중 기능을 안전하게 중지했습니다.</Text>
          <Text style={styles.failureText}>
            이 휴대폰에서 마이크 분석 모듈을 시작하지 못했습니다. 기존 카메라·연습 기록 기능은 계속 사용할 수 있습니다.
          </Text>
          <Pressable style={styles.failureButton} onPress={this.props.onClose}>
            <Text style={styles.failureButtonText}>기존 앱으로 돌아가기</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

export default function AppShell() {
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusAttempt, setFocusAttempt] = useState(0);

  const closeFocus = () => setFocusOpen(false);
  const openFocus = () => {
    setFocusAttempt((value) => value + 1);
    setFocusOpen(true);
  };

  return (
    <View style={styles.root}>
      <App />
      {!focusOpen ? (
        <Pressable style={styles.focusButton} onPress={openFocus}>
          <Text style={styles.focusEyebrow}>MIC AI BETA</Text>
          <Text style={styles.focusLabel}>◎ AI 집중</Text>
        </Pressable>
      ) : null}
      {focusOpen ? (
        <View style={styles.overlay}>
          <FocusErrorBoundary key={focusAttempt} onClose={closeFocus}>
            <Suspense
              fallback={(
                <View style={styles.loadingScreen}>
                  <ActivityIndicator color="#7ee787" size="large" />
                  <Text style={styles.loadingText}>AI 집중 기능을 안전하게 불러오는 중</Text>
                </View>
              )}
            >
              <LazyFocusAiScreen onClose={closeFocus} />
            </Suspense>
          </FocusErrorBoundary>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    elevation: 100,
    backgroundColor: '#080b10',
  },
  focusButton: {
    position: 'absolute',
    right: 14,
    bottom: 88,
    zIndex: 50,
    elevation: 50,
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: '#1f6feb',
    borderWidth: 1,
    borderColor: '#58a6ff',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  focusEyebrow: { color: '#b6dcff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  focusLabel: { color: '#ffffff', fontSize: 15, fontWeight: '900', marginTop: 2 },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#080b10',
    padding: 24,
  },
  loadingText: { color: '#8b949e', marginTop: 14, textAlign: 'center' },
  failureScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#080b10',
    padding: 28,
  },
  failureTitle: { color: '#f0f6fc', fontSize: 21, fontWeight: '900', textAlign: 'center' },
  failureText: { color: '#8b949e', fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 12 },
  failureButton: { marginTop: 24, borderRadius: 14, backgroundColor: '#238636', paddingHorizontal: 18, paddingVertical: 13 },
  failureButtonText: { color: '#ffffff', fontWeight: '900' },
});
