export class BeatTimeline {
  constructor(bpm, startTimestamp) {
    this.beatMs = 60000 / bpm;
    this.startTimestamp = startTimestamp;
    this.beats = [];
    this.nextIndex = 0;
  }
  fill(untilTimestamp) {
    while (
      this.startTimestamp + this.nextIndex * this.beatMs <=
      untilTimestamp
    ) {
      this.beats.push({
        index: this.nextIndex,
        timestamp: this.startTimestamp + this.nextIndex * this.beatMs,
      });
      this.nextIndex += 1;
    }
    return this.beats;
  }
}

export function matchStrokesToBeats(strokes, beats, windowMs) {
  const unused = new Set(beats.map((_, i) => i));
  const matches = [];
  for (const stroke of strokes) {
    let best = null;
    for (const index of unused) {
      const offset = stroke.timestamp - beats[index].timestamp;
      const distance = Math.abs(offset);
      if (distance <= windowMs && (!best || distance < best.distance))
        best = { index, offset, distance };
    }
    if (best) {
      unused.delete(best.index);
      matches.push({ stroke, beat: beats[best.index], offset: best.offset });
    }
  }
  return { matches, missedBeats: beats.filter((_, i) => unused.has(i)) };
}

export function createWebAudioMetronome({
  context,
  bpm,
  onBeat,
  audible = true,
  lookaheadMs = 100,
  tickMs = 25,
}) {
  const beatSeconds = 60 / bpm;
  const originPerformance = performance.now() - context.currentTime * 1000;
  let nextAudioTime = context.currentTime + 0.08;
  let index = 0;
  const schedule = () => {
    while (nextAudioTime < context.currentTime + lookaheadMs / 1000) {
      if (audible) {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        oscillator.frequency.value = index % 4 === 0 ? 1150 : 880;
        gain.gain.setValueAtTime(0.0001, nextAudioTime);
        gain.gain.exponentialRampToValueAtTime(
          index % 4 === 0 ? 0.1 : 0.06,
          nextAudioTime + 0.003,
        );
        gain.gain.exponentialRampToValueAtTime(0.0001, nextAudioTime + 0.045);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(nextAudioTime);
        oscillator.stop(nextAudioTime + 0.05);
      }
      onBeat({ index, timestamp: originPerformance + nextAudioTime * 1000 });
      index += 1;
      nextAudioTime += beatSeconds;
    }
  };
  schedule();
  const timer = setInterval(schedule, tickMs);
  return { stop: () => clearInterval(timer) };
}
