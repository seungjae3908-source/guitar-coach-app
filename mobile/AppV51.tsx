import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import AppV4 from './AppV4';

const FOCUS_AI_URL = 'https://seungjae3908-source.github.io/guitar-coach-app/?focus=1';

export default function AppV51() {
  const openFocusAi = async () => {
    try {
      await Linking.openURL(FOCUS_AI_URL);
    } catch {
      // The verified native app must stay usable even when the browser cannot open.
    }
  };

  return (
    <View style={styles.root}>
      <AppV4 />
      <Pressable accessibilityRole="button" style={styles.aiButton} onPress={openFocusAi}>
        <Text style={styles.aiButtonTitle}>AI 소리 분석</Text>
        <Text style={styles.aiButtonSubtitle}>안전한 웹 마이크</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  aiButton: {
    position: 'absolute',
    right: 14,
    bottom: 86,
    zIndex: 50,
    elevation: 12,
    minWidth: 126,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#58a6ff',
    backgroundColor: '#1158a7',
    paddingHorizontal: 14,
    paddingVertical: 11,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  aiButtonTitle: { color: '#ffffff', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  aiButtonSubtitle: { color: '#c9e3ff', fontSize: 9, fontWeight: '700', marginTop: 2, textAlign: 'center' },
});
