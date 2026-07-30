import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import CameraCalibrationWizard from './CameraCalibrationWizard';
import FretboardCalibrationWizard from './FretboardCalibrationWizard';

type CalibrationKind = 'right-hand' | 'fretboard';

export default function CalibrationHub({
  mode,
  onSaved,
  onClose,
}: {
  mode: GuitarModeId;
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const [kind, setKind] = useState<CalibrationKind>('right-hand');

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <Pressable onPress={() => setKind('right-hand')} style={[styles.tab, kind === 'right-hand' && styles.tabActive]}>
          <Text style={[styles.tabText, kind === 'right-hand' && styles.tabTextActive]}>오른손·피크·줄 보정</Text>
        </Pressable>
        <Pressable onPress={() => setKind('fretboard')} style={[styles.tab, kind === 'fretboard' && styles.tabActive]}>
          <Text style={[styles.tabText, kind === 'fretboard' && styles.tabTextActive]}>왼손 코드·지판 보정</Text>
        </Pressable>
      </View>
      <View style={styles.body}>
        {kind === 'right-hand' ? (
          <CameraCalibrationWizard mode={mode} onSaved={onSaved} onClose={onClose} />
        ) : (
          <FretboardCalibrationWizard mode={mode} onSaved={onSaved} onClose={onClose} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  tabs: { flexDirection: 'row', gap: 7, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 3 },
  tab: { flex: 1, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  tabActive: { borderColor: '#2ea043', backgroundColor: '#16351f' },
  tabText: { color: '#b1bac4', fontSize: 9, fontWeight: '900', textAlign: 'center' },
  tabTextActive: { color: '#7ee787' },
  body: { flex: 1 },
});
