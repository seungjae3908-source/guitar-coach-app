import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
  useAudioStream,
} from 'expo-audio';

const C = {
  bg: '#07100D', card: '#0E1A16', card2: '#12231D', line: '#1D372E',
  green: '#74F7A5', cyan: '#58DDF5', amber: '#FFD76A', red: '#FF7188',
  white: '#F4FFF8', muted: '#8DAA9D', black: '#06100B',
};
const ROOTS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALE_MAP = {
  'Major': [0,2,4,5,7,9,11],
  'Natural Minor': [0,2,3,5,7,8,10],
  'Major Pentatonic': [0,2,4,7,9],
  'Minor Pentatonic': [0,3,5,7,10],
  'Blues': [0,3,5,6,7,10],
  'Dorian': [0,2,3,5,7,9,10],
  'Mixolydian': [0,2,4,5,7,9,10],
};
const CATEGORIES = ['Scale','Pentatonic','Chromatic','Picking','Fingering','Fingerstyle','Hammer-on','Pull-off','Slide','Legato','String Skip','Speed Burst','Mixed'];
const DIFFICULTIES = ['Starter','Builder','Advanced','Pro'];
const TUNING_MIDI = [40,45,50,55,59,64]; // E2 A2 D3 G3 B3 E4
const STRING_NAMES = ['E','A','D','G','B','e'];
const RHYTHMS = [
  {name:'Quarter', factor:1, label:'♩'}, {name:'8th', factor:0.5, label:'♪'},
  {name:'Triplet', factor:1/3, label:'3'}, {name:'16th', factor:0.25, label:'♬'},
];
const STORAGE_KEY = 'guitar-tempo-coach-sessions-v1';

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function mod(n,m){ return ((n%m)+m)%m; }
function midiName(m){ const n=ROOTS[mod(Math.round(m),12)]; const o=Math.floor(Math.round(m)/12)-1; return `${n}${o}`; }
function midiHz(m){ return 440*Math.pow(2,(m-69)/12); }
function hzToMidi(hz){ return 69+12*Math.log2(hz/440); }
function centsOff(hz,midi){ return 1200*Math.log2(hz/midiHz(midi)); }

function detectPitch(samples, sampleRate){
  if(!samples || samples.length < 256) return null;
  let rms=0;
  for(let i=0;i<samples.length;i++) rms += samples[i]*samples[i];
  rms=Math.sqrt(rms/samples.length);
  if(rms < 0.008) return null;
  const minHz=70, maxHz=1200;
  const minLag=Math.floor(sampleRate/maxHz), maxLag=Math.min(Math.floor(sampleRate/minHz), samples.length-2);
  let bestLag=-1, best=-Infinity;
  let energy=0; for(let i=0;i<samples.length;i++) energy+=samples[i]*samples[i];
  for(let lag=minLag; lag<=maxLag; lag++){
    let corr=0, e2=0;
    const end=samples.length-lag;
    for(let i=0;i<end;i+=2){ const a=samples[i], b=samples[i+lag]; corr+=a*b; e2+=b*b; }
    const norm=corr/Math.sqrt(Math.max(1e-12,energy*e2*0.5));
    if(norm>best){ best=norm; bestLag=lag; }
  }
  if(bestLag<0 || best<0.16) return null;
  // Prefer the shortest strong period to reduce octave-down errors.
  const threshold=best*0.91;
  let chosen=bestLag;
  for(let lag=minLag;lag<bestLag;lag++){
    let corr=0,e2=0; const end=samples.length-lag;
    for(let i=0;i<end;i+=2){ const a=samples[i], b=samples[i+lag]; corr+=a*b; e2+=b*b; }
    const norm=corr/Math.sqrt(Math.max(1e-12,energy*e2*0.5));
    if(norm>=threshold){ chosen=lag; break; }
  }
  const hz=sampleRate/chosen;
  if(!Number.isFinite(hz) || hz<minHz || hz>maxHz) return null;
  return {hz, rms, confidence:clamp(best,0,1)};
}

function buildScale(root, scale){
  const rootPc=ROOTS.indexOf(root);
  const pcs=new Set((SCALE_MAP[scale]||SCALE_MAP['Minor Pentatonic']).map(x=>mod(rootPc+x,12)));
  const notes=[];
  for(let s=0;s<6;s++){
    for(let fret=0;fret<=15;fret++){
      const midi=TUNING_MIDI[s]+fret;
      if(pcs.has(mod(midi,12))) notes.push({string:s,fret,midi,root:mod(midi,12)===rootPc});
    }
  }
  return notes;
}
function nearestScaleNote(notes,string,fret,dir=1){
  const same=notes.filter(n=>n.string===string && (dir>0?n.fret>fret:n.fret<fret));
  same.sort((a,b)=>dir>0?a.fret-b.fret:b.fret-a.fret);
  return same[0]||null;
}
function makeExercise({root,scale,category,difficulty}){
  const pool=buildScale(root,scale);
  const count={Starter:8,Builder:12,Advanced:16,Pro:20}[difficulty]||12;
  const mid=pool.filter(n=>n.fret>=3&&n.fret<=12);
  const source=mid.length?mid:pool;
  const events=[];
  let cursor=Math.floor(Math.random()*source.length);
  for(let i=0;i<count;i++){
    let n=source[mod(cursor,source.length)];
    if(category==='Chromatic'){
      const s=mod(5-Math.floor(i/4),6), f=5+mod(i,4); n={string:s,fret:f,midi:TUNING_MIDI[s]+f,root:false};
    }
    let tech='pick', display=String(n.fret), next=null;
    const mixed=['pick','hammer','pull','slideUp','slideDown'][i%5];
    let mode=category==='Mixed'?mixed:category==='Hammer-on'?'hammer':category==='Pull-off'?'pull':category==='Slide'?(i%2?'slideDown':'slideUp'):category==='Legato'?(i%2?'pull':'hammer'):'pick';
    if(mode==='hammer'){
      next=nearestScaleNote(pool,n.string,n.fret,1); if(next){tech='hammer'; display=`${n.fret}h${next.fret}`;}
    } else if(mode==='pull'){
      next=nearestScaleNote(pool,n.string,n.fret,-1); if(!next){ const up=nearestScaleNote(pool,n.string,n.fret,1); if(up){ next=n; n=up; } }
      if(next){tech='pull';display=`${n.fret}p${next.fret}`;}
    } else if(mode==='slideUp'){
      next=nearestScaleNote(pool,n.string,n.fret,1); if(next){tech='slide';display=`${n.fret}/${next.fret}`;}
    } else if(mode==='slideDown'){
      next=nearestScaleNote(pool,n.string,n.fret,-1); if(next){tech='slide';display=`${n.fret}\\${next.fret}`;}
    }
    const picking=category==='Fingerstyle'?['P','i','m','a'][i%4]:(i%2===0?'↓':'↑');
    events.push({...n,tech,display,picking,finger:clamp((n.fret%4)+1,1,4), endMidi:next?.midi??n.midi});
    cursor += category==='String Skip'?(i%2?7:-5):category==='Speed Burst'?(i%4===3?5:1):(i%3===2?2:1);
  }
  return events;
}
function renderTab(events){
  const rows=Array.from({length:6},(_,idx)=>`${STRING_NAMES[5-idx]}|`);
  events.forEach(e=>{
    const target=5-e.string;
    const cell=e.display.padEnd(5,'-');
    for(let r=0;r<6;r++) rows[r]+=r===target?cell:'-----';
  });
  return rows.join('\n');
}
function scoreColor(n){ return n>=90?C.green:n>=75?C.amber:C.red; }

function Pill({children,active,onPress,small}){
  return <Pressable onPress={onPress} style={[s.pill,active&&s.pillActive,small&&s.pillSmall]}><Text style={[s.pillText,active&&s.pillTextActive,small&&s.pillTextSmall]}>{children}</Text></Pressable>;
}
function Card({children,style}){ return <View style={[s.card,style]}>{children}</View>; }
function Metric({label,value,color=C.white,sub}){ return <View style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={[s.metricValue,{color}]}>{value}</Text>{sub?<Text style={s.metricSub}>{sub}</Text>:null}</View>; }
function SectionTitle({eyebrow,title,desc}){ return <View style={{marginBottom:14}}>{eyebrow?<Text style={s.eyebrow}>{eyebrow}</Text>:null}<Text style={s.h1}>{title}</Text>{desc?<Text style={s.desc}>{desc}</Text>:null}</View>; }
function BigButton({title,onPress,kind='primary',disabled}){ return <Pressable disabled={disabled} onPress={onPress} style={[s.bigBtn,kind==='ghost'&&s.bigBtnGhost,kind==='danger'&&s.bigBtnDanger,disabled&&{opacity:.45}]}><Text style={[s.bigBtnText,kind==='ghost'&&{color:C.white}]}>{title}</Text></Pressable>; }

export default function App(){
  const [tab,setTab]=useState('Home');
  const [root,setRoot]=useState('A');
  const [scale,setScale]=useState('Minor Pentatonic');
  const [category,setCategory]=useState('Mixed');
  const [difficulty,setDifficulty]=useState('Builder');
  const [rhythm,setRhythm]=useState(RHYTHMS[1]);
  const [bpm,setBpm]=useState(72);
  const [exercise,setExercise]=useState(()=>makeExercise({root:'A',scale:'Minor Pentatonic',category:'Mixed',difficulty:'Builder'}));
  const [metroOn,setMetroOn]=useState(false);
  const [beat,setBeat]=useState(0);
  const [timeSig,setTimeSig]=useState(4);
  const [ramp,setRamp]=useState(false);
  const [live,setLive]=useState(false);
  const [pitch,setPitch]=useState(null);
  const [stability,setStability]=useState(0);
  const [lastJudge,setLastJudge]=useState(null);
  const [sessions,setSessions]=useState([]);
  const [recordingUri,setRecordingUri]=useState(null);

  const pitchHistory=useRef([]);
  const bufferCounter=useRef(0);
  const practiceRef=useRef({active:false,start:0,lastIdx:-1,pitchHit:0,timingHit:0,total:0,stability:[],bpm:72,events:[],factor:.5});
  const clickPlayer=useAudioPlayer(require('./assets/click.wav'));
  const accentPlayer=useAudioPlayer(require('./assets/accent.wav'));
  const recordingPlayer=useAudioPlayer(null);
  const recorder=useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState=useAudioRecorderState(recorder,200);

  const onBuffer=useCallback((buffer)=>{
    bufferCounter.current++;
    if(bufferCounter.current%2!==0) return;
    let samples;
    try { samples=new Float32Array(buffer.data); } catch { return; }
    const found=detectPitch(samples,buffer.sampleRate||48000);
    if(!found) return;
    const midi=hzToMidi(found.hz), rounded=Math.round(midi), cents=centsOff(found.hz,rounded);
    const item={hz:found.hz,midi:rounded,name:midiName(rounded),cents,rms:found.rms,confidence:found.confidence,at:Date.now()};
    pitchHistory.current=[...pitchHistory.current.slice(-11),item];
    const centsList=pitchHistory.current.map(x=>x.cents);
    const mean=centsList.reduce((a,b)=>a+b,0)/centsList.length;
    const variance=centsList.reduce((a,b)=>a+(b-mean)*(b-mean),0)/Math.max(1,centsList.length);
    const stable=clamp(100-Math.sqrt(variance)*2.3,0,100);
    setPitch(item); setStability(stable);

    const p=practiceRef.current;
    if(p.active && p.events.length){
      const stepMs=(60000/p.bpm)*p.factor;
      const elapsed=Date.now()-p.start;
      const idx=Math.floor(elapsed/stepMs);
      if(idx>=0 && idx<p.events.length && idx!==p.lastIdx){
        p.lastIdx=idx; p.total++;
        const expected=p.events[idx];
        const noteOk=Math.abs(item.midi-expected.midi)<=0 && Math.abs(item.cents)<=45;
        const target=idx*stepMs;
        const offset=elapsed-target;
        const timingOk=Math.abs(offset)<=95;
        if(noteOk)p.pitchHit++; if(timingOk)p.timingHit++;
        p.stability.push(stable);
        setLastJudge({idx,noteOk,timingOk,offset:Math.round(offset),expected:midiName(expected.midi),heard:item.name});
      }
    }
  },[]);
  const {stream,isStreaming}=useAudioStream({sampleRate:48000,channels:1,encoding:'float32',onBuffer});

  useEffect(()=>{ AsyncStorage.getItem(STORAGE_KEY).then(v=>{if(v)try{setSessions(JSON.parse(v));}catch{}}); },[]);
  useEffect(()=>{
    if(!metroOn) return;
    let localBeat=0, bars=0;
    const tick=()=>{
      setBeat(localBeat);
      try { const p=localBeat===0?accentPlayer:clickPlayer; p.seekTo(0); p.play(); } catch {}
      localBeat=(localBeat+1)%timeSig;
      if(localBeat===0){ bars++; if(ramp && bars%4===0) setBpm(x=>clamp(x+2,40,220)); }
    };
    tick(); const id=setInterval(tick,60000/bpm); return()=>clearInterval(id);
  },[metroOn,bpm,timeSig,ramp,clickPlayer,accentPlayer]);

  const regenerate=()=>setExercise(makeExercise({root,scale,category,difficulty}));
  useEffect(()=>{regenerate();},[root,scale,category,difficulty]);

  async function ensureMic(){
    const p=await AudioModule.requestRecordingPermissionsAsync();
    if(!p.granted){ Alert.alert('마이크 권한 필요','음정/타이밍 분석과 녹음을 위해 마이크 권한을 허용해 주세요.'); return false; }
    await setAudioModeAsync({playsInSilentMode:true,allowsRecording:true});
    return true;
  }
  async function toggleLive(){
    if(isStreaming){ await stream.stop(); setLive(false); return; }
    if(!(await ensureMic())) return;
    pitchHistory.current=[]; await stream.start(); setLive(true);
  }
  async function startPractice(){
    if(!(await ensureMic())) return;
    pitchHistory.current=[]; setLastJudge(null);
    practiceRef.current={active:true,start:Date.now()+250,lastIdx:-1,pitchHit:0,timingHit:0,total:0,stability:[],bpm,events:exercise,factor:rhythm.factor};
    if(!isStreaming) await stream.start();
    setLive(true); setMetroOn(true);
  }
  async function finishPractice(){
    const p=practiceRef.current; p.active=false; setMetroOn(false);
    const total=Math.max(1,p.total);
    const pitchScore=Math.round(100*p.pitchHit/total), timingScore=Math.round(100*p.timingHit/total);
    const stableScore=Math.round(p.stability.length?p.stability.reduce((a,b)=>a+b,0)/p.stability.length:0);
    const overall=Math.round(pitchScore*.45+timingScore*.4+stableScore*.15);
    const oldBpm=bpm; const next=overall>=90?clamp(bpm+4,40,220):overall<70?clamp(bpm-4,40,220):bpm;
    setBpm(next);
    const session={id:Date.now(),date:new Date().toISOString(),category,root,scale,difficulty,bpm:oldBpm,nextBpm:next,pitch:pitchScore,timing:timingScore,stability:stableScore,score:overall};
    const updated=[session,...sessions].slice(0,100); setSessions(updated); await AsyncStorage.setItem(STORAGE_KEY,JSON.stringify(updated));
    Alert.alert(`세션 ${overall}점`, `Pitch ${pitchScore}% · Timing ${timingScore}% · Stability ${stableScore}%\nBPM ${oldBpm} → ${next}`);
  }
  async function toggleRecord(){
    try{
      if(recorderState.isRecording){ await recorder.stop(); setRecordingUri(recorder.uri||null); return; }
      if(isStreaming){ await stream.stop(); setLive(false); }
      if(!(await ensureMic())) return;
      await recorder.prepareToRecordAsync(); recorder.record();
    }catch(e){Alert.alert('녹음 오류',String(e?.message||e));}
  }
  function playRecording(){ if(!recordingUri)return; recordingPlayer.replace(recordingUri); recordingPlayer.play(); }

  const stats=useMemo(()=>{
    if(!sessions.length) return {count:0,best:0,avg:0,weak:'데이터 수집 전',minutes:0};
    const by={}; sessions.forEach(x=>{(by[x.category]??=[]).push(x.score);});
    let weak=Object.keys(by)[0]; Object.keys(by).forEach(k=>{const a=by[k].reduce((x,y)=>x+y,0)/by[k].length;const w=by[weak].reduce((x,y)=>x+y,0)/by[weak].length;if(a<w)weak=k;});
    return {count:sessions.length,best:Math.max(...sessions.map(x=>x.bpm)),avg:Math.round(sessions.reduce((a,b)=>a+b.score,0)/sessions.length),weak,minutes:Math.round(sessions.length*3.5)};
  },[sessions]);

  const nav=['Home','Practice','Tempo','Studio','Coach'];
  return <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.bg}/><View style={s.shell}>
    <View style={s.top}><View><Text style={s.logo}>GUITAR<Text style={{color:C.green}}>TEMPO</Text></Text><Text style={s.topSub}>precision practice system</Text></View><View style={s.liveDotWrap}><View style={[s.liveDot,{backgroundColor:isStreaming?C.green:C.muted}]}/><Text style={s.liveDotText}>{isStreaming?'MIC LIVE':'READY'}</Text></View></View>
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      {tab==='Home'&&<Home stats={stats} bpm={bpm} setTab={setTab} sessions={sessions}/>} 
      {tab==='Practice'&&<Practice root={root} setRoot={setRoot} scale={scale} setScale={setScale} category={category} setCategory={setCategory} difficulty={difficulty} setDifficulty={setDifficulty} rhythm={rhythm} setRhythm={setRhythm} bpm={bpm} setBpm={setBpm} exercise={exercise} regenerate={regenerate} startPractice={startPractice} finishPractice={finishPractice} active={practiceRef.current.active} lastJudge={lastJudge}/>} 
      {tab==='Tempo'&&<Tempo bpm={bpm} setBpm={setBpm} on={metroOn} setOn={setMetroOn} beat={beat} timeSig={timeSig} setTimeSig={setTimeSig} ramp={ramp} setRamp={setRamp}/>} 
      {tab==='Studio'&&<Studio pitch={pitch} stability={stability} live={live} isStreaming={isStreaming} toggleLive={toggleLive} recording={recorderState.isRecording} duration={recorderState.durationMillis||0} toggleRecord={toggleRecord} recordingUri={recordingUri} playRecording={playRecording}/>} 
      {tab==='Coach'&&<Coach sessions={sessions} stats={stats} setCategory={setCategory} setTab={setTab}/>} 
    </ScrollView>
    <View style={s.nav}>{nav.map(n=><Pressable key={n} onPress={()=>setTab(n)} style={s.navItem}><Text style={[s.navIcon,tab===n&&{color:C.green}]}>{({Home:'⌂',Practice:'♬',Tempo:'◉',Studio:'⌁',Coach:'◇'})[n]}</Text><Text style={[s.navText,tab===n&&{color:C.green}]}>{n}</Text></Pressable>)}</View>
  </View></SafeAreaView>;
}

function Home({stats,bpm,setTab,sessions}){
  const last=sessions[0];
  return <View><SectionTitle eyebrow="TODAY'S SESSION" title="연습을 측정하면, 실력이 보인다." desc="음정 · 타이밍 · 안정성을 듣고 다음 템포를 자동으로 결정합니다."/>
    <Card style={s.hero}><Text style={s.heroKicker}>ADAPTIVE TARGET</Text><Text style={s.heroBpm}>{bpm}<Text style={s.heroUnit}> BPM</Text></Text><Text style={s.heroText}>{last?`최근 ${last.category} ${last.score}점 · 다음 목표 ${last.nextBpm} BPM`:'A Minor Pentatonic · Mixed Technique로 첫 기준을 만들어보세요.'}</Text><BigButton title="연습 시작" onPress={()=>setTab('Practice')}/></Card>
    <View style={s.metricRow}><Metric label="SESSIONS" value={stats.count}/><Metric label="BEST BPM" value={stats.best||'—'} color={C.cyan}/><Metric label="AVG SCORE" value={stats.count?`${stats.avg}%`:'—'} color={scoreColor(stats.avg)}/></View>
    <Card><Text style={s.cardTitle}>Smart Coach</Text><Text style={s.coachBig}>{stats.count?`${stats.weak} 집중`:'첫 연주를 들려주세요'}</Text><Text style={s.desc}>{stats.count?'가장 낮은 평균 점수의 테크닉부터 자동으로 우선 배치합니다.':'세션을 저장하면 앱이 약점과 안정 BPM을 학습합니다.'}</Text><View style={{height:12}}/><BigButton kind="ghost" title="Coach 열기" onPress={()=>setTab('Coach')}/></Card>
  </View>;
}
function Practice(p){
  const tab=renderTab(p.exercise);
  return <View><SectionTitle eyebrow="PRACTICE LAB" title="기타 전용 적응형 연습" desc="스케일 안에서 TAB을 만들고 실제 소리를 듣고 판정합니다."/>
    <Text style={s.label}>TECHNIQUE</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.hscroll}>{CATEGORIES.map(x=><Pill key={x} active={p.category===x} onPress={()=>p.setCategory(x)}>{x}</Pill>)}</ScrollView>
    <Text style={s.label}>ROOT</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.hscroll}>{ROOTS.map(x=><Pill small key={x} active={p.root===x} onPress={()=>p.setRoot(x)}>{x}</Pill>)}</ScrollView>
    <Text style={s.label}>SCALE</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.hscroll}>{Object.keys(SCALE_MAP).map(x=><Pill key={x} active={p.scale===x} onPress={()=>p.setScale(x)}>{x}</Pill>)}</ScrollView>
    <View style={s.twoCols}><View style={{flex:1}}><Text style={s.label}>LEVEL</Text><View style={s.wrap}>{DIFFICULTIES.map(x=><Pill small key={x} active={p.difficulty===x} onPress={()=>p.setDifficulty(x)}>{x}</Pill>)}</View></View><View style={{flex:1}}><Text style={s.label}>RHYTHM</Text><View style={s.wrap}>{RHYTHMS.map(x=><Pill small key={x.name} active={p.rhythm.name===x.name} onPress={()=>p.setRhythm(x)}>{x.label} {x.name}</Pill>)}</View></View></View>
    <Card style={s.tabCard}><View style={s.rowBetween}><View><Text style={s.cardTitle}>{p.root} {p.scale}</Text><Text style={s.mini}>{p.category} · {p.difficulty}</Text></View><Pressable onPress={p.regenerate}><Text style={s.regen}>↻ NEW</Text></Pressable></View><ScrollView horizontal showsHorizontalScrollIndicator={false}><Text style={s.tabText}>{tab}</Text></ScrollView><View style={s.legend}><Text style={s.mini}>h Hammer · p Pull · / \\ Slide · ↓↑ Picking</Text></View></Card>
    <Card><View style={s.rowBetween}><Text style={s.cardTitle}>Adaptive Tempo</Text><Text style={s.bpmSmall}>{p.bpm} BPM</Text></View><View style={s.bpmControls}><Pill onPress={()=>p.setBpm(clamp(p.bpm-2,40,220))}>−2</Pill><Text style={s.bpmCenter}>{p.bpm}</Text><Pill onPress={()=>p.setBpm(clamp(p.bpm+2,40,220))}>+2</Pill></View>{p.lastJudge?<View style={s.judge}><Text style={[s.judgeMain,{color:p.lastJudge.noteOk?C.green:C.red}]}>{p.lastJudge.heard} {p.lastJudge.noteOk?'✓':'≠'} {p.lastJudge.expected}</Text><Text style={[s.judgeSub,{color:p.lastJudge.timingOk?C.green:C.amber}]}>{p.lastJudge.offset>=0?'+':''}{p.lastJudge.offset} ms</Text></View>:<Text style={s.desc}>시작하면 마이크가 각 박의 기대 음과 실제 음, 타이밍을 비교합니다.</Text>}<View style={{height:12}}/>{p.active?<BigButton kind="danger" title="세션 종료 · 점수 저장" onPress={p.finishPractice}/>:<BigButton title="LIVE 판정 연습 시작" onPress={p.startPractice}/>}</Card>
  </View>;
}
function Tempo({bpm,setBpm,on,setOn,beat,timeSig,setTimeSig,ramp,setRamp}){
  const taps=useRef([]);
  const tap=()=>{const now=Date.now();taps.current=[...taps.current.filter(x=>now-x<3000),now].slice(-6);if(taps.current.length>1){let sum=0;for(let i=1;i<taps.current.length;i++)sum+=taps.current[i]-taps.current[i-1];setBpm(clamp(Math.round(60000/(sum/(taps.current.length-1))),40,220));}};
  return <View><SectionTitle eyebrow="TEMPO ENGINE" title="박자를 몸에 새기는 메트로놈" desc="강박, 박자표, Tap Tempo와 자동 Tempo Ramp."/>
    <Card style={s.metroCard}><Text style={s.metroNum}>{bpm}</Text><Text style={s.metroUnit}>BEATS PER MINUTE</Text><View style={s.beats}>{Array.from({length:timeSig},(_,i)=><View key={i} style={[s.beat,{backgroundColor:on&&beat===i?(i===0?C.green:C.cyan):C.line}]}/>)}</View><View style={s.bpmControls}><Pill onPress={()=>setBpm(clamp(bpm-5,40,220))}>−5</Pill><Pill onPress={()=>setBpm(clamp(bpm-1,40,220))}>−1</Pill><Pill onPress={()=>setBpm(clamp(bpm+1,40,220))}>+1</Pill><Pill onPress={()=>setBpm(clamp(bpm+5,40,220))}>+5</Pill></View><BigButton title={on?'STOP':'START'} kind={on?'danger':'primary'} onPress={()=>setOn(!on)}/></Card>
    <View style={s.twoCols}><Card style={{flex:1}}><Text style={s.label}>TIME SIGNATURE</Text><View style={s.wrap}>{[2,3,4,5,6,7].map(x=><Pill small key={x} active={timeSig===x} onPress={()=>setTimeSig(x)}>{x}/4</Pill>)}</View></Card><Card style={{flex:1}}><Text style={s.label}>TEMPO RAMP</Text><Text style={s.desc}>4마디마다 +2 BPM</Text><View style={{height:10}}/><Pill active={ramp} onPress={()=>setRamp(!ramp)}>{ramp?'RAMP ON':'RAMP OFF'}</Pill></Card></View>
    <BigButton kind="ghost" title="TAP TEMPO" onPress={tap}/>
  </View>;
}
function Studio({pitch,stability,isStreaming,toggleLive,recording,duration,toggleRecord,recordingUri,playRecording}){
  const cents=pitch?clamp(pitch.cents,-50,50):0;
  return <View><SectionTitle eyebrow="STUDIO ANALYZER" title="연주를 눈으로 확인하세요" desc="튜너가 아니라 시간축 연주 분석을 위한 실시간 PCM 엔진입니다."/>
    <Card style={s.tuner}><Text style={s.detectLabel}>DETECTED NOTE</Text><Text style={s.note}>{pitch?.name||'—'}</Text><Text style={[s.cents,{color:!pitch?C.muted:Math.abs(pitch.cents)<8?C.green:Math.abs(pitch.cents)<20?C.amber:C.red}]}>{pitch?`${pitch.cents>=0?'+':''}${pitch.cents.toFixed(1)} cents`:'마이크를 시작하세요'}</Text><View style={s.gauge}><View style={s.gaugeCenter}/><View style={[s.gaugeNeedle,{left:`${50+cents}%`}]} /></View><View style={s.metricRow}><Metric label="FREQUENCY" value={pitch?`${pitch.hz.toFixed(1)} Hz`:'—'}/><Metric label="STABILITY" value={pitch?`${Math.round(stability)}%`:'—'} color={scoreColor(stability)}/><Metric label="LEVEL" value={pitch?`${Math.round(20*Math.log10(Math.max(.00001,pitch.rms)))} dB`:'—'}/></View><BigButton title={isStreaming?'LIVE ANALYZER STOP':'LIVE ANALYZER START'} kind={isStreaming?'danger':'primary'} onPress={toggleLive}/></Card>
    <Card><Text style={s.cardTitle}>Performance Recorder</Text><Text style={s.desc}>원본 연주를 녹음해 다시 듣습니다. 분석 스트림과 녹음은 마이크 충돌을 막기 위해 자동 전환됩니다.</Text><View style={{height:14}}/><Text style={s.recordTime}>{recording?`${(duration/1000).toFixed(1)}s REC`:(recordingUri?'녹음 준비됨':'새 녹음')}</Text><View style={s.twoCols}><BigButton title={recording?'녹음 종료':'녹음 시작'} kind={recording?'danger':'primary'} onPress={toggleRecord}/><BigButton title="재생" kind="ghost" disabled={!recordingUri} onPress={playRecording}/></View></Card>
    <Card><Text style={s.cardTitle}>Technique Analysis</Text><View style={s.techGrid}>{['Bend +100c','Bend +200c','Vibrato Width','Vibrato Rate','Attack','Sustain','Intonation 12F','Noise'].map(x=><View key={x} style={s.techBox}><Text style={s.techText}>{x}</Text></View>)}</View><Text style={[s.desc,{marginTop:12}]}>실시간 cents와 pitch history를 기반으로 벤딩·비브라토·어택·서스테인 판정으로 확장되는 분석 레이어입니다.</Text></Card>
  </View>;
}
function Coach({sessions,stats,setCategory,setTab}){
  const recent=sessions.slice(0,8);
  const goWeak=()=>{if(stats.count)setCategory(stats.weak);setTab('Practice');};
  return <View><SectionTitle eyebrow="SMART COACH" title="약점부터 자동으로 다시 연습" desc="저장된 실제 세션만 사용해 추천합니다."/>
    <View style={s.metricRow}><Metric label="TOTAL" value={stats.count}/><Metric label="BEST BPM" value={stats.best||'—'} color={C.cyan}/><Metric label="PRACTICE" value={`${stats.minutes}m`} color={C.green}/></View>
    <Card style={s.coachCard}><Text style={s.heroKicker}>CURRENT FOCUS</Text><Text style={s.coachBig}>{stats.count?stats.weak:'Baseline 필요'}</Text><Text style={s.desc}>{stats.count?`평균이 가장 낮은 테크닉입니다. 안정 BPM에서 정확도를 먼저 올리고 속도를 확장하세요.`:'Practice에서 첫 LIVE 판정 세션을 완료하면 추천이 시작됩니다.'}</Text><View style={{height:14}}/><BigButton title={stats.count?`${stats.weak} 바로 연습`:'첫 세션 시작'} onPress={goWeak}/></Card>
    <Text style={s.label}>RECENT SESSIONS</Text>{recent.length?recent.map(x=><Card key={x.id} style={s.session}><View><Text style={s.sessionTitle}>{x.root} {x.scale} · {x.category}</Text><Text style={s.mini}>{new Date(x.date).toLocaleDateString()} · {x.bpm} → {x.nextBpm} BPM</Text></View><View style={{alignItems:'flex-end'}}><Text style={[s.sessionScore,{color:scoreColor(x.score)}]}>{x.score}</Text><Text style={s.mini}>P{x.pitch} T{x.timing} S{x.stability}</Text></View></Card>):<Text style={s.desc}>아직 저장된 세션이 없습니다.</Text>}
  </View>;
}

const W=Dimensions.get('window').width;
const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},shell:{flex:1,backgroundColor:C.bg},content:{padding:18,paddingBottom:120},
  top:{height:70,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:C.line},logo:{color:C.white,fontSize:18,fontWeight:'900',letterSpacing:1.2},topSub:{color:C.muted,fontSize:10,letterSpacing:1.4,marginTop:2},liveDotWrap:{flexDirection:'row',alignItems:'center',gap:7},liveDot:{width:7,height:7,borderRadius:9},liveDotText:{color:C.muted,fontSize:10,fontWeight:'800'},
  eyebrow:{color:C.green,fontSize:11,fontWeight:'900',letterSpacing:2,marginBottom:7},h1:{color:C.white,fontSize:27,fontWeight:'900',lineHeight:33},desc:{color:C.muted,fontSize:13,lineHeight:20,marginTop:7},
  card:{backgroundColor:C.card,borderRadius:20,padding:17,borderWidth:1,borderColor:C.line,marginBottom:14},hero:{backgroundColor:'#10251C',padding:20},heroKicker:{color:C.green,fontSize:10,fontWeight:'900',letterSpacing:2},heroBpm:{fontSize:60,color:C.white,fontWeight:'900',marginTop:3},heroUnit:{fontSize:15,color:C.muted},heroText:{color:C.muted,lineHeight:20,marginBottom:18},
  label:{color:C.muted,fontSize:10,fontWeight:'900',letterSpacing:1.5,marginTop:5,marginBottom:9},hscroll:{marginBottom:13},pill:{borderWidth:1,borderColor:C.line,backgroundColor:C.card2,borderRadius:99,paddingHorizontal:14,paddingVertical:9,marginRight:7,marginBottom:6},pillActive:{borderColor:C.green,backgroundColor:'#173A29'},pillText:{color:C.muted,fontSize:12,fontWeight:'800'},pillTextActive:{color:C.green},pillSmall:{paddingHorizontal:10,paddingVertical:7},pillTextSmall:{fontSize:11},wrap:{flexDirection:'row',flexWrap:'wrap'},
  bigBtn:{backgroundColor:C.green,borderRadius:14,paddingVertical:14,paddingHorizontal:16,alignItems:'center',justifyContent:'center',flex:1,minHeight:48},bigBtnGhost:{backgroundColor:C.card2,borderWidth:1,borderColor:C.line},bigBtnDanger:{backgroundColor:C.red},bigBtnText:{fontWeight:'900',fontSize:13,color:C.black,letterSpacing:.4},
  cardTitle:{color:C.white,fontSize:16,fontWeight:'900'},mini:{color:C.muted,fontSize:11,marginTop:3},regen:{color:C.green,fontWeight:'900',fontSize:12},rowBetween:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  metricRow:{flexDirection:'row',gap:8,marginBottom:14},metric:{flex:1,backgroundColor:C.card2,borderRadius:14,padding:11,borderWidth:1,borderColor:C.line},metricLabel:{color:C.muted,fontSize:8,fontWeight:'900',letterSpacing:1},metricValue:{fontSize:17,fontWeight:'900',marginTop:5},metricSub:{color:C.muted,fontSize:9},
  twoCols:{flexDirection:'row',gap:9},tabCard:{padding:15},tabText:{fontFamily:'monospace',color:C.white,fontSize:13,lineHeight:22,marginVertical:15},legend:{borderTopWidth:1,borderTopColor:C.line,paddingTop:9},
  bpmSmall:{color:C.green,fontSize:17,fontWeight:'900'},bpmControls:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,marginVertical:13},bpmCenter:{fontSize:34,fontWeight:'900',color:C.white,minWidth:75,textAlign:'center'},judge:{flexDirection:'row',justifyContent:'space-between',backgroundColor:C.card2,borderRadius:12,padding:12},judgeMain:{fontWeight:'900',fontSize:14},judgeSub:{fontWeight:'900',fontSize:14},
  metroCard:{alignItems:'center',padding:22},metroNum:{fontSize:94,fontWeight:'200',color:C.white,letterSpacing:-5},metroUnit:{color:C.muted,fontSize:10,letterSpacing:2,fontWeight:'800'},beats:{flexDirection:'row',gap:8,marginVertical:22},beat:{width:14,height:14,borderRadius:14},
  tuner:{alignItems:'stretch'},detectLabel:{textAlign:'center',color:C.muted,fontSize:10,fontWeight:'900',letterSpacing:2},note:{textAlign:'center',color:C.white,fontSize:86,fontWeight:'900',marginTop:5},cents:{textAlign:'center',fontSize:18,fontWeight:'900'},gauge:{height:34,backgroundColor:C.card2,borderRadius:12,marginVertical:18,position:'relative',overflow:'hidden'},gaugeCenter:{position:'absolute',left:'49.5%',top:0,bottom:0,width:2,backgroundColor:C.green},gaugeNeedle:{position:'absolute',top:5,bottom:5,width:3,backgroundColor:C.white,borderRadius:3},recordTime:{color:C.red,fontSize:20,fontWeight:'900',marginBottom:12},
  techGrid:{flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:13},techBox:{width:(W-18*2-17*2-7)/2,backgroundColor:C.card2,borderRadius:10,padding:11,borderWidth:1,borderColor:C.line},techText:{color:C.white,fontSize:11,fontWeight:'800'},
  coachBig:{color:C.white,fontSize:31,fontWeight:'900',marginTop:7},coachCard:{backgroundColor:'#10251C'},session:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:14},sessionTitle:{color:C.white,fontWeight:'800',fontSize:13},sessionScore:{fontSize:24,fontWeight:'900'},
  nav:{position:'absolute',left:0,right:0,bottom:0,height:76,backgroundColor:'#091510F2',borderTopWidth:1,borderTopColor:C.line,flexDirection:'row',paddingTop:9},navItem:{flex:1,alignItems:'center'},navIcon:{color:C.muted,fontSize:19,fontWeight:'900'},navText:{color:C.muted,fontSize:9,fontWeight:'800',marginTop:3},
});
