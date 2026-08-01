"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsecutiveHandGate = void 0;
exports.pointInsideRegion = pointInsideRegion;
exports.deriveRightHandRegion = deriveRightHandRegion;
exports.validateHandInRegion = validateHandInRegion;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function pointInsideRegion(point, region, margin = 0) {
    return point.x >= region.left - margin
        && point.x <= region.right + margin
        && point.y >= region.top - margin
        && point.y <= region.bottom + margin;
}
function deriveRightHandRegion(soundhole, bridge) {
    const leftPoint = Math.min(soundhole.x, bridge.x);
    const rightPoint = Math.max(soundhole.x, bridge.x);
    const centerY = (soundhole.y + bridge.y) / 2;
    const distance = Math.max(0.14, Math.hypot(soundhole.x - bridge.x, soundhole.y - bridge.y));
    let left = clamp(leftPoint - Math.max(0.12, distance * 0.72), 0.02, 0.78);
    let right = clamp(rightPoint + Math.max(0.12, distance * 0.68), 0.22, 0.98);
    let top = clamp(centerY - Math.max(0.22, distance * 1.18), 0.06, 0.78);
    let bottom = clamp(centerY + Math.max(0.18, distance * 0.92), 0.24, 0.98);
    const minimumWidth = 0.40;
    const minimumHeight = 0.38;
    if (right - left < minimumWidth) {
        const centerX = (left + right) / 2;
        left = clamp(centerX - minimumWidth / 2, 0.02, 0.58);
        right = clamp(left + minimumWidth, 0.42, 0.98);
    }
    if (bottom - top < minimumHeight) {
        const adjustedCenterY = (top + bottom) / 2;
        top = clamp(adjustedCenterY - minimumHeight / 2, 0.06, 0.60);
        bottom = clamp(top + minimumHeight, 0.44, 0.98);
    }
    return { left, top, right, bottom };
}
function validateHandInRegion(landmarks, region) {
    const usable = landmarks.filter((point) => Boolean(point));
    if (usable.length < 21) {
        return { valid: false, reason: 'missing-landmarks', center: null, palmSize: 0, insideRatio: 0 };
    }
    const wrist = usable[0];
    const middleMcp = usable[9];
    const palmSize = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y);
    const center = {
        x: usable.reduce((sum, point) => sum + point.x, 0) / usable.length,
        y: usable.reduce((sum, point) => sum + point.y, 0) / usable.length,
    };
    const insideCount = usable.filter((point) => pointInsideRegion(point, region, 0.015)).length;
    const insideRatio = insideCount / usable.length;
    if (palmSize < 0.045 || palmSize > 0.34) {
        return { valid: false, reason: 'invalid-palm-size', center, palmSize, insideRatio };
    }
    if (!pointInsideRegion(wrist, region, 0.02)
        || !pointInsideRegion(middleMcp, region, 0.02)
        || !pointInsideRegion(center, region, 0.01)
        || insideRatio < 0.72) {
        return { valid: false, reason: 'outside-roi', center, palmSize, insideRatio };
    }
    return { valid: true, reason: 'ok', center, palmSize, insideRatio };
}
class ConsecutiveHandGate {
    requiredFrames;
    maximumCenterJump;
    consecutive = 0;
    previousCenter = null;
    constructor(requiredFrames = 5, maximumCenterJump = 0.17) {
        this.requiredFrames = requiredFrames;
        this.maximumCenterJump = maximumCenterJump;
    }
    reset() {
        this.consecutive = 0;
        this.previousCenter = null;
    }
    add(result) {
        if (!result.valid || !result.center) {
            this.reset();
            return { locked: false, consecutive: 0, required: this.requiredFrames, reason: result.reason };
        }
        if (this.previousCenter) {
            const jump = Math.hypot(result.center.x - this.previousCenter.x, result.center.y - this.previousCenter.y);
            if (jump > this.maximumCenterJump) {
                this.consecutive = 1;
                this.previousCenter = result.center;
                return {
                    locked: false,
                    consecutive: this.consecutive,
                    required: this.requiredFrames,
                    reason: 'unstable-position',
                };
            }
        }
        this.previousCenter = result.center;
        this.consecutive = Math.min(this.requiredFrames, this.consecutive + 1);
        return {
            locked: this.consecutive >= this.requiredFrames,
            consecutive: this.consecutive,
            required: this.requiredFrames,
            reason: 'ok',
        };
    }
}
exports.ConsecutiveHandGate = ConsecutiveHandGate;
