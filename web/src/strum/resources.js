export class PracticeResources {
  constructor(cancelFrame = cancelAnimationFrame) { this.cancelFrame = cancelFrame; this.generation = 0; this.values = {}; }
  begin() { this.stopAnalysis(); this.generation += 1; return this.generation; }
  current(generation) { return generation === this.generation; }
  stopAnalysis() { const v=this.values; ['raf','audioRaf'].forEach((key)=>v[key]!=null&&this.cancelFrame(v[key])); ['timer','schedulerTimer'].forEach((key)=>v[key]!=null&&clearInterval(v[key])); v.metronome?.stop?.(); v.tracker?.close?.(); v.source?.disconnect?.(); v.analyser?.disconnect?.(); v.context?.close?.(); this.values={stream:v.stream}; this.generation += 1; }
  stopAll() { this.stopAnalysis(); this.values.stream?.getTracks?.().forEach((track)=>track.stop()); this.values={}; }
}
