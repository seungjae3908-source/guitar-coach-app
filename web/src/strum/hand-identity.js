import { distance, strumPoint, toGuitarSpace } from './geometry.js';

const centroid = (landmarks) => {
  const points = landmarks.filter(Boolean); return { x: points.reduce((s,p)=>s+p.x,0)/points.length, y: points.reduce((s,p)=>s+p.y,0)/points.length };
};

export class HandIdentityTracker {
  constructor({ maxDropoutFrames = 3 } = {}) { this.maxDropoutFrames = maxDropoutFrames; this.tracks = new Map(); this.nextId = 1; this.selectedId = null; }
  update(hands, calibration) {
    const candidates = hands.map((hand) => ({ hand, center: centroid(hand.landmarks) })); const available = new Set(this.tracks.keys()); const assigned = [];
    for (const candidate of candidates) {
      let best = null;
      for (const id of available) {
        const track = this.tracks.get(id); const predicted = { x: track.center.x + track.velocity.x, y: track.center.y + track.velocity.y };
        const handednessPenalty = track.handedness && candidate.hand.handedness && track.handedness !== candidate.hand.handedness ? 0.035 : 0;
        const cost = distance(candidate.center, predicted) + handednessPenalty;
        if (!best || cost < best.cost) best = { id, cost };
      }
      const id = best && best.cost < 0.24 ? best.id : this.nextId++;
      if (best) available.delete(id);
      const previous = this.tracks.get(id); const velocity = previous ? { x: candidate.center.x - previous.center.x, y: candidate.center.y - previous.center.y } : { x: 0, y: 0 };
      const track = { id, hand: candidate.hand, center: candidate.center, previousCenter: previous?.center ?? candidate.center, velocity, handedness: previous?.handedness ?? candidate.hand.handedness, missing: 0 };
      this.tracks.set(id, track); assigned.push(track);
    }
    for (const id of available) { const track = this.tracks.get(id); track.missing += 1; if (track.missing > this.maxDropoutFrames) { this.tracks.delete(id); if (this.selectedId === id) this.selectedId = null; } }
    return this.select(assigned, calibration);
  }
  select(tracks, calibration) {
    const scored = tracks.map((track) => {
      const point = strumPoint(track.hand.landmarks); const g = toGuitarSpace(point, calibration); const z = calibration.strumZone;
      const zoneDistance = Math.max(0, z.alongMin-g.along, g.along-z.alongMax, z.acrossMin-g.across, g.across-z.acrossMax);
      const ownMotion = distance(track.center, track.previousCenter);
      return { ...track, point, zoneDistance, ownMotion, score: -zoneDistance * 12 + Math.min(ownMotion, .12) * 1.5 + (track.hand.score ?? 0) * .05 };
    }).sort((a,b)=>b.score-a.score);
    const incumbent = scored.find((item)=>item.id===this.selectedId); const winner = incumbent && incumbent.zoneDistance < .09 && (!scored[0] || scored[0].score < incumbent.score + .45) ? incumbent : scored[0];
    if (winner) this.selectedId = winner.id;
    return winner ?? null;
  }
  reset() { this.tracks.clear(); this.selectedId = null; }
}
