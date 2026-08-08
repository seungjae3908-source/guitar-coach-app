import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import type { ContinuousHandAnalysisResult } from '../modules/guitar-coach-continuous-camera';
import { subscribeLiveAnalysis } from '../services/analysis-stream';
import type { ChordRecognitionResult } from '../services/fretboard-chord-engine';
import {
  LiveHandOverlayMotionTracker,
  type OverlayPoint,
} from '../services/live-hand-overlay-metrics';

type Size = { width: number; height: number };
type TimedChord = { capturedAt: number; result: ChordRecognitionResult };

const CHORD_CATEGORIES = new Set<PracticeCategoryId>(['chords', 'powerChords']);
const FINGER_TIP_INDEXES = [8, 12, 16, 20];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (left: OverlayPoint, right: OverlayPoint) => Math.hypot(left.x - right.x, left.y - right.y);

function averagePoint(points: Array<OverlayPoint | undefined>) {
  const valid = points.filter((point): point is OverlayPoint => Boolean(point));
  if (!valid.length) return null;
  return {
    x: valid.reduce((sum, point) => sum + point.x, 0) / valid.length,
    y: valid.reduce((sum, point) => sum + point.y, 0) / valid.length,
  };
}

function activePointFor(result: ContinuousHandAnalysisResult, category: PracticeCategoryId) {
  if (result.pick.detected) {
    return { x: result.pick.centerX, y: result.pick.centerY };
  }
  if (category === 'arpeggio' || category === 'fingerstyle') {
    return averagePoint(FINGER_TIP_INDEXES.map((index) => result.landmarks[index]));
  }
  return result.landmarks[8] ?? result.landmarks[12] ?? result.landmarks[9] ?? null;
}

function handBounds(result: ContinuousHandAnalysisResult) {
  if (!result.hasHand || result.landmarks.length < 21) return null;
  const xs = result.landmarks.map((point) => point.x).filter(Number.isFinite);
  const ys = result.landmarks.map((point) => point.y).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function Segment({ from, to, size }: { from: OverlayPoint; to: OverlayPoint; size: Size }) {
  const x1 = from.x * size.width;
  const y1 = from.y * size.height;
  const x2 = to.x * size.width;
  const y2 = to.y * size.height;
  const length = Math.hypot(x2 - x1, y2 - y1);
  return (
    <View
      style={[
        styles.motionLine,
        {
          width: length,
          left: (x1 + x2 - length) / 2,
          top: (y1 + y2) / 2,
          transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
        },
      ]}
    />
  );
}

function chordLabel(chord: ChordRecognitionResult) {
  if (chord.status === 'confirmed' && chord.chordName) {
    return {
      title: chord.chordName,
      detail: `확정 · ${chord.confidencePercent}%${chord.score == null ? '' : ` · ${chord.score}점`}`,
      confirmed: true,
    };
  }
  if (chord.status === 'candidate') {
    return {
      title: chord.chordName ? `후보 ${chord.chordName}` : '코드 모양 확인 중',
      detail: `${chord.confidencePercent}% · 손 모양을 유지하고 한 번 스트럼`,
      confirmed: false,
    };
  }
  const needsCalibration = chord.evidence.some((item) => item.includes('보정'));
  return {
    title: needsCalibration ? '지판 보정 필요' : '코드 판정 불가',
    detail: chord.corrections[0] ?? '왼손과 지판을 함께 보여주세요.',
    confirmed: false,
  };
}

export default function LiveMeasurementOverlay({
  result,
  size,
  category,
}: {
  result: ContinuousHandAnalysisResult | null;
  size: Size;
  category: PracticeCategoryId;
}) {
  const trackerRef = useRef(new LiveHandOverlayMotionTracker());
  const [latestChord, setLatestChord] = useState<TimedChord | null>(null);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    if (frame.kind !== 'chord') return;
    setLatestChord({ capturedAt: frame.capturedAt, result: frame.result });
  }), []);

  useEffect(() => {
    trackerRef.current.reset();
    if (!CHORD_CATEGORIES.has(category)) setLatestChord(null);
  }, [category]);

  if (!result?.hasHand || result.landmarks.length < 21 || size.width <= 0 || size.height <= 0) {
    trackerRef.current.reset();
    return null;
  }

  const wrist = result.landmarks[0] ?? null;
  const middleMcp = result.landmarks[9] ?? null;
  const activePoint = activePointFor(result, category);
  const palmSize = wrist && middleMcp ? distance(wrist, middleMcp) : 0;
  const motion = trackerRef.current.process({
    capturedAt: Date.now(),
    wrist,
    activePoint,
    palmSize,
  });
  const bounds = handBounds(result);
  const freshChord = latestChord && Date.now() - latestChord.capturedAt <= 1_800
    ? latestChord.result
    : null;
  const chord = freshChord && CHORD_CATEGORIES.has(category) ? chordLabel(freshChord) : null;

  const radiusPx = motion?.radiusPalmWidths == null
    ? 0
    : clamp(
      motion.radiusPalmWidths * palmSize * Math.min(size.width, size.height),
      18,
      Math.min(size.width, size.height) * 0.30,
    );
  const metricLeft = motion
    ? clamp(motion.end.x * size.width - 82, 6, Math.max(6, size.width - 170))
    : 6;
  const metricTop = motion
    ? clamp(motion.end.y * size.height + 14, 74, Math.max(74, size.height - 112))
    : 74;
  const chordLeft = bounds
    ? clamp(((bounds.minX + bounds.maxX) / 2) * size.width - 88, 6, Math.max(6, size.width - 182))
    : 6;
  const chordTop = bounds
    ? clamp(bounds.maxY * size.height + 12, 70, Math.max(70, size.height - 96))
    : 70;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {motion?.active && motion.angleDegrees != null && motion.radiusPalmWidths != null ? (
        <>
          <Segment from={motion.start} to={motion.end} size={size} />
          <View
            style={[
              styles.radiusCircle,
              {
                width: radiusPx * 2,
                height: radiusPx * 2,
                borderRadius: radiusPx,
                left: motion.wrist.x * size.width - radiusPx,
                top: motion.wrist.y * size.height - radiusPx,
              },
            ]}
          />
          <View style={[styles.metricBadge, { left: metricLeft, top: metricTop }]}>
            <Text style={styles.metricTitle}>
              각도 {Math.round(motion.angleDegrees)}° · 반경 {motion.radiusPalmWidths.toFixed(1)}손바닥
            </Text>
            <Text style={styles.metricDetail}>
              이동 {motion.travelPalmWidths.toFixed(1)}손바닥 · 신뢰 {motion.confidencePercent}%
            </Text>
          </View>
        </>
      ) : null}

      {chord ? (
        <View
          style={[
            styles.chordBadge,
            chord.confirmed ? styles.chordConfirmed : styles.chordCandidate,
            { left: chordLeft, top: chordTop },
          ]}
        >
          <Text style={styles.chordTitle}>{chord.title}</Text>
          <Text style={styles.chordDetail} numberOfLines={2}>{chord.detail}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  motionLine: {
    position: 'absolute',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#f2cc60',
    zIndex: 31,
  },
  radiusCircle: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(242,204,96,0.82)',
    backgroundColor: 'rgba(242,204,96,0.04)',
    zIndex: 30,
  },
  metricBadge: {
    position: 'absolute',
    width: 164,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#f2cc60',
    backgroundColor: 'rgba(13,17,23,0.92)',
    paddingHorizontal: 9,
    paddingVertical: 7,
    zIndex: 36,
  },
  metricTitle: { color: '#fff8c5', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  metricDetail: { color: '#d2a8ff', fontSize: 9, fontWeight: '800', marginTop: 3, textAlign: 'center' },
  chordBadge: {
    position: 'absolute',
    width: 176,
    minHeight: 58,
    borderRadius: 15,
    borderWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 38,
  },
  chordConfirmed: { borderColor: '#7ee787', backgroundColor: 'rgba(22,101,52,0.94)' },
  chordCandidate: { borderColor: '#f2cc60', backgroundColor: 'rgba(65,48,7,0.94)' },
  chordTitle: { color: '#ffffff', fontSize: 21, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
  chordDetail: { color: '#ffffff', fontSize: 9, lineHeight: 13, fontWeight: '800', marginTop: 3, textAlign: 'center' },
});
