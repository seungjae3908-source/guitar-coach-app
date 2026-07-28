import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import App from './App';
import FocusAiScreen from './FocusAiScreen';

export default function AppShell() {
  const [focusOpen, setFocusOpen] = useState(false);

  return (
    <View style={styles.root}>
      <App />
      {!focusOpen ? (
        <Pressable style={styles.focusButton} onPress={() => setFocusOpen(true)}>
          <Text style={styles.focusEyebrow}>MIC AI BETA</Text>
          <Text style={styles.focusLabel}>◎ AI 집중</Text>
        </Pressable>
      ) : null}
      {focusOpen ? (
        <View style={styles.overlay}>
          <FocusAiScreen onClose={() => setFocusOpen(false)} />
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
});
