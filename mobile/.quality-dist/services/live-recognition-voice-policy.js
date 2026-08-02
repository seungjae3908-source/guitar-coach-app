"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveRecognitionVoicePolicy = void 0;
class LiveRecognitionVoicePolicy {
    cameraAnnounced = false;
    handFrames = 0;
    guitarFrames = 0;
    handMissFrames = 0;
    handAnnounced = false;
    guitarAnnouncedType = '';
    combinedAnnounced = false;
    tooSmallFrames = 0;
    lastPhrase = '';
    lastSpokenAt = -Infinity;
    reset() {
        this.cameraAnnounced = false;
        this.handFrames = 0;
        this.guitarFrames = 0;
        this.handMissFrames = 0;
        this.handAnnounced = false;
        this.guitarAnnouncedType = '';
        this.combinedAnnounced = false;
        this.tooSmallFrames = 0;
        this.lastPhrase = '';
        this.lastSpokenAt = -Infinity;
    }
    next(snapshot, now = Date.now()) {
        if (!snapshot.running) {
            this.handFrames = 0;
            this.guitarFrames = 0;
            this.handMissFrames = 0;
            this.tooSmallFrames = 0;
            return null;
        }
        if (snapshot.error) {
            return this.emit(`카메라 분석 오류입니다. ${snapshot.error}`, now, 8_000);
        }
        if (snapshot.cameraReady && !this.cameraAnnounced) {
            this.cameraAnnounced = true;
            return this.emit('카메라 분석을 시작합니다.', now, 0);
        }
        const handValid = snapshot.hasHand && snapshot.handConfidence >= 0.25;
        if (handValid) {
            this.handFrames += 1;
            this.handMissFrames = 0;
            this.tooSmallFrames = snapshot.palmSize > 0 && snapshot.palmSize < 0.075
                ? this.tooSmallFrames + 1
                : 0;
        }
        else {
            this.handFrames = 0;
            this.handMissFrames += 1;
            this.tooSmallFrames = 0;
        }
        const guitarValid = snapshot.guitarDetected && snapshot.guitarConfidence >= 0.14;
        this.guitarFrames = guitarValid ? this.guitarFrames + 1 : 0;
        if (this.handAnnounced && this.handMissFrames >= 14) {
            this.handAnnounced = false;
            this.combinedAnnounced = false;
            this.handMissFrames = 0;
            return this.emit('손이 화면에서 벗어났습니다.', now, 4_500);
        }
        if (this.tooSmallFrames >= 10) {
            this.tooSmallFrames = 0;
            return this.emit('손을 조금 더 가까이 보여 주세요.', now, 8_000);
        }
        if (!this.handAnnounced && this.handFrames >= 3) {
            this.handAnnounced = true;
            if (this.guitarAnnouncedType) {
                this.combinedAnnounced = true;
                return this.emit('손과 기타 인식이 완료되었습니다.', now, 2_000);
            }
            return this.emit('손을 인식했습니다.', now, 2_000);
        }
        if (guitarValid && this.guitarFrames >= 2 && this.guitarAnnouncedType !== snapshot.guitarType) {
            this.guitarAnnouncedType = snapshot.guitarType;
            if (this.handAnnounced) {
                this.combinedAnnounced = true;
                return this.emit('손과 기타 인식이 완료되었습니다.', now, 2_000);
            }
            const label = snapshot.guitarType === 'acoustic'
                ? '통기타'
                : snapshot.guitarType === 'electric'
                    ? '일렉기타'
                    : snapshot.guitarType === 'bass'
                        ? '베이스 기타'
                        : '기타';
            return this.emit(`${label}를 인식했습니다.`, now, 2_000);
        }
        if (this.handAnnounced && this.guitarAnnouncedType && !this.combinedAnnounced) {
            this.combinedAnnounced = true;
            return this.emit('손과 기타 인식이 완료되었습니다.', now, 2_000);
        }
        return null;
    }
    emit(phrase, now, cooldown) {
        if (phrase === this.lastPhrase && now - this.lastSpokenAt < cooldown)
            return null;
        if (now - this.lastSpokenAt < 1_100)
            return null;
        this.lastPhrase = phrase;
        this.lastSpokenAt = now;
        return phrase;
    }
}
exports.LiveRecognitionVoicePolicy = LiveRecognitionVoicePolicy;
