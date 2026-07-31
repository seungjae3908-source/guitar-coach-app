"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLivePracticeContext = setLivePracticeContext;
exports.clearLivePracticeContext = clearLivePracticeContext;
exports.getLivePracticeContext = getLivePracticeContext;
exports.subscribeLivePracticeContext = subscribeLivePracticeContext;
const PRESET_PATTERN_FALLBACKS = {
    'acoustic-d-to-g': 'D→G',
};
let currentContext = null;
const listeners = new Set();
function setLivePracticeContext(context) {
    currentContext = {
        ...context,
        pattern: context.pattern ?? PRESET_PATTERN_FALLBACKS[context.presetId],
    };
    listeners.forEach((listener) => {
        try {
            listener(currentContext);
        }
        catch {
            // 한 화면의 구독 오류가 실시간 분석 흐름을 중단하지 않게 합니다.
        }
    });
}
function clearLivePracticeContext() {
    currentContext = null;
    listeners.forEach((listener) => {
        try {
            listener(null);
        }
        catch {
            // 구독 오류는 다른 분석 모듈에 전파하지 않습니다.
        }
    });
}
function getLivePracticeContext() {
    return currentContext;
}
function subscribeLivePracticeContext(listener) {
    listeners.add(listener);
    listener(currentContext);
    return () => {
        listeners.delete(listener);
    };
}
