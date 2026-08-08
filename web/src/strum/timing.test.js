import test from'node:test';import assert from'node:assert/strict';import{BeatTimeline,matchStrokesToBeats}from'./timing.js';import{sessionMetrics}from'./engine.js';
const scenario=(bpm,offsets,missing=[])=>{const timeline=new BeatTimeline(bpm,1000);timeline.fill(1000+6*timeline.beatMs);const beats=timeline.beats.slice(0,6),strokes=beats.filter((_,i)=>!missing.includes(i)).map((b,i)=>({timestamp:b.timestamp+(Array.isArray(offsets)?offsets[i]??0:offsets),direction:i%2?'up':'down'}));return{beats,strokes,m:sessionMetrics(strokes,bpm,beats)}};
for(const bpm of[60,80,120])test(`${bpm} BPM exact beats`,()=>{const{m}=scenario(bpm,0);assert.equal(m.averageOffsetMs,0);assert.equal(m.timingStdDevMs,0);assert.equal(m.missedBeatEstimate,0)});
test('constant +40ms is late without first-stroke rebasing',()=>{const{m}=scenario(80,40);assert.equal(m.averageOffsetMs,40);assert.equal(m.late,6)});
test('constant -35ms is early',()=>{const{m}=scenario(80,-35);assert.equal(m.averageOffsetMs,-35);assert.equal(m.early,6)});
test('missing first beat remains a missed beat',()=>assert.equal(scenario(80,0,[0]).m.missedBeatEstimate,1));
test('missing middle beat remains a missed beat',()=>assert.equal(scenario(80,0,[3]).m.missedBeatEstimate,1));
test('jitter produces nonzero standard deviation',()=>assert.ok(scenario(80,[-30,20,-10,35,-25,10]).m.timingStdDevMs>20));
test('nearest beat matcher uses each beat once',()=>{const beats=[{timestamp:0},{timestamp:500}],strokes=[{timestamp:10},{timestamp:30},{timestamp:510}],r=matchStrokesToBeats(strokes,beats,100);assert.equal(r.matches.length,2)});
