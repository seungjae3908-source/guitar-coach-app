import type { ChordRecognitionResult } from './fretboard-chord-engine';

export type ChordTransitionTarget = {
  from: string;
  to: string;
};

export type ChordTransitionResult = {
  status: 'waiting' | 'correction' | 'success';
  fromChord: string | null;
  toChord: string | null;
  transitionMs: number | null;
  title: string;
  instruction: string;
  evidence: string;
  nextGoal: string;
  confidencePercent: number;
};

function normalizeChord(value: string) {
  return value.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
}

export function parseChordTransitionTarget(pattern?: string): ChordTransitionTarget | null {
  const normalized = (pattern ?? '').replace(/\s+/g, '');
  const match = normalized.match(/^([A-G](?:#|b)?(?:m|maj7|m7|7|sus2|sus4|5)?)(?:>|→|->)([A-G](?:#|b)?(?:m|maj7|m7|7|sus2|sus4|5)?)$/i);
  if (!match) return null;
  return { from: normalizeChord(match[1]), to: normalizeChord(match[2]) };
}

export class ChordTransitionTracker {
  private lastConfirmed: { chordName: string; lastSeenAt: number; confidencePercent: number } | null = null;
  private recentResults: ChordTransitionResult[] = [];

  reset() {
    this.lastConfirmed = null;
    this.recentResults = [];
  }

  process(
    recognition: ChordRecognitionResult,
    pattern: string | undefined,
    capturedAt = Date.now(),
  ): ChordTransitionResult | null {
    const target = parseChordTransitionTarget(pattern);
    if (!target || recognition.status !== 'confirmed' || !recognition.chordName) return null;
    const chordName = normalizeChord(recognition.chordName);
    const previous = this.lastConfirmed;

    if (!previous) {
      this.lastConfirmed = {
        chordName,
        lastSeenAt: capturedAt,
        confidencePercent: recognition.confidencePercent,
      };
      return {
        status: 'waiting',
        fromChord: chordName,
        toChord: null,
        transitionMs: null,
        title: `${chordName} 코드 확인 · 다음 ${chordName === target.from ? target.to : target.from}`,
        instruction: chordName === target.from
          ? `${target.to} 코드로 전환하세요.`
          : `${target.from} 코드로 돌아가 전환 루틴을 시작하세요.`,
        evidence: `${chordName} 코드가 ${recognition.confidencePercent}% 신뢰도로 확인됐습니다.`,
        nextGoal: `${target.from}→${target.to} 순서로 전환하세요.`,
        confidencePercent: recognition.confidencePercent,
      };
    }

    if (previous.chordName === chordName) {
      previous.lastSeenAt = capturedAt;
      previous.confidencePercent = recognition.confidencePercent;
      return null;
    }

    const transitionMs = Math.max(0, capturedAt - previous.lastSeenAt);
    const forward = previous.chordName === target.from && chordName === target.to;
    const returnTransition = previous.chordName === target.to && chordName === target.from;
    const pairAllowed = forward || returnTransition;
    const confidencePercent = Math.round((previous.confidencePercent + recognition.confidencePercent) / 2);
    let result: ChordTransitionResult;

    if (!pairAllowed) {
      const expected = previous.chordName === target.from ? target.to : target.from;
      result = {
        status: 'correction',
        fromChord: previous.chordName,
        toChord: chordName,
        transitionMs,
        title: `다음 코드가 ${expected}가 아닙니다`,
        instruction: `${previous.chordName}에서 ${expected}의 줄·프렛 모양으로 이동하세요. 현재 ${chordName}가 확인됐습니다.`,
        evidence: `${previous.chordName}→${chordName} · ${transitionMs}ms`,
        nextGoal: `${target.from}→${target.to} 두 코드만 번갈아 4회 연주하세요.`,
        confidencePercent,
      };
    } else if (transitionMs > 850) {
      result = {
        status: 'correction',
        fromChord: previous.chordName,
        toChord: chordName,
        transitionMs,
        title: `${previous.chordName}→${chordName} 전환이 늦습니다`,
        instruction: '손가락을 하나씩 찾지 말고 코드 모양을 공중에서 먼저 만든 뒤 한 번에 지판으로 내려놓으세요.',
        evidence: `마지막 안정 코드에서 다음 코드 확인까지 ${transitionMs}ms입니다.`,
        nextGoal: '속도를 낮추고 700ms 안에 같은 전환을 3회 성공하세요.',
        confidencePercent,
      };
    } else if (transitionMs > 500) {
      result = {
        status: 'correction',
        fromChord: previous.chordName,
        toChord: chordName,
        transitionMs,
        title: `${previous.chordName}→${chordName} 모양은 맞지만 더 빠르게 연결할 수 있습니다`,
        instruction: '손목 위치를 크게 바꾸지 말고 가장 늦게 도착하는 손가락을 먼저 이동시키세요.',
        evidence: `정확한 코드 전환 ${transitionMs}ms · 목표 500ms 이하`,
        nextGoal: '같은 정확도를 유지하며 500ms 이하 전환을 3회 만드세요.',
        confidencePercent,
      };
    } else {
      result = {
        status: 'success',
        fromChord: previous.chordName,
        toChord: chordName,
        transitionMs,
        title: `${previous.chordName}→${chordName} 전환이 정확하고 빠릅니다`,
        instruction: '현재 손목 위치와 손가락 동시 착지를 그대로 유지하세요.',
        evidence: `두 코드가 확인됐고 전환 시간은 ${transitionMs}ms입니다.`,
        nextGoal: '같은 전환을 4회 연속 유지한 뒤 BPM을 2 올리세요.',
        confidencePercent,
      };
    }

    this.lastConfirmed = {
      chordName,
      lastSeenAt: capturedAt,
      confidencePercent: recognition.confidencePercent,
    };
    this.recentResults.push(result);
    this.recentResults = this.recentResults.slice(-12);
    return result;
  }

  summary() {
    const valid = this.recentResults.filter((result) => result.transitionMs != null && result.status !== 'waiting');
    const successful = valid.filter((result) => result.status === 'success');
    return {
      attempts: valid.length,
      successful: successful.length,
      averageTransitionMs: valid.length
        ? Math.round(valid.reduce((sum, result) => sum + (result.transitionMs ?? 0), 0) / valid.length)
        : null,
      bestTransitionMs: valid.length
        ? Math.min(...valid.map((result) => result.transitionMs ?? Number.MAX_SAFE_INTEGER))
        : null,
    };
  }
}
