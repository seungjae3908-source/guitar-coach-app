import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import CompleteBetaAppV060Plus from './CompleteBetaAppV060Plus';
import RuntimeDiagnosticsPanel from './components/RuntimeDiagnosticsPanel';
import { recordRuntimeDiagnostic, updateRuntimeDiagnosticState } from './services/runtime-diagnostics';

export default function DiagnosticRootApp() {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  useEffect(() => {
    void recordRuntimeDiagnostic('app', 'app_mounted', {
      version: '0.6.0',
      versionCode: 12,
      diagnosticsLauncher: true,
    });
  }, []);

  const openDiagnostics = () => {
    setDiagnosticsOpen(true);
    void updateRuntimeDiagnosticState({ lastScreen: 'runtime-diagnostics' });
    void recordRuntimeDiagnostic('navigation', 'diagnostics_opened');
  };

  const closeDiagnostics = () => {
    setDiagnosticsOpen(false);
    void recordRuntimeDiagnostic('navigation', 'diagnostics_closed');
  };

  return (
    <View style={styles.root}>
      <CompleteBetaAppV060Plus />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="카메라와 기능 자동 진단 열기"
        onPress={openDiagnostics}
        style={({ pressed }) => [styles.floatingButton, pressed && styles.pressed]}
      >
        <Text style={styles.floatingText}>진단</Text>
      </Pressable>
      <Modal
        visible={diagnosticsOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeDiagnostics}
      >
        <RuntimeDiagnosticsPanel onClose={closeDiagnostics} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  floatingButton: {
    position: 'absolute',
    right: 12,
    bottom: 28,
    minWidth: 62,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#ffffff',
    backgroundColor: '#d1242f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 13,
    elevation: 12,
    zIndex: 999,
  },
  floatingText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});
