import { MultiAngleRightHandTechniqueAnalyzer } from './multi-angle-right-hand.js';

const STORAGE_KEY = 'guitar-coach.personal-technique-calibration.v1';
const PROFILE_VERSION = 1;
const REQUIRED_SAMPLES = 24;
const REQUIRED_MOTION_SAMPLES = 10;
const COLLECT_INTERVAL_MS = 110;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value)));

function validPoint(point) {
  return Boolean(point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
}

function distance(left, right) {
  if (!validPoint(left) || !validPoint(right)) return Infinity;
  return Math.hypot(
    finite(left.x) - finite(right.x),
    finite(left.y) - finite(right.y),
    (finite(left.z) - finite(right.z)) * 0.45,
  );
}

function median(values = []) {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (!usable.length) return 0;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

function handGeometry(hand) {
  const landmarks = hand?.landmarks || [];
  if (landmarks.length !== 21) return null;
  const palmScale = median([
    distance(landmarks[0], landmarks[5]),
    distance(landmarks[0], landmarks[9]),
    distance(landmarks[0], landmarks[17]),
    distance(landmarks[5], landmarks[17]),
  ]);
  const pinchDistance = distance(landmarks[4], landmarks[8]);
  if (!(palmScale > 0) || !Number.isFinite(pinchDistance)) return null;
  return {
    palmScale,
    pinchRatio: pinchDistance / Math.max(0.02, palmScale),
  };
}

export function calibrationViewBucket(view = 'front') {
  const known = new Set([
    'front', 'left-oblique', 'right-oblique', 'left-side', 'right-side',
    'high', 'low', 'rolled',
  ]);
  return known.has(view) ? view : 'front';
}

function emptyBucket() {
  return {
    samples: 0,
    motionSamples: 0,
    eventSamples: 0,
    updatedAt: 0,
    means: {},
    weights: {},
  };
}

function emptyProfile() {
  return {
    version: PROFILE_VERSION,
    updatedAt: 0,
    buckets: { global: emptyBucket() },
  };
}

function sanitizeBucket(candidate) {
  const bucket = emptyBucket();
  if (!candidate || typeof candidate !== 'object') return bucket;
  bucket.samples = Math.max(0, Math.round(finite(candidate.samples)));
  bucket.motionSamples = Math.max(0, Math.round(finite(candidate.motionSamples)));
  bucket.eventSamples = Math.max(0, Math.round(finite(candidate.eventSamples)));
  bucket.updatedAt = Math.max(0, finite(candidate.updatedAt));
  for (const [name, value] of Object.entries(candidate.means || {})) {
    if (Number.isFinite(Number(value))) bucket.means[name] = Number(value);
  }
  for (const [name, value] of Object.entries(candidate.weights || {})) {
    if (Number.isFinite(Number(value)) && Number(value) > 0) bucket.weights[name] = Number(value);
  }
  return bucket;
}

function sanitizeProfile(candidate) {
  if (!candidate || candidate.version !== PROFILE_VERSION || typeof candidate.buckets !== 'object') return emptyProfile();
  const profile = emptyProfile();
  profile.updatedAt = Math.max(0, finite(candidate.updatedAt));
  for (const [name, bucket] of Object.entries(candidate.buckets)) {
    profile.buckets[name] = sanitizeBucket(bucket);
  }
  if (!profile.buckets.global) profile.buckets.global = emptyBucket();
  return profile;
}

function browserStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Storage can be denied in private or embedded browser contexts.
  }
  return null;
}

function loadProfile(storage, storageKey) {
  if (!storage?.getItem) return emptyProfile();
  try {
    return sanitizeProfile(JSON.parse(storage.getItem(storageKey) || 'null'));
  } catch {
    return emptyProfile();
  }
}

function progressFor(bucket) {
  if (!bucket) return 0;
  return clamp(Math.min(
    finite(bucket.samples) / REQUIRED_SAMPLES,
    finite(bucket.motionSamples) / REQUIRED_MOTION_SAMPLES,
  ));
}

function bucketReady(bucket) {
  return Boolean(bucket
    && bucket.samples >= REQUIRED_SAMPLES
    && bucket.motionSamples >= REQUIRED_MOTION_SAMPLES);
}

function robustValue(bucket, name, value) {
  const current = finite(bucket?.means?.[name], NaN);
  const weight = finite(bucket?.weights?.[name]);
  if (!Number.isFinite(current) || weight < 7 || !(current > 0)) return value;
  return clamp(value, current * 0.58, current * 1.72);
}

function updateMean(bucket, name, input, sampleWeight = 1) {
  const numeric = finite(input, NaN);
  if (!Number.isFinite(numeric) || numeric < 0 || !(sampleWeight > 0)) return;
  const value = robustValue(bucket, name, numeric);
  const previousWeight = finite(bucket.weights[name]);
  const nextWeight = previousWeight + sampleWeight;
  const previousMean = finite(bucket.means[name], value);
  bucket.means[name] = previousMean + (value - previousMean) * sampleWeight / nextWeight;
  bucket.weights[name] = nextWeight;
}

function updateBucket(bucket, metrics, now, active, eventActive) {
  bucket.samples += 1;
  if (active) bucket.motionSamples += 1;
  if (eventActive) bucket.eventSamples += 1;
  bucket.updatedAt = now;
  for (const [name, value] of Object.entries(metrics)) updateMean(bucket, name, value);
}

function ratioSimilarity(current, expected, tolerance = 0.38) {
  if (!(current > 0) || !(expected > 0)) return null;
  const logDistance = Math.abs(Math.log(current / expected));
  return clamp(1 - logDistance / tolerance);
}

function baselineSimilarity(metrics, tuning) {
  const scores = [
    ratioSimilarity(metrics.palmScale, tuning.palmScale, 0.34),
    ratioSimilarity(metrics.bandWidth, tuning.bandWidth, 0.42),
    ratioSimilarity(metrics.pinchRatio, tuning.pinchRatio, 0.55),
  ].filter(Number.isFinite);
  return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
}

function currentMetrics({ hand, band, result }) {
  const geometry = handGeometry(hand);
  const bandWidth = band ? finite(band.bottom) - finite(band.top) : 0;
  return {
    palmScale: geometry?.palmScale || finite(hand?.pickPoint?.palmScale),
    pinchRatio: geometry?.pinchRatio || finite(hand?.pickPoint?.pinchRatio),
    bandWidth: bandWidth > 0 ? bandWidth : 0,
    wristRatio: clamp(result.wristRatio),
    armRatio: clamp(result.armRatio),
    strumSps: Math.max(0, finite(result.strumSps)),
    pickingSps: Math.max(0, finite(result.pickingSps)),
    threeFingerSps: Math.max(0, finite(result.threeFingerSps)),
  };
}

function tuningFrom(bucket, confidence, source, bucketName) {
  if (!bucket) return null;
  return {
    palmScale: finite(bucket.means.palmScale),
    pinchRatio: finite(bucket.means.pinchRatio),
    bandWidth: finite(bucket.means.bandWidth),
    wristRatio: finite(bucket.means.wristRatio),
    armRatio: finite(bucket.means.armRatio),
    strumSps: finite(bucket.means.strumSps),
    pickingSps: finite(bucket.means.pickingSps),
    threeFingerSps: finite(bucket.means.threeFingerSps),
    confidence: clamp(confidence),
    source,
    bucket: bucketName,
    samples: bucket.samples,
  };
}

export class PersonalizedRightHandTechniqueAnalyzer {
  constructor({
    analyzer = new MultiAngleRightHandTechniqueAnalyzer(),
    storage = browserStorage(),
    storageKey = STORAGE_KEY,
  } = {}) {
    this.analyzer = analyzer;
    this.storage = storage;
    this.storageKey = storageKey;
    this.profile = loadProfile(storage, storageKey);
    this.lastCollectedAt = new Map();
    this.unsavedSamples = 0;
  }

  reset() {
    this.analyzer.reset();
    this.lastCollectedAt.clear();
  }

  clearPersonalCalibration() {
    this.profile = emptyProfile();
    this.lastCollectedAt.clear();
    this.unsavedSamples = 0;
    try { this.storage?.removeItem?.(this.storageKey); } catch { /* ignored */ }
  }

  persist(force = false) {
    if (!this.storage?.setItem || (!force && this.unsavedSamples < 6)) return;
    try {
      this.profile.updatedAt = Date.now();
      this.storage.setItem(this.storageKey, JSON.stringify(this.profile));
      this.unsavedSamples = 0;
    } catch {
      // Recognition continues even when browser storage is unavailable.
    }
  }

  update(input = {}) {
    const result = this.analyzer.update(input);
    const now = finite(input.timestamp, Date.now());
    const bucketName = calibrationViewBucket(result.cameraView);
    const bucket = this.profile.buckets[bucketName] || (this.profile.buckets[bucketName] = emptyBucket());
    const global = this.profile.buckets.global || (this.profile.buckets.global = emptyBucket());
    const metrics = currentMetrics({ hand: input.hand, band: input.band, result });
    const active = ['wrist', 'arm', 'mixed'].includes(result.movementType)
      && finite(result.movementConfidence) >= 0.32;
    const eventActive = Boolean(input.strokeEvent || result.pickingEvent || result.fingerEvent);
    const geometryReady = metrics.palmScale > 0.025
      && metrics.bandWidth > 0.006
      && metrics.pinchRatio > 0
      && result.poseReady
      && result.angleCorrectionReady
      && finite(result.angleCorrectionConfidence) >= 0.3;
    const lastAt = finite(this.lastCollectedAt.get(bucketName));

    if (geometryReady && active && now - lastAt >= COLLECT_INTERVAL_MS) {
      const wasReady = bucketReady(bucket);
      updateBucket(bucket, metrics, now, active, eventActive);
      updateBucket(global, metrics, now, active, eventActive);
      this.lastCollectedAt.set(bucketName, now);
      this.unsavedSamples += 1;
      if (!wasReady && bucketReady(bucket)) this.persist(true);
      else this.persist(false);
    }

    const localProgress = progressFor(bucket);
    const globalProgress = progressFor(global);
    const localReady = bucketReady(bucket);
    const globalReady = bucketReady(global);
    const angleConfidence = clamp(result.angleCorrectionConfidence);
    let tuning = null;
    let source = 'learning';
    if (localReady || bucket.samples >= 8) {
      source = localReady ? 'angle-personal' : 'angle-learning';
      tuning = tuningFrom(bucket, localProgress * angleConfidence, source, bucketName);
    } else if (globalReady || global.samples >= 8) {
      source = globalReady ? 'global-personal' : 'global-learning';
      tuning = tuningFrom(global, globalProgress * angleConfidence * 0.78, source, 'global');
    }

    const similarity = tuning ? baselineSimilarity(metrics, tuning) : 0;
    const readyCount = Object.entries(this.profile.buckets)
      .filter(([name, entry]) => name !== 'global' && bucketReady(entry)).length;
    let feedback = '개인 자동 보정 학습 중 · 자연스럽게 연주하세요';
    if (!geometryReady) feedback = '손·팔·기타줄이 보이면 개인 보정을 계속합니다';
    else if (localReady && similarity >= 0.48) feedback = `개인 기준 적용 · ${result.cameraViewLabel || bucketName}`;
    else if (localReady) feedback = '개인 기준과 차이가 큼 · 평소 안정된 자세로 돌아오세요';
    else if (globalReady) feedback = '공통 개인 기준 적용 · 현재 각도를 추가 학습 중';

    return {
      ...result,
      personalCalibrationVersion: PROFILE_VERSION,
      personalCalibrationBucket: bucketName,
      personalCalibrationProgress: localProgress,
      personalCalibrationReady: localReady,
      personalCalibrationGlobalReady: globalReady,
      personalCalibrationSamples: bucket.samples,
      personalCalibrationMotionSamples: bucket.motionSamples,
      personalCalibrationCoverage: readyCount,
      personalCalibrationSource: source,
      personalCalibrationTuning: tuning,
      personalBaselineSimilarity: similarity,
      personalCalibrationFeedback: feedback,
      personalProfileUpdatedAt: this.profile.updatedAt,
    };
  }
}

export const PERSONAL_TECHNIQUE_CALIBRATION_STORAGE_KEY = STORAGE_KEY;
