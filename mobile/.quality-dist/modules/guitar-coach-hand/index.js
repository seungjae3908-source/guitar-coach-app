"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAutomaticStringVisionAvailable = exports.isDetailedHandCoachAvailable = void 0;
exports.analyzeHandWithStringsAsync = analyzeHandWithStringsAsync;
exports.analyzeHandAsync = analyzeHandAsync;
const expo_1 = require("expo");
const analysis_stream_1 = require("../../services/analysis-stream");
const practice_session_context_1 = require("../../services/practice-session-context");
const hand_precision_region_1 = require("../../services/hand-precision-region");
const NativeModule = (0, expo_1.requireOptionalNativeModule)('GuitarCoachHand');
const StringVisionModule = (0, expo_1.requireOptionalNativeModule)('GuitarCoachStringVision');
exports.isDetailedHandCoachAvailable = Boolean(NativeModule?.androidHandCoachAvailable);
exports.isAutomaticStringVisionAvailable = Boolean(StringVisionModule?.androidStringVisionAvailable);
const trackingHistory = [];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function isGuitarStringNumber(value) {
    return Number.isInteger(value) && value >= 1 && value <= 6;
}
function mean(values) {
    if (!values.length)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function median(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function standardDeviation(values) {
    if (values.length < 2)
        return 0;
    const average = mean(values);
    return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}
function pointToLineDistance(point, line) {
    const abX = line.endX - line.startX;
    const abY = line.endY - line.startY;
    const denominator = Math.max(0.000001, abX * abX + abY * abY);
    const amount = Math.min(1, Math.max(0, ((point.x - line.startX) * abX + (point.y - line.startY) * abY) / denominator));
    return Math.hypot(point.x - (line.startX + abX * amount), point.y - (line.startY + abY * amount));
}
function averageLineSpacing(lines) {
    const ordered = [...lines].sort((a, b) => a.visualIndex - b.visualIndex);
    const distances = ordered.slice(1).map((line, index) => {
        const previous = ordered[index];
        return Math.hypot((line.startX + line.endX - previous.startX - previous.endX) / 2, (line.startY + line.endY - previous.startY - previous.endY) / 2);
    }).filter((value) => value > 0.001);
    return distances.length ? mean(distances) : 0.03;
}
function palmSize(result) {
    if (!result.hasHand || result.landmarks.length < 10)
        return 0;
    return (0, hand_precision_region_1.effectiveHandDetailSize)({ landmarks: result.landmarks, precision: result.precision });
}
function shouldPublishForCoach(result, pickColor) {
    const context = (0, practice_session_context_1.getLivePracticeContext)();
    if (!context?.active)
        return true;
    const rightHandCategory = context.category === 'arpeggio'
        || context.category === 'fingerstyle'
        || context.category === 'strumming'
        || context.category === 'downPicking'
        || context.category === 'alternatePicking'
        || context.category === 'palmMute';
    const leftHandCategory = context.category === 'chords'
        || context.category === 'fingering'
        || context.category === 'powerChords'
        || context.category === 'scales'
        || context.category === 'leadTechnique';
    if (pickColor === 'auto')
        return rightHandCategory;
    if (pickColor === 'none')
        return leftHandCategory && (0, hand_precision_region_1.hasUsableHandDetail)(result);
    return rightHandCategory;
}
function buildStringRegion(hand) {
    const tips = [4, 8, 12, 16, 20]
        .map((index) => hand.landmarks[index])
        .filter((point) => Boolean(point));
    const ys = hand.landmarks.map((point) => point.y);
    const focusPoints = hand.pick.detected && hand.pick.confidence >= 0.38
        ? [{ x: hand.pick.centerX, y: hand.pick.centerY }]
        : tips;
    const focusX = focusPoints.length ? mean(focusPoints.map((point) => point.x)) : 0.5;
    const focusY = focusPoints.length ? mean(focusPoints.map((point) => point.y)) : 0.5;
    let top = clamp(Math.min(...ys, focusY) - 0.23, 0.01, 0.95);
    let bottom = clamp(Math.max(...ys, focusY) + 0.23, 0.05, 0.99);
    if (bottom - top < 0.42) {
        const center = (top + bottom) / 2;
        top = clamp(center - 0.21, 0.01, 0.57);
        bottom = clamp(center + 0.21, 0.43, 0.99);
    }
    return { left: 0.01, top, right: 0.99, bottom, focusX: clamp(focusX, 0, 1), focusY: clamp(focusY, 0, 1) };
}
function dominantStringOrder(samples) {
    const scores = new Map();
    samples.forEach((sample) => {
        if (sample.stringOrder === 'unknown')
            return;
        scores.set(sample.stringOrder, (scores.get(sample.stringOrder) ?? 0) + sample.confidence * sample.numberingConfidence);
    });
    const winner = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!winner || winner[1] < 0.72)
        return 'unknown';
    return winner[0];
}
function stabilizeTracking(next) {
    const now = Date.now();
    while (trackingHistory[0] && now - trackingHistory[0].capturedAt > 1_900)
        trackingHistory.shift();
    if (!next.detected || next.lines.length < 4) {
        return { ...next, stabilityConfidence: 0, contacts: [] };
    }
    trackingHistory.push({ capturedAt: now, tracking: { ...next, contacts: undefined } });
    while (trackingHistory.length > 7)
        trackingHistory.shift();
    const compatible = trackingHistory
        .filter((entry) => now - entry.capturedAt <= 1_900 && Math.abs(entry.tracking.angleDegrees - next.angleDegrees) <= 13)
        .slice(-5)
        .map((entry) => entry.tracking);
    const angleValues = compatible.map((sample) => sample.angleDegrees);
    const angleDegrees = median(angleValues);
    const lines = [];
    for (let visualIndex = 1; visualIndex <= 6; visualIndex = (visualIndex + 1)) {
        const matching = compatible
            .map((sample) => sample.lines.find((line) => line.visualIndex === visualIndex))
            .filter((line) => Boolean(line));
        if (!matching.length)
            continue;
        lines.push({
            visualIndex,
            stringNumber: 0,
            startX: median(matching.map((line) => line.startX)),
            startY: median(matching.map((line) => line.startY)),
            endX: median(matching.map((line) => line.endX)),
            endY: median(matching.map((line) => line.endY)),
            strength: median(matching.map((line) => line.strength)),
        });
    }
    const stringOrder = dominantStringOrder(compatible);
    const orderSamples = compatible.filter((sample) => sample.stringOrder === stringOrder);
    const numberingConfidence = stringOrder === 'unknown' ? 0 : mean(orderSamples.map((sample) => sample.numberingConfidence));
    const normalizedLines = lines.map((line) => {
        const stringNumber = numberingConfidence >= 0.62
            ? (stringOrder === 'low-to-high' ? 7 - line.visualIndex : line.visualIndex)
            : 0;
        return { ...line, stringNumber };
    });
    const confidence = mean(compatible.map((sample) => sample.confidence));
    const stabilityConfidence = clamp(compatible.length / 5 * 0.46
        + (1 - clamp(standardDeviation(angleValues) / 11, 0, 1)) * 0.24
        + confidence * 0.30, 0, 1);
    const visibleLineCount = normalizedLines.filter((line) => line.strength >= 0.28).length;
    return {
        ...next,
        detected: normalizedLines.length >= 5 && visibleLineCount >= 4 && confidence >= 0.38,
        confidence,
        angleDegrees,
        visibleLineCount,
        stringOrder,
        numberingConfidence,
        stabilityConfidence,
        nearestVisualIndex: 0,
        nearestStringNumber: 0,
        nearestDistanceRatio: 1,
        contacts: [],
        lines: normalizedLines,
    };
}
function liveAudioCandidates() {
    const frame = (0, analysis_stream_1.getLatestLiveAnalysisFrames)().audio;
    if (!frame || Date.now() - frame.capturedAt > 850)
        return null;
    const audio = frame.result;
    if (!audio.hasPitch || audio.pitchConfidence < 0.58 || audio.frequencyHz <= 0)
        return null;
    const midi = 69 + 12 * Math.log2(audio.frequencyHz / 440);
    const openMidi = [
        { stringNumber: 6, midi: 40 },
        { stringNumber: 5, midi: 45 },
        { stringNumber: 4, midi: 50 },
        { stringNumber: 3, midi: 55 },
        { stringNumber: 2, midi: 59 },
        { stringNumber: 1, midi: 64 },
    ];
    const candidates = openMidi
        .filter((item) => midi >= item.midi - 0.45 && midi <= item.midi + 24.45)
        .map((item) => item.stringNumber);
    return { candidates, frequencyHz: audio.frequencyHz, confidence: audio.pitchConfidence };
}
function nearestLine(point, lines) {
    return lines
        .map((line) => ({ line, distance: pointToLineDistance(point, line) }))
        .sort((a, b) => a.distance - b.distance)[0];
}
function estimatedPickTip(hand, lines) {
    const center = { x: hand.pick.centerX, y: hand.pick.centerY };
    if (!hand.pick.detected || hand.pick.confidence < 0.36)
        return center;
    const radians = hand.pick.angleDegrees * Math.PI / 180;
    const length = clamp(palmSize(hand) * 0.34 + hand.pick.exposure * 0.025, 0.025, 0.085);
    const candidates = [
        center,
        { x: clamp(center.x + Math.cos(radians) * length, 0, 1), y: clamp(center.y + Math.sin(radians) * length, 0, 1) },
        { x: clamp(center.x - Math.cos(radians) * length, 0, 1), y: clamp(center.y - Math.sin(radians) * length, 0, 1) },
    ];
    return candidates.sort((a, b) => (nearestLine(a, lines)?.distance ?? 1) - (nearestLine(b, lines)?.distance ?? 1))[0];
}
function buildContacts(tracking, hand) {
    const spacing = Math.max(0.004, averageLineSpacing(tracking.lines));
    const specifications = [
        {
            id: 'pick',
            label: '피크',
            point: hand.pick.detected ? estimatedPickTip(hand, tracking.lines) : null,
            baseConfidence: hand.pick.confidence,
        },
        { id: 'thumb', label: 'P', point: hand.landmarks[4] ?? null, baseConfidence: hand.handednessScore },
        { id: 'index', label: 'i', point: hand.landmarks[8] ?? null, baseConfidence: hand.handednessScore },
        { id: 'middle', label: 'm', point: hand.landmarks[12] ?? null, baseConfidence: hand.handednessScore },
        { id: 'ring', label: 'a', point: hand.landmarks[16] ?? null, baseConfidence: hand.handednessScore },
        { id: 'pinky', label: '새끼', point: hand.landmarks[20] ?? null, baseConfidence: hand.handednessScore },
    ];
    return specifications.flatMap((specification) => {
        if (!specification.point)
            return [];
        const nearest = nearestLine(specification.point, tracking.lines);
        const distanceRatio = nearest ? nearest.distance / spacing : 2;
        const visualIndex = nearest && distanceRatio <= 1.18 ? nearest.line.visualIndex : 0;
        const stringNumber = nearest
            && distanceRatio <= 0.78
            && tracking.confidence >= 0.50
            && (tracking.stabilityConfidence ?? 0) >= 0.38
            && tracking.numberingConfidence >= 0.62
            && isGuitarStringNumber(nearest.line.stringNumber)
            ? nearest.line.stringNumber
            : 0;
        const proximity = clamp(1 - distanceRatio / 1.22, 0, 1);
        const confidence = clamp(specification.baseConfidence * 0.38
            + tracking.confidence * 0.24
            + (tracking.stabilityConfidence ?? 0) * 0.18
            + proximity * 0.20, 0, 1);
        return [{
                id: specification.id,
                label: specification.label,
                x: specification.point.x,
                y: specification.point.y,
                visualIndex,
                stringNumber,
                distanceRatio: Math.round(distanceRatio * 100) / 100,
                confidence,
                source: stringNumber > 0 ? 'vision' : 'unresolved',
            }];
    });
}
function fuseContacts(tracking, hand) {
    if (!tracking.detected || tracking.lines.length < 4 || !hand.hasHand)
        return tracking;
    let contacts = buildContacts(tracking, hand);
    const pickContact = contacts.find((contact) => contact.id === 'pick' && contact.distanceRatio <= 1.18);
    let primary = pickContact ?? [...contacts]
        .filter((contact) => contact.visualIndex > 0)
        .sort((a, b) => a.distanceRatio - b.distanceRatio)[0];
    const audio = liveAudioCandidates();
    let audioConfirmed = false;
    if (audio?.candidates.length === 1) {
        const closeContacts = contacts.filter((contact) => contact.visualIndex > 0 && contact.distanceRatio <= 0.58);
        const audioTarget = pickContact && pickContact.distanceRatio <= 0.58
            ? pickContact
            : closeContacts.length === 1
                ? closeContacts[0]
                : null;
        if (audioTarget && (audioTarget.stringNumber === 0 || audioTarget.stringNumber === audio.candidates[0])) {
            contacts = contacts.map((contact) => contact.id === audioTarget.id
                ? { ...contact, stringNumber: audio.candidates[0], source: 'vision-audio', confidence: clamp(contact.confidence + 0.08, 0, 1) }
                : contact);
            primary = contacts.find((contact) => contact.id === audioTarget.id) ?? primary;
            audioConfirmed = true;
        }
    }
    return {
        ...tracking,
        nearestVisualIndex: primary?.visualIndex ?? 0,
        nearestStringNumber: primary?.stringNumber ?? 0,
        nearestDistanceRatio: primary?.distanceRatio ?? 1,
        primaryContactId: primary?.id,
        contacts,
        audioConfirmed,
        audioCandidateStrings: audio?.candidates ?? [],
        audioFrequencyHz: audio?.frequencyHz,
        audioConfidence: audio?.confidence,
    };
}
async function analyzeHandRawAsync(uri, pickColor) {
    if (!NativeModule)
        throw new Error('손가락 상세 분석 모듈을 사용할 수 없습니다.');
    return NativeModule.analyzeHandAsync(uri, pickColor);
}
async function analyzeStringsForHandAsync(uri, hand) {
    if (!StringVisionModule?.androidStringVisionAvailable || !hand.hasHand)
        return null;
    const region = buildStringRegion(hand);
    if (StringVisionModule.androidAdaptiveStringRegionAvailable && StringVisionModule.analyzeStringsInRegionAsync) {
        return StringVisionModule.analyzeStringsInRegionAsync(uri, region.left, region.top, region.right, region.bottom, region.focusX, region.focusY);
    }
    return StringVisionModule.analyzeStringsAsync(uri);
}
function finish(result, pickColor) {
    if (shouldPublishForCoach(result, pickColor)) {
        (0, analysis_stream_1.publishLiveAnalysisFrame)({ kind: 'hand', capturedAt: Date.now(), result });
    }
    return result;
}
let cachedStringTracking = null;
async function analyzeHandWithStringsAsync(uri, pickColor, options = {}) {
    const hand = await analyzeHandRawAsync(uri, pickColor);
    if (!hand.hasHand)
        return finish(hand, pickColor);
    const now = Date.now();
    const reuseMs = options.reuseStringVisionMs ?? 1_250;
    const shouldRefresh = options.refreshStringVision !== false
        || !cachedStringTracking
        || now - cachedStringTracking.capturedAt > reuseMs;
    let tracking = cachedStringTracking?.tracking ?? null;
    if (shouldRefresh) {
        try {
            const rawTracking = await analyzeStringsForHandAsync(uri, hand);
            tracking = rawTracking ? stabilizeTracking(rawTracking) : null;
            if (tracking?.detected)
                cachedStringTracking = { capturedAt: now, tracking };
        }
        catch {
            tracking = cachedStringTracking && now - cachedStringTracking.capturedAt <= reuseMs
                ? cachedStringTracking.tracking
                : null;
        }
    }
    const result = tracking ? { ...hand, stringTracking: fuseContacts(tracking, hand) } : hand;
    return finish(result, pickColor);
}
async function analyzeHandAsync(uri, pickColor) {
    return analyzeHandWithStringsAsync(uri, pickColor, { refreshStringVision: true });
}
