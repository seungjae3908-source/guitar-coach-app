"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RightHandMotionTracker = void 0;
const PICK_CATEGORIES = new Set([
    'strumming',
    'downPicking',
    'alternatePicking',
    'palmMute',
]);
const FINGER_CATEGORIES = new Set(['arpeggio', 'fingerstyle']);
const LABELS = {
    pick: '피크',
    thumb: 'P',
    index: 'i',
    middle: 'm',
    ring: 'a',
    pinky: '새끼',
};
const TIP_NAMES = {
    thumb: 'thumbTip',
    index: 'indexTip',
    middle: 'middleTip',
    ring: 'ringTip',
    pinky: 'pinkyTip',
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function distance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y);
}
function lineLength(line) {
    return Math.max(0.000001, Math.hypot(line.endX - line.startX, line.endY - line.startY));
}
function signedDistance(point, line) {
    const dx = line.endX - line.startX;
    const dy = line.endY - line.startY;
    return ((point.x - line.startX) * -dy + (point.y - line.startY) * dx) / lineLength(line);
}
function lineCenter(line) {
    return { x: (line.startX + line.endX) / 2, y: (line.startY + line.endY) / 2 };
}
function averageLineSpacing(lines) {
    const ordered = [...lines].sort((left, right) => left.visualIndex - right.visualIndex);
    const gaps = ordered.slice(1).map((line, index) => distance(lineCenter(line), lineCenter(ordered[index])));
    return gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : 0.035;
}
function nearestLine(point, lines) {
    return lines
        .map((line) => ({ line, signed: signedDistance(point, line) }))
        .sort((left, right) => Math.abs(left.signed) - Math.abs(right.signed))[0] ?? null;
}
function pointForContact(id, result, landmarks) {
    if (id === 'pick') {
        if (!result.pick.detected || result.pick.confidence < 0.34)
            return null;
        return { x: result.pick.centerX, y: result.pick.centerY };
    }
    const name = TIP_NAMES[id];
    const point = name ? landmarks.get(name) : null;
    return point ? { x: point.x, y: point.y } : null;
}
function contactIds(category) {
    if (PICK_CATEGORIES.has(category))
        return ['pick'];
    if (FINGER_CATEGORIES.has(category))
        return ['thumb', 'index', 'middle', 'ring'];
    return [];
}
function directionFromMotion(previous, point, signed) {
    const signedChange = signed - previous.signedDistance;
    if (Math.abs(signedChange) >= 0.0025)
        return signedChange > 0 ? 'down' : 'up';
    const yChange = point.y - previous.point.y;
    if (Math.abs(yChange) >= 0.004)
        return yChange > 0 ? 'down' : 'up';
    return 'unknown';
}
function crossedVisualIndexes(previous, current) {
    if (previous <= 0 || current <= 0 || previous === current)
        return [current].filter((value) => value > 0);
    const direction = current > previous ? 1 : -1;
    const result = [];
    for (let value = previous + direction; direction > 0 ? value <= current : value >= current; value += direction) {
        result.push(value);
    }
    return result;
}
class RightHandMotionTracker {
    states = new Map();
    lastHitAt = new Map();
    reset() {
        this.states.clear();
        this.lastHitAt.clear();
    }
    update(result, capturedAt, category) {
        const tracking = result.stringTracking;
        if (!result.hasHand || !tracking?.detected || tracking.lines.length < 4) {
            this.states.clear();
            return [];
        }
        const spacing = Math.max(0.006, averageLineSpacing(tracking.lines));
        const landmarks = new Map(result.landmarks.map((point) => [point.name, point]));
        const palmWrist = landmarks.get('wrist');
        const middleMcp = landmarks.get('middleMcp');
        const palmSize = palmWrist && middleMcp ? distance(palmWrist, middleMcp) : 0;
        if (palmSize < 0.045 || result.handednessScore < 0.32)
            return [];
        const hits = [];
        contactIds(category).forEach((id) => {
            const point = pointForContact(id, result, landmarks);
            if (!point) {
                this.states.delete(id);
                return;
            }
            const nearest = nearestLine(point, tracking.lines);
            if (!nearest)
                return;
            const ratio = Math.abs(nearest.signed) / spacing;
            const visualIndex = nearest.line.visualIndex;
            const stringNumber = nearest.line.stringNumber;
            const current = {
                capturedAt,
                point,
                signedDistance: nearest.signed,
                distanceRatio: ratio,
                visualIndex,
                stringNumber,
            };
            const previous = this.states.get(id);
            this.states.set(id, current);
            if (!previous)
                return;
            const elapsedMs = capturedAt - previous.capturedAt;
            if (elapsedMs < 35 || elapsedMs > 650)
                return;
            const movement = distance(previous.point, point) / Math.max(0.001, palmSize);
            const crossedSide = previous.signedDistance * nearest.signed <= 0
                && Math.abs(previous.signedDistance) <= spacing * 1.15
                && Math.abs(nearest.signed) <= spacing * 1.15;
            const changedLine = previous.visualIndex > 0
                && visualIndex > 0
                && previous.visualIndex !== visualIndex
                && (previous.distanceRatio <= 1.35 || ratio <= 1.35);
            if ((!crossedSide && !changedLine) || movement < 0.035)
                return;
            const lastHit = this.lastHitAt.get(id) ?? 0;
            if (capturedAt - lastHit < 75)
                return;
            const direction = directionFromMotion(previous, point, nearest.signed);
            const handConfidence = clamp(result.handednessScore, 0, 1);
            const stringConfidence = clamp(tracking.confidence * 0.46
                + (tracking.stabilityConfidence ?? 0) * 0.24
                + tracking.numberingConfidence * 0.12
                + clamp(1 - Math.min(previous.distanceRatio, ratio) / 1.35, 0, 1) * 0.18, 0, 1);
            const sourceConfidence = id === 'pick' ? result.pick.confidence : handConfidence;
            const confidence = clamp(sourceConfidence * 0.48 + stringConfidence * 0.42 + clamp(movement / 0.34, 0, 1) * 0.10, 0, 1);
            if (confidence < 0.48)
                return;
            const indexes = crossedVisualIndexes(previous.visualIndex, visualIndex);
            indexes.forEach((index) => {
                const line = tracking.lines.find((item) => item.visualIndex === index) ?? nearest.line;
                hits.push({
                    capturedAt,
                    contactId: id,
                    label: LABELS[id],
                    visualIndex: line.visualIndex,
                    stringNumber: line.stringNumber,
                    direction,
                    confidence,
                });
            });
            this.lastHitAt.set(id, capturedAt);
        });
        return hits;
    }
}
exports.RightHandMotionTracker = RightHandMotionTracker;
