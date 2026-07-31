"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContinuousTrackingQualityGate = void 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function mean(values) {
    if (!values.length)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function median(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function standardDeviation(values) {
    if (values.length < 2)
        return 0;
    const average = mean(values);
    return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}
function distance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y);
}
function palmSize(result) {
    const wrist = result.landmarks[0];
    const middleMcp = result.landmarks[9];
    return wrist && middleMcp ? distance(wrist, middleMcp) : 0;
}
function lineCenter(line) {
    return {
        x: (line.startX + line.endX) / 2,
        y: (line.startY + line.endY) / 2,
    };
}
function lineAngle(line) {
    return Math.atan2(line.endY - line.startY, line.endX - line.startX) * 180 / Math.PI;
}
function pointToLineDistance(point, line) {
    const abX = line.endX - line.startX;
    const abY = line.endY - line.startY;
    const denominator = Math.max(0.000001, abX * abX + abY * abY);
    const amount = clamp(((point.x - line.startX) * abX + (point.y - line.startY) * abY) / denominator, 0, 1);
    return Math.hypot(point.x - (line.startX + abX * amount), point.y - (line.startY + abY * amount));
}
function isStringNumber(value) {
    return Number.isInteger(value) && value >= 1 && value <= 6;
}
function sortedLines(tracking) {
    return [...tracking.lines]
        .filter((line) => line.visualIndex >= 1 && line.visualIndex <= 6)
        .sort((left, right) => left.visualIndex - right.visualIndex);
}
function lineGeometry(tracking) {
    const lines = sortedLines(tracking);
    const centers = lines.map(lineCenter);
    const spacings = centers.slice(1).map((center, index) => distance(center, centers[index]));
    const angles = lines.map(lineAngle);
    return {
        lines,
        spacingMean: mean(spacings),
        spacingVariation: mean(spacings) > 0 ? standardDeviation(spacings) / mean(spacings) : 1,
        angleVariation: standardDeviation(angles),
    };
}
function compatibleTracking(left, right) {
    const leftGeometry = lineGeometry(left);
    const rightGeometry = lineGeometry(right);
    if (leftGeometry.lines.length < 5 || rightGeometry.lines.length < 5)
        return false;
    if (Math.abs(left.angleDegrees - right.angleDegrees) > 6.5)
        return false;
    const ratio = Math.max(leftGeometry.spacingMean, rightGeometry.spacingMean)
        / Math.max(0.0001, Math.min(leftGeometry.spacingMean, rightGeometry.spacingMean));
    if (ratio > 1.42)
        return false;
    const leftCenter = lineCenter(leftGeometry.lines[Math.floor(leftGeometry.lines.length / 2)]);
    const rightCenter = lineCenter(rightGeometry.lines[Math.floor(rightGeometry.lines.length / 2)]);
    return distance(leftCenter, rightCenter) <= Math.max(leftGeometry.spacingMean, rightGeometry.spacingMean) * 1.35;
}
function roiMatchesCurrentHand(tracking, hand) {
    const left = tracking.roiLeft;
    const right = tracking.roiRight;
    const top = tracking.roiTop;
    const bottom = tracking.roiBottom;
    if (left == null || right == null || top == null || bottom == null)
        return false;
    const tips = [4, 8, 12, 16, 20]
        .map((index) => hand.landmarks[index])
        .filter((point) => Boolean(point));
    if (!tips.length)
        return false;
    const center = {
        x: median(tips.map((point) => point.x)),
        y: median(tips.map((point) => point.y)),
    };
    const marginX = Math.max(0.04, (right - left) * 0.15);
    const marginY = Math.max(0.04, (bottom - top) * 0.22);
    return center.x >= left - marginX
        && center.x <= right + marginX
        && center.y >= top - marginY
        && center.y <= bottom + marginY;
}
function smoothHand(history, next, capturedAt) {
    if (!next.hasHand || next.landmarks.length < 21 || next.handednessScore < 0.32) {
        return { result: { ...next, stringTracking: undefined }, stability: 0 };
    }
    history.push({ capturedAt, result: { ...next, stringTracking: undefined } });
    while (history[0] && capturedAt - history[0].capturedAt > 260)
        history.shift();
    while (history.length > 4)
        history.shift();
    const compatible = history.filter((entry) => {
        const size = palmSize(entry.result);
        const currentSize = palmSize(next);
        if (size <= 0 || currentSize <= 0)
            return false;
        const ratio = Math.max(size, currentSize) / Math.min(size, currentSize);
        return ratio <= 1.65 && entry.result.landmarks.length === next.landmarks.length;
    });
    if (compatible.length < 2)
        return { result: next, stability: 0.35 };
    const previous = compatible.at(-2)?.result ?? next;
    const movement = mean(next.landmarks.map((point, index) => {
        const old = previous.landmarks[index] ?? point;
        return distance(point, old);
    }));
    const currentWeight = clamp(0.44 + movement / 0.075 * 0.38, 0.44, 0.84);
    const landmarks = next.landmarks.map((point, index) => {
        const samples = compatible
            .map((entry) => entry.result.landmarks[index])
            .filter((sample) => Boolean(sample));
        const center = {
            x: median(samples.map((sample) => sample.x)),
            y: median(samples.map((sample) => sample.y)),
            z: median(samples.map((sample) => sample.z)),
        };
        return {
            ...point,
            x: center.x * (1 - currentWeight) + point.x * currentWeight,
            y: center.y * (1 - currentWeight) + point.y * currentWeight,
            z: center.z * (1 - currentWeight) + point.z * currentWeight,
        };
    });
    const wristSamples = compatible.map((entry) => entry.result.landmarks[0]).filter(Boolean);
    const wristSpread = wristSamples.length >= 2
        ? Math.hypot(standardDeviation(wristSamples.map((point) => point.x)), standardDeviation(wristSamples.map((point) => point.y)))
        : 0.08;
    const stability = clamp(compatible.length / 4 * 0.38
        + (1 - clamp(wristSpread / 0.055, 0, 1)) * 0.34
        + next.handednessScore * 0.28, 0, 1);
    const pickSamples = compatible
        .map((entry) => entry.result.pick)
        .filter((pick) => pick.detected && pick.confidence >= 0.35);
    const pick = next.pick.detected && pickSamples.length >= 2
        ? {
            ...next.pick,
            centerX: median(pickSamples.map((sample) => sample.centerX)) * (1 - currentWeight) + next.pick.centerX * currentWeight,
            centerY: median(pickSamples.map((sample) => sample.centerY)) * (1 - currentWeight) + next.pick.centerY * currentWeight,
            angleDegrees: median(pickSamples.map((sample) => sample.angleDegrees)) * (1 - currentWeight) + next.pick.angleDegrees * currentWeight,
            exposure: median(pickSamples.map((sample) => sample.exposure)) * (1 - currentWeight) + next.pick.exposure * currentWeight,
            confidence: clamp(mean(pickSamples.map((sample) => sample.confidence)), 0, 1),
        }
        : next.pick;
    return {
        result: { ...next, landmarks, pick },
        stability,
    };
}
function dominantOrder(samples) {
    const score = new Map();
    samples.forEach((tracking) => {
        if (tracking.stringOrder === 'unknown')
            return;
        score.set(tracking.stringOrder, (score.get(tracking.stringOrder) ?? 0) + tracking.confidence * tracking.numberingConfidence);
    });
    const winner = [...score.entries()].sort((left, right) => right[1] - left[1])[0];
    if (!winner || winner[1] < 0.95)
        return 'unknown';
    return winner[0];
}
function stabilizeStrings(history, tracking, hand, capturedAt) {
    if (!tracking?.detected || tracking.lines.length < 5 || tracking.visibleLineCount < 4) {
        return { tracking: undefined, stability: 0, reason: '현재 프레임에서 기타줄 5개 이상을 확인하지 못했습니다.' };
    }
    if (tracking.confidence < 0.38 || !roiMatchesCurrentHand(tracking, hand)) {
        return { tracking: undefined, stability: 0, reason: '현재 손 위치와 기타줄 분석 영역이 일치하지 않습니다.' };
    }
    const geometry = lineGeometry(tracking);
    if (geometry.lines.length < 5
        || geometry.spacingMean < 0.003
        || geometry.spacingVariation > 0.38
        || geometry.angleVariation > 5.5) {
        return { tracking: undefined, stability: 0, reason: '줄 간격 또는 평행도가 기타줄 기준을 통과하지 못했습니다.' };
    }
    history.push({ capturedAt, tracking: { ...tracking, contacts: undefined } });
    while (history[0] && capturedAt - history[0].capturedAt > 650)
        history.shift();
    while (history.length > 6)
        history.shift();
    const compatible = history
        .filter((entry) => compatibleTracking(entry.tracking, tracking))
        .slice(-5)
        .map((entry) => entry.tracking);
    if (compatible.length < 2) {
        return { tracking: undefined, stability: 0.25, reason: '줄 위치를 한 번 더 확인하는 중입니다.' };
    }
    const lineSamples = new Map();
    compatible.forEach((sample) => sortedLines(sample).forEach((line) => {
        const current = lineSamples.get(line.visualIndex) ?? [];
        current.push(line);
        lineSamples.set(line.visualIndex, current);
    }));
    const order = dominantOrder(compatible);
    const numberingSamples = compatible.filter((sample) => sample.stringOrder === order);
    const numberingConfidence = order === 'unknown'
        ? 0
        : mean(numberingSamples.map((sample) => sample.numberingConfidence));
    const lines = [...lineSamples.entries()]
        .sort(([left], [right]) => left - right)
        .map(([visualIndex, samples]) => {
        const stringNumber = numberingConfidence >= 0.66
            ? (order === 'low-to-high' ? 7 - visualIndex : visualIndex)
            : 0;
        return {
            visualIndex: visualIndex,
            stringNumber,
            startX: median(samples.map((line) => line.startX)),
            startY: median(samples.map((line) => line.startY)),
            endX: median(samples.map((line) => line.endX)),
            endY: median(samples.map((line) => line.endY)),
            strength: median(samples.map((line) => line.strength)),
        };
    });
    const centerVariation = mean(lines.map((line) => {
        const samples = lineSamples.get(line.visualIndex) ?? [];
        const center = lineCenter(line);
        return mean(samples.map((sample) => distance(center, lineCenter(sample))));
    }));
    const confidence = mean(compatible.map((sample) => sample.confidence));
    const stability = clamp(compatible.length / 5 * 0.35
        + confidence * 0.28
        + (1 - clamp(centerVariation / Math.max(0.003, geometry.spacingMean * 0.48), 0, 1)) * 0.24
        + (1 - clamp(geometry.spacingVariation / 0.38, 0, 1)) * 0.13, 0, 1);
    if (lines.length < 5 || stability < 0.43) {
        return { tracking: undefined, stability, reason: '줄 위치의 시간 안정도가 아직 부족합니다.' };
    }
    return {
        tracking: {
            ...tracking,
            detected: true,
            confidence,
            angleDegrees: median(compatible.map((sample) => sample.angleDegrees)),
            visibleLineCount: lines.filter((line) => line.strength >= 0.28).length,
            stringOrder: order,
            numberingConfidence,
            stabilityConfidence: stability,
            nearestVisualIndex: 0,
            nearestStringNumber: 0,
            nearestDistanceRatio: 1,
            contacts: [],
            audioConfirmed: false,
            lines,
        },
        stability,
        reason: '',
    };
}
function averageLineSpacing(lines) {
    const ordered = [...lines].sort((left, right) => left.visualIndex - right.visualIndex);
    const spacings = ordered.slice(1).map((line, index) => distance(lineCenter(line), lineCenter(ordered[index])));
    return spacings.length ? mean(spacings) : 0.03;
}
function estimatedPickTip(hand, lines) {
    const center = { x: hand.pick.centerX, y: hand.pick.centerY };
    if (!hand.pick.detected || hand.pick.confidence < 0.38)
        return center;
    const radians = hand.pick.angleDegrees * Math.PI / 180;
    const length = clamp(palmSize(hand) * 0.32 + hand.pick.exposure * 0.025, 0.024, 0.082);
    const candidates = [
        center,
        { x: clamp(center.x + Math.cos(radians) * length, 0, 1), y: clamp(center.y + Math.sin(radians) * length, 0, 1) },
        { x: clamp(center.x - Math.cos(radians) * length, 0, 1), y: clamp(center.y - Math.sin(radians) * length, 0, 1) },
    ];
    return candidates.sort((left, right) => {
        const leftDistance = Math.min(...lines.map((line) => pointToLineDistance(left, line)));
        const rightDistance = Math.min(...lines.map((line) => pointToLineDistance(right, line)));
        return leftDistance - rightDistance;
    })[0];
}
function buildContacts(tracking, hand) {
    const spacing = Math.max(0.004, averageLineSpacing(tracking.lines));
    const points = [
        {
            id: 'pick',
            label: '피크',
            point: hand.pick.detected ? estimatedPickTip(hand, tracking.lines) : null,
            sourceConfidence: hand.pick.confidence,
        },
        { id: 'thumb', label: 'P', point: hand.landmarks[4] ?? null, sourceConfidence: hand.handednessScore },
        { id: 'index', label: 'i', point: hand.landmarks[8] ?? null, sourceConfidence: hand.handednessScore },
        { id: 'middle', label: 'm', point: hand.landmarks[12] ?? null, sourceConfidence: hand.handednessScore },
        { id: 'ring', label: 'a', point: hand.landmarks[16] ?? null, sourceConfidence: hand.handednessScore },
        { id: 'pinky', label: '새끼', point: hand.landmarks[20] ?? null, sourceConfidence: hand.handednessScore },
    ];
    return points.flatMap((specification) => {
        if (!specification.point)
            return [];
        const nearest = tracking.lines
            .map((line) => ({ line, distance: pointToLineDistance(specification.point, line) }))
            .sort((left, right) => left.distance - right.distance)[0];
        if (!nearest)
            return [];
        const distanceRatio = nearest.distance / spacing;
        const visualIndex = distanceRatio <= 1.12 ? nearest.line.visualIndex : 0;
        const stringNumber = distanceRatio <= 0.72
            && tracking.confidence >= 0.50
            && (tracking.stabilityConfidence ?? 0) >= 0.52
            && tracking.numberingConfidence >= 0.66
            && isStringNumber(nearest.line.stringNumber)
            ? nearest.line.stringNumber
            : 0;
        const proximity = clamp(1 - distanceRatio / 1.15, 0, 1);
        return [{
                id: specification.id,
                label: specification.label,
                x: specification.point.x,
                y: specification.point.y,
                visualIndex,
                stringNumber,
                distanceRatio: Math.round(distanceRatio * 100) / 100,
                confidence: clamp(specification.sourceConfidence * 0.36
                    + tracking.confidence * 0.24
                    + (tracking.stabilityConfidence ?? 0) * 0.22
                    + proximity * 0.18, 0, 1),
                source: stringNumber > 0 ? 'vision' : 'unresolved',
            }];
    });
}
function attachContacts(tracking, hand) {
    const contacts = buildContacts(tracking, hand);
    const primary = contacts
        .filter((contact) => contact.visualIndex > 0)
        .sort((left, right) => {
        const pickDifference = Number(right.id === 'pick') - Number(left.id === 'pick');
        return pickDifference || left.distanceRatio - right.distanceRatio;
    })[0];
    return {
        ...tracking,
        nearestVisualIndex: primary?.visualIndex ?? 0,
        nearestStringNumber: primary?.stringNumber ?? 0,
        nearestDistanceRatio: primary?.distanceRatio ?? 1,
        primaryContactId: primary?.id,
        contacts,
    };
}
class ContinuousTrackingQualityGate {
    handHistory = [];
    stringHistory = [];
    lastHitAt = new Map();
    acceptedHitHistory = [];
    reset() {
        this.handHistory.length = 0;
        this.stringHistory.length = 0;
        this.lastHitAt.clear();
        this.acceptedHitHistory.length = 0;
    }
    process(result, capturedAt = Date.now()) {
        const smoothedHand = smoothHand(this.handHistory, result, capturedAt);
        if (!smoothedHand.result.hasHand || smoothedHand.result.landmarks.length < 21) {
            this.stringHistory.length = 0;
            this.acceptedHitHistory.length = 0;
            return {
                ...smoothedHand.result,
                stringTracking: undefined,
                continuous: {
                    ...result.continuous,
                    newHits: [],
                    recentHits: [],
                    qualityGate: {
                        handStability: 0,
                        stringStability: 0,
                        trackingAccepted: false,
                        rejectedHitCount: result.continuous.newHits.length,
                        reason: '현재 프레임에서 손 전체를 신뢰도 있게 확인하지 못했습니다.',
                    },
                },
            };
        }
        const stabilized = stabilizeStrings(this.stringHistory, result.stringTracking, smoothedHand.result, capturedAt);
        if (!stabilized.tracking) {
            return {
                ...smoothedHand.result,
                stringTracking: undefined,
                continuous: {
                    ...result.continuous,
                    newHits: [],
                    recentHits: [...this.acceptedHitHistory].slice(-12),
                    qualityGate: {
                        handStability: smoothedHand.stability,
                        stringStability: stabilized.stability,
                        trackingAccepted: false,
                        rejectedHitCount: result.continuous.newHits.length,
                        reason: stabilized.reason,
                    },
                },
            };
        }
        const tracking = attachContacts(stabilized.tracking, smoothedHand.result);
        const contacts = new Map((tracking.contacts ?? []).map((contact) => [contact.id, contact]));
        let rejectedHitCount = 0;
        const newHits = result.continuous.newHits.flatMap((hit) => {
            const contact = contacts.get(hit.contactId);
            if (!contact
                || contact.visualIndex === 0
                || contact.distanceRatio > 0.74
                || contact.confidence < 0.50) {
                rejectedHitCount += 1;
                return [];
            }
            const direction = hit.direction === 'down' || hit.direction === 'up' ? hit.direction : 'unknown';
            const key = `${hit.contactId}-${contact.visualIndex}-${direction}`;
            const previousAt = this.lastHitAt.get(key) ?? -Infinity;
            if (hit.capturedAt - previousAt < 58) {
                rejectedHitCount += 1;
                return [];
            }
            const confidence = clamp(hit.confidence * 0.46
                + contact.confidence * 0.31
                + stabilized.stability * 0.23, 0, 1);
            if (confidence < 0.54) {
                rejectedHitCount += 1;
                return [];
            }
            this.lastHitAt.set(key, hit.capturedAt);
            return [{
                    ...hit,
                    visualIndex: contact.visualIndex,
                    stringNumber: contact.stringNumber,
                    direction,
                    confidence,
                }];
        });
        newHits.forEach((hit) => this.acceptedHitHistory.push(hit));
        const newestCapturedAt = newHits.at(-1)?.capturedAt
            ?? this.acceptedHitHistory.at(-1)?.capturedAt
            ?? 0;
        while (this.acceptedHitHistory.length > 20
            || (this.acceptedHitHistory[0]
                && newestCapturedAt > 0
                && newestCapturedAt - this.acceptedHitHistory[0].capturedAt > 1_800)) {
            this.acceptedHitHistory.shift();
        }
        return {
            ...smoothedHand.result,
            stringTracking: tracking,
            continuous: {
                ...result.continuous,
                newHits,
                recentHits: [...this.acceptedHitHistory].slice(-12),
                qualityGate: {
                    handStability: smoothedHand.stability,
                    stringStability: stabilized.stability,
                    trackingAccepted: true,
                    rejectedHitCount,
                    reason: '',
                },
            },
        };
    }
}
exports.ContinuousTrackingQualityGate = ContinuousTrackingQualityGate;
