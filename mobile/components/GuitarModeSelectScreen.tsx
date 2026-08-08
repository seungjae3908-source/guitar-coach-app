import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import { ACOUSTIC_MODE_PROFILE, ELECTRIC_MODE_PROFILE } from '../config/guitar-mode-profiles';

function ModeCard({
  mode,
  onSelect,
}: {
  mode: GuitarModeId;
  onSelect: (mode: GuitarModeId) => void;
}) {
  const profile = mode === 'acoustic' ? ACOUSTIC_MODE_PROFILE : ELECTRIC_MODE_PROFILE;
  const acoustic = mode === 'acoustic';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${profile.title} 선택`}
      onPress={() => onSelect(mode)}
      style={({ pressed }) => [
        styles.modeCard,
        acoustic ? styles.acousticCard : styles.electricCard,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.modeHeader}>
        <View style={[styles.modeIcon, acoustic ? styles.acousticIcon : styles.electricIcon]}>
          <Text style={styles.modeIconText}>{acoustic ? 'A' : 'E'}</Text>
        </View>
        <View style={styles.modeTitleWrap}>
          <Text style={styles.modeTitle}>{profile.title}</Text>
          <Text style={styles.modeSubtitle}>{profile.subtitle}</Text>
        </View>
      </View>

      <View style={styles.tagWrap}>
        {profile.practiceDefinitions.slice(0, 6).map((practice) => (
          <View key={practice.id} style={styles.tag}>
            <Text style={styles.tagText}>{practice.title}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.selectText}>{profile.title}로 시작</Text>
    </Pressable>
  );
}

export default function GuitarModeSelectScreen({
  onSelect,
}: {
  onSelect: (mode: GuitarModeId) => void;
}) {
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>GUITAR COACH AI 0.6.0</Text>
        <Text style={styles.title}>어떤 기타로 연습할까요?</Text>
        <Text style={styles.description}>
          선택한 기타에 맞춰 연습 메뉴, AI 분석 기준, 악보와 장비·톤 기능이 자동으로 바뀝니다.
        </Text>

        <ModeCard mode="acoustic" onSelect={onSelect} />
        <ModeCard mode="electric" onSelect={onSelect} />

        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>분석 정확도 원칙</Text>
          <Text style={styles.noticeText}>
            손이나 피크가 너무 작거나 흐리면 점수를 만들지 않고 촬영 위치를 다시 안내합니다. 영상과 좌표는 휴대폰 안에서 처리합니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 18, paddingBottom: 40 },
  eyebrow: { color: '#7ee787', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#f0f6fc', fontSize: 28, lineHeight: 35, fontWeight: '900', marginTop: 7 },
  description: { color: '#8b949e', fontSize: 13, lineHeight: 20, marginTop: 9, marginBottom: 8 },
  modeCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 17,
    marginTop: 14,
  },
  acousticCard: { backgroundColor: '#2a210d', borderColor: '#9e6a03' },
  electricCard: { backgroundColor: '#111d2f', borderColor: '#1f6feb' },
  modeHeader: { flexDirection: 'row', alignItems: 'center' },
  modeIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  acousticIcon: { backgroundColor: '#9e6a03' },
  electricIcon: { backgroundColor: '#1f6feb' },
  modeIconText: { color: '#ffffff', fontSize: 22, fontWeight: '900' },
  modeTitleWrap: { flex: 1, marginLeft: 13 },
  modeTitle: { color: '#f0f6fc', fontSize: 20, fontWeight: '900' },
  modeSubtitle: { color: '#b1bac4', fontSize: 11, lineHeight: 17, marginTop: 4 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 15 },
  tag: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  tagText: { color: '#d0d7de', fontSize: 10, fontWeight: '800' },
  selectText: { color: '#ffffff', fontSize: 13, fontWeight: '900', marginTop: 16, textAlign: 'right' },
  noticeCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 17, padding: 15, marginTop: 16 },
  noticeTitle: { color: '#f2cc60', fontSize: 12, fontWeight: '900' },
  noticeText: { color: '#8b949e', fontSize: 11, lineHeight: 18, marginTop: 6 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
