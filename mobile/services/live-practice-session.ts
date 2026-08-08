import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import type { MetronomeTimingState } from '../modules/guitar-coach-metronome';
import { evaluateAnalysisQuality } from './analysis-confidence';
import type { LiveAnalysisFrame } from './analysis-stream';
import type { CameraCalibration } from './camera-calibration';
import { nearestStringGuide } from './camera-calibration';
import type { SessionIssue } from './practice-session-store';

export type LiveSessionOptions = {
  category: PracticeCategoryId;
  bpm: number;
  pulsesPerBeat: 1 | 2 | 3 | 4;
  calibration?: CameraCalibration | null;
};

export type LiveSessionSnapshot = {
  averageScore: number | null;
  bestScore: number | null;
  confidencePercent: number;
  stableSeconds: number;
  aiMistakes: number;
  issues: SessionIssue[];
  sampleCounts: {
    pose: number;
    hand: number;
    audio: number;
    validScore: number;
    chord?: number;
    fingering?: number;
  };
  lastStringNumber: number | null;
  timingOffsetMs: number | null;
  timingJitterMs: number | null;
  recognizedChord?: string | null;
  chordStatus?: 'cannot-judge' | 'candidate' | 'confirmed' | null;
  fingeringStatus?: 'cannot-judge' | 'candidate' | 'confirmed' | null;
};

type MetricSample = {
  score: number;
  confidence: number;
  capturedAt: number;
};

type HandTemporalSample = {
  capturedAt: number;
  pinchRatio: number;
  palmAngle: number;
  wristX: number;
  wristY: number;
  pickX: number | null;
  pickY: number | null;
};

type IssueCounter = {
  title: string;
  count: number;
  severity: SessionIssue['severity'];
  confidenceTotal: number;
};

const RIGHT_HAND_SCORE_CATEGORIES = new Set<PracticeCategoryId>([
  'arpeggio',
  'fingerstyle',
  'strumming',
  'downPicking',
  'alternatePicking',
  'palmMute',
]);

const CHORD_SCORE_CATEGORIES = new Set<PracticeCategoryId>([
  'chords',
  'powerChords',
]);

const FINGERING_SCORE_CATEGORIES = new Set<PracticeCategoryId>([
  'fingering',
  'scales',
  'leadTechnique',
]);

const LEFT_HAND_CATEGORIES = new Set<PracticeCategoryId>([
  'chords',
  'fingering',
  'powerChords',
  'scales',
  'leadTechnique',
]);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function landmarkMap<T extends { name: string }>(landmarks: T[]) {
  return new Map(landmarks.map((landmark) => [landmark.name, landmark]));
}

function severityRank(severity: SessionIssue['severity']) {
  return severity === 'high' ? 3 : severity === 'warn' ? 2 : 1;
}

export class LivePracticeSessionAccumulator {
  private readonly options: LiveSessionOptions;
  private readonly startedAt = Date.now();
  private readonly poseSamples: MetricSample[] = [];
  private readonly handSamples: MetricSample[] = [];
  private readonly pickSamples: MetricSample[] = [];
  private readonly timingSamples: MetricSample[] = [];
  private readonly chordSamples: MetricSample[] = [];
  private readonly fingeringSamples: MetricSample[] = [];
  private readonly timingOffsets: number[] = [];
  private readonly handTemporalSamples: HandTemporalSample[] = [];
  private readonly issueCounters = new Map<string, IssueCounter>();
  private readonly issueLastRecordedAt = new Map<string, number>();
  private stableFrameCount = 0;
  private lastStringNumber: number | null = null;
  private latestTimingOffsetMs: number | null = null;
  private latestMetronome: MetronomeTimingState | null = null;
  private lastProcessedAttackCount = -1;
  private latestChordName: string | null = null;
  private latestChordStatus: LiveSessionSnapshot['chordStatus'] = null;
  private latestFingeringStatus: LiveSessionSnapshot['fingeringStatus'] = null;

  constructor(options: LiveSessionOptions) {
    this.options = options;
  }

  updateBpm(bpm: number) {
    this.options.bpm = clamp(Math.round(bpm), 35, 220);
  }

  addFrame(frame: LiveAnalysisFrame) {
    if (frame.kind === 'pose') this.addPoseFrame(frame);
    else if (frame.kind === 'hand') this.addHandFrame(frame);
    else if (frame.kind === 'audio') this.addAudioFrame(frame);
    else if (frame.kind === 'metronome') this.addMetronomeFrame(frame);
    else if (frame.kind === 'chord') this.addChordFrame(frame);
    else this.addFingeringFrame(frame);
  }

  private addIssue(
    id: string,
    title: string,
    severity: SessionIssue['severity'],
    confidencePercent: number,
    capturedAt: number,
  ) {
    const previousAt = this.issueLastRecordedAt.get(id) ?? 0;
    if (capturedAt - previousAt < 1200) return;
    this.issueLastRecordedAt.set(id, capturedAt);
    const current = this.issueCounters.get(id);
    this.issueCounters.set(id, {
      title,
      count: (current?.count ?? 0) + 1,
      severity: !current || severityRank(severity) > severityRank(current.severity) ? severity : current.severity,
      confidenceTotal: (current?.confidenceTotal ?? 0) + confidencePercent,
    });
  }

  private addMetronomeFrame(frame: Extract<LiveAnalysisFrame, { kind: 'metronome' }>) {
    this.latestMetronome = frame.result;
    if (frame.result.running) this.options.bpm = clamp(Math.round(frame.result.bpm), 35, 220);
  }

  private addChordFrame(frame: Extract<LiveAnalysisFrame, { kind: 'chord' }>) {
    if (!CHORD_SCORE_CATEGORIES.has(this.options.category)) return;
    const result = frame.result;
    this.latestChordName = result.chordName;
    this.latestChordStatus = result.status;

    if (
      result.status === 'confirmed'
      && result.score != null
      && result.confidencePercent >= 65
    ) {
      this.chordSamples.push({
        score: clamp(result.score, 0, 100),
        confidence: result.confidencePercent,
        capturedAt: frame.capturedAt,
      });
      if (this.chordSamples.length > 80) this.chordSamples.shift();
      return;
    }

    if (result.status === 'candidate' && result.corrections[0]) {
      this.addIssue(
        `chord-correction-${result.chordName ?? 'candidate'}`,
        result.corrections[0],
        'warn',
        result.confidencePercent,
        frame.capturedAt,
      );
    }
  }

  private addFingeringFrame(frame: Extract<LiveAnalysisFrame, { kind: 'fingering' }>) {
    if (!FINGERING_SCORE_CATEGORIES.has(this.options.category)) return;
    const result = frame.result;
    this.latestFingeringStatus = result.status;

    if (
      result.status === 'confirmed'
      && result.score != null
      && result.confidencePercent >= 65
    ) {
      this.fingeringSamples.push({
        score: clamp(result.score, 0, 100),
        confidence: result.confidencePercent,
        capturedAt: frame.capturedAt,
      });
      if (this.fingeringSamples.length > 80) this.fingeringSamples.shift();
      return;
    }

    if (result.status === 'candidate' && result.corrections[0]) {
      this.addIssue(
        `fingering-correction-${result.targetLabel}`,
        result.corrections[0],
        'warn',
        result.confidencePercent,
        frame.capturedAt,
      );
    }
  }

  private addPoseFrame(frame: Extract<LiveAnalysisFrame, { kind: 'pose' }>) {
    const result = frame.result;
    if (!result.hasPerson || result.landmarks.length < 6) return;
    const points = landmarkMap(result.landmarks);
    const leftShoulder = points.get('leftShoulder');
    const rightShoulder = points.get('rightShoulder');
    const leftHip = points.get('leftHip');
    const rightHip = points.get('rightHip');
    const nose = points.get('nose');
    if (!leftShoulder || !rightShoulder) return;

    const confidence = average(result.landmarks.map((point) => point.confidence));
    const shoulderWidth = distance(leftShoulder, rightShoulder);
    const quality = evaluateAnalysisQuality({
      source: 'pose',
      confidence,
      subjectSize: shoulderWidth,
      sampleCount: 4,
    });
    if (!quality.allowed) return;

    const shoulderTiltRatio = Math.abs(leftShoulder.y - rightShoulder.y) / Math.max(0.01, shoulderWidth);
    const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
    const headOffsetRatio = nose
      ? Math.abs(nose.x - shoulderCenterX) / Math.max(0.01, shoulderWidth)
      : 0;
    const hipCenterX = leftHip && rightHip ? (leftHip.x + rightHip.x) / 2 : shoulderCenterX;
    const torsoOffset = Math.abs(shoulderCenterX - hipCenterX);

    const score = clamp(Math.round(
      100
      - Math.max(0, shoulderTiltRatio - 0.04) * 230
      - Math.max(0, Math.abs(shoulderCenterX - 0.5) - 0.05) * 180
      - Math.max(0, headOffsetRatio - 0.18) * 80
      - Math.max(0, torsoOffset - 0.04) * 160
    ), 0, 100);

    this.poseSamples.push({ score, confidence: quality.confidencePercent, capturedAt: frame.capturedAt });
    if (shoulderTiltRatio > 0.13) this.addIssue('shoulder-tilt', '한쪽 어깨가 올라감', 'warn', quality.confidencePercent, frame.capturedAt);
    if (Math.abs(shoulderCenterX - 0.5) > 0.13) this.addIssue('body-off-center', '상체가 화면 중심에서 벗어남', 'info', quality.confidencePercent, frame.capturedAt);
    if (headOffsetRatio > 0.34) this.addIssue('head-tilt', '고개가 한쪽으로 기울어짐', 'warn', quality.confidencePercent, frame.capturedAt);
    if (torsoOffset > 0.12) this.addIssue('torso-lean', '상체가 옆으로 접힘', 'warn', quality.confidencePercent, frame.capturedAt);
  }

  private addHandFrame(frame: Extract<LiveAnalysisFrame, { kind: 'hand' }>) {
    if (!RIGHT_HAND_SCORE_CATEGORIES.has(this.options.category)) return;

    const result = frame.result;
    if (!result.hasHand || result.landmarks.length < 21) return;
    const points = landmarkMap(result.landmarks);
    const wrist = points.get('wrist');
    const middleMcp = points.get('middleMcp');
    const thumbTip = points.get('thumbTip');
    const indexTip = points.get('indexTip');
    const indexPip = points.get('indexPip');
    const indexMcp = points.get('indexMcp');
    const indexDip = points.get('indexDip');
    if (!wrist || !middleMcp || !thumbTip || !indexTip || !indexPip || !indexMcp || !indexDip) return;

    const palmSize = distance(wrist, middleMcp);
    const confidence = clamp(result.handednessScore || 0.65, 0, 1);
    const quality = evaluateAnalysisQuality({
      source: 'hand',
      confidence,
      subjectSize: palmSize,
      sampleCount: 4,
    });
    if (!quality.allowed) return;

    const pinchRatio = distance(thumbTip, indexTip) / Math.max(0.001, palmSize);
    const palmAngle = Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x) * 180 / Math.PI;
    const previous = this.handTemporalSamples.at(-1);
    const motion = previous
      ? Math.hypot(wrist.x - previous.wristX, wrist.y - previous.wristY)
      : 0;

    this.handTemporalSamples.push({
      capturedAt: frame.capturedAt,
      pinchRatio,
      palmAngle,
      wristX: wrist.x,
      wristY: wrist.y,
      pickX: result.pick.detected ? result.pick.centerX : null,
      pickY: result.pick.detected ? result.pick.centerY : null,
    });
    if (this.handTemporalSamples.length > 120) this.handTemporalSamples.shift();

    const recent = this.handTemporalSamples.slice(-12);
    const pinchVariation = standardDeviation(recent.map((sample) => sample.pinchRatio));
    const palmVariation = standardDeviation(recent.map((sample) => sample.palmAngle));
    const motionPenalty = this.options.category === 'strumming'
      || this.options.category === 'alternatePicking'
      || this.options.category === 'downPicking'
      ? Math.max(0, motion - 0.12) * 120
      : motion * 90;
    const gripPenalty = pinchVariation * 170 + Math.max(0, palmVariation - 8) * 0.7;
    const pinchPenalty = pinchRatio > 0.6
      ? (pinchRatio - 0.6) * 65
      : pinchRatio < 0.05
        ? (0.05 - pinchRatio) * 240
        : 0;
    const score = clamp(Math.round(100 - motionPenalty - gripPenalty - pinchPenalty), 0, 100);

    this.handSamples.push({ score, confidence: quality.confidencePercent, capturedAt: frame.capturedAt });
    if (pinchRatio > 0.6) this.addIssue('wide-pick-grip', '엄지와 검지 간격이 큼', 'warn', quality.confidencePercent, frame.capturedAt);
    if (pinchRatio < 0.05) this.addIssue('tight-pick-grip', '엄지와 검지가 과하게 겹침', 'warn', quality.confidencePercent, frame.capturedAt);
    if (pinchVariation > 0.1) this.addIssue('unstable-grip', '피크 그립 간격이 흔들림', 'warn', quality.confidencePercent, frame.capturedAt);
    if (palmVariation > 22) this.addIssue('wrist-angle-variation', '손목 방향 변화가 큼', 'warn', quality.confidencePercent, frame.capturedAt);

    const automaticString = result.stringTracking;
    const automaticStringReliable = Boolean(
      automaticString
      && automaticString.nearestStringNumber > 0
      && automaticString.nearestDistanceRatio <= 0.82
      && automaticString.confidence >= 0.58
      && (automaticString.audioConfirmed || automaticString.numberingConfidence >= 0.62)
    );
    if (automaticStringReliable && automaticString) {
      this.lastStringNumber = automaticString.nearestStringNumber;
    }

    if (result.pick.detected) {
      const pickQuality = evaluateAnalysisQuality({
        source: 'pick',
        confidence: result.pick.confidence,
        subjectSize: palmSize,
        sampleCount: 4,
      });
      if (pickQuality.allowed) {
        const exposurePenalty = result.pick.exposure < 0.1
          ? (0.1 - result.pick.exposure) * 240
          : result.pick.exposure > 0.9
            ? (result.pick.exposure - 0.9) * 150
            : 0;
        const pickScore = clamp(Math.round(100 - exposurePenalty), 0, 100);
        this.pickSamples.push({ score: pickScore, confidence: pickQuality.confidencePercent, capturedAt: frame.capturedAt });
        if (result.pick.exposure < 0.1) this.addIssue('pick-hidden', '피크가 손가락 안에 너무 많이 숨음', 'warn', pickQuality.confidencePercent, frame.capturedAt);
        if (result.pick.exposure > 0.9) this.addIssue('pick-exposed', '피크 노출량이 너무 큼', 'high', pickQuality.confidencePercent, frame.capturedAt);

        if (!automaticStringReliable && this.options.calibration) {
          const nearest = nearestStringGuide(
            { x: result.pick.centerX, y: result.pick.centerY },
            this.options.calibration,
          );
          if (nearest && nearest.distance <= 0.08) this.lastStringNumber = nearest.guide.stringNumber;
        }
      }
    }
  }

  private addAudioFrame(frame: Extract<LiveAnalysisFrame, { kind: 'audio' }>) {
    const result = frame.result;
    if (!result.running || result.attackCount <= 0 || result.lastAttackAtMs <= 0) return;
    if (result.attackCount === this.lastProcessedAttackCount) return;
    this.lastProcessedAttackCount = result.attackCount;

    const quality = evaluateAnalysisQuality({
      source: 'microphone',
      confidence: Math.max(result.pitchConfidence, Math.min(1, result.attackStrength)),
      noiseFloor: result.noiseFloor,
      clippingRatio: result.clippingRatio,
      sampleCount: result.attackCount,
    });
    if (!quality.allowed) return;

    const metronome = this.latestMetronome;
    const fallbackInterval = 60000 / Math.max(35, this.options.bpm) / this.options.pulsesPerBeat;
    const intervalMs = metronome?.running && metronome.intervalMs > 0
      ? metronome.intervalMs
      : fallbackInterval;
    let offset: number;
    if (metronome?.running && metronome.lastTickElapsedRealtimeMs > 0) {
      const fromLastTick = result.lastAttackAtMs - metronome.lastTickElapsedRealtimeMs;
      offset = fromLastTick - Math.round(fromLastTick / intervalMs) * intervalMs;
    } else if (result.attackIntervalMs > 0) {
      offset = result.attackIntervalMs - intervalMs;
    } else {
      return;
    }

    const absoluteOffset = Math.abs(offset);
    const score = clamp(Math.round(100 - absoluteOffset / Math.max(1, intervalMs * 0.5) * 100), 0, 100);
    this.latestTimingOffsetMs = Math.round(offset);
    this.timingOffsets.push(offset);
    if (this.timingOffsets.length > 120) this.timingOffsets.shift();
    this.timingSamples.push({ score, confidence: quality.confidencePercent, capturedAt: frame.capturedAt });

    if (offset > intervalMs * 0.15) this.addIssue('timing-slow', '클릭보다 늦게 연주함', 'warn', quality.confidencePercent, frame.capturedAt);
    if (offset < -intervalMs * 0.15) this.addIssue('timing-fast', '클릭보다 빠르게 연주함', 'warn', quality.confidencePercent, frame.capturedAt);
    const recentJitter = standardDeviation(this.timingOffsets.slice(-12));
    if (this.timingOffsets.length >= 6 && recentJitter > Math.min(65, intervalMs * 0.18)) {
      this.addIssue('timing-jitter', '박자 앞뒤 흔들림이 큼', 'warn', quality.confidencePercent, frame.capturedAt);
    }
    if (result.clippingRatio > 0.015) this.addIssue('audio-near-clipping', '앰프 또는 기타 입력이 너무 큼', 'info', quality.confidencePercent, frame.capturedAt);
  }

  snapshot(): LiveSessionSnapshot {
    const rightHandSession = RIGHT_HAND_SCORE_CATEGORIES.has(this.options.category);
    const chordSession = CHORD_SCORE_CATEGORIES.has(this.options.category);
    const fingeringSession = FINGERING_SCORE_CATEGORIES.has(this.options.category);
    const leftHandSession = LEFT_HAND_CATEGORIES.has(this.options.category);

    let metricGroups: Array<{ samples: MetricSample[]; weight: number }> = [];
    if (rightHandSession) {
      metricGroups = [
        { samples: this.poseSamples, weight: 0.2 },
        { samples: this.handSamples, weight: 0.4 },
        { samples: this.pickSamples, weight: 0.15 },
        { samples: this.timingSamples, weight: 0.25 },
      ].filter((group) => group.samples.length >= 4);
    } else if (chordSession && this.chordSamples.length >= 2) {
      metricGroups = [
        { samples: this.chordSamples, weight: 0.82 },
        { samples: this.timingSamples, weight: 0.18 },
      ].filter((group) => group.samples.length >= 2);
    } else if (fingeringSession && this.fingeringSamples.length >= 2) {
      metricGroups = [
        { samples: this.fingeringSamples, weight: 0.82 },
        { samples: this.timingSamples, weight: 0.18 },
      ].filter((group) => group.samples.length >= 2);
    } else if (!leftHandSession) {
      metricGroups = [
        { samples: this.poseSamples, weight: 0.5 },
        { samples: this.timingSamples, weight: 0.5 },
      ].filter((group) => group.samples.length >= 4);
    }

    const weightedScores: Array<{ score: number; confidence: number; weight: number }> = metricGroups.map((group) => ({
      score: average(group.samples.map((sample) => sample.score)),
      confidence: average(group.samples.map((sample) => sample.confidence)),
      weight: group.weight,
    }));
    const weightTotal = weightedScores.reduce((sum, metric) => sum + metric.weight, 0);
    const averageScore = weightTotal > 0
      ? Math.round(weightedScores.reduce((sum, metric) => sum + metric.score * metric.weight, 0) / weightTotal)
      : null;
    const confidencePercent = weightTotal > 0
      ? Math.round(weightedScores.reduce((sum, metric) => sum + metric.confidence * metric.weight, 0) / weightTotal)
      : 0;

    if (averageScore != null && averageScore >= 82 && confidencePercent >= 65) this.stableFrameCount += 1;
    const scoredSamples = metricGroups.flatMap((group) => group.samples);
    const bestScore = scoredSamples.length ? Math.max(...scoredSamples.map((sample) => sample.score)) : null;
    const issues = [...this.issueCounters.entries()]
      .map(([id, issue]) => ({
        id,
        title: issue.title,
        count: issue.count,
        severity: issue.severity,
        confidencePercent: Math.round(issue.confidenceTotal / Math.max(1, issue.count)),
      }))
      .filter((issue) => issue.confidencePercent >= 55)
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count)
      .slice(0, 6);

    return {
      averageScore,
      bestScore,
      confidencePercent,
      stableSeconds: Math.min(
        Math.round((Date.now() - this.startedAt) / 1000),
        Math.round(this.stableFrameCount * 0.5),
      ),
      aiMistakes: issues.reduce((sum, issue) => sum + issue.count, 0),
      issues,
      sampleCounts: {
        pose: this.poseSamples.length,
        hand: this.handSamples.length,
        audio: this.timingSamples.length,
        chord: this.chordSamples.length,
        fingering: this.fingeringSamples.length,
        validScore: scoredSamples.length,
      },
      lastStringNumber: this.lastStringNumber,
      timingOffsetMs: this.latestTimingOffsetMs,
      timingJitterMs: this.timingOffsets.length >= 2
        ? Math.round(standardDeviation(this.timingOffsets.slice(-20)))
        : null,
      recognizedChord: this.latestChordName,
      chordStatus: this.latestChordStatus,
      fingeringStatus: this.latestFingeringStatus,
    };
  }
}
