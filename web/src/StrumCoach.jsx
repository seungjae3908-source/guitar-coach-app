import { useEffect, useMemo, useRef, useState } from 'react';
import { createCalibration, fromGuitarSpace } from './strum/geometry.js';
import { AudioOnsetDetector, StrokeDetector, chooseStrumHand, sessionMetrics } from './strum/engine.js';
import { createHandTracker } from './strum/hand-tracker.js';

const LABELS = ['사운드홀 중심', '넥 방향의 한 점', '줄 영역 가장자리'];
const initialMetrics = { total: 0, down: 0, up: 0, currentBpm: 0, averageBpm: 0, consistency: 0 };

export default function StrumCoach() {
  const videoRef = useRef(null); const canvasRef = useRef(null); const resources = useRef({});
  const calibrationRef = useRef(null); const detectorRef = useRef(new StrokeDetector()); const strokesRef = useRef([]);
  const [phase, setPhase] = useState('idle'); const [points, setPoints] = useState([]); const [bpm, setBpm] = useState(80);
  const [metronome, setMetronome] = useState(true); const [duration, setDuration] = useState(30); const [remaining, setRemaining] = useState(30);
  const [metrics, setMetrics] = useState(initialMetrics); const [message, setMessage] = useState('카메라를 허용하고 기타 위치를 간단히 보정하세요.');
  const [audioMode, setAudioMode] = useState('audio'); const [result, setResult] = useState(null); const [tab, setTab] = useState('practice');
  const running = phase === 'running';
  const feedback = useMemo(() => {
    if (metrics.total < 4) return running ? '근거를 모으는 중입니다.' : message;
    if (metrics.consistency < 60) return `최근 스트로크 간격이 흔들립니다. ${Math.max(35, bpm - 5)} BPM으로 낮춰보세요.`;
    const diff = Math.abs(metrics.down - metrics.up); if (diff > 3) return `${metrics.down > metrics.up ? '다운' : '업'} 스트로크가 ${diff}회 더 많습니다.`;
    return '다운/업 균형과 박자 간격이 현재 측정 구간에서 고르게 유지됩니다.';
  }, [metrics, running, message, bpm]);

  useEffect(() => () => stopAll(), []);
  function stopAll() {
    cancelAnimationFrame(resources.current.raf); clearInterval(resources.current.timer); clearInterval(resources.current.clicker);
    resources.current.stream?.getTracks().forEach((track) => track.stop()); resources.current.tracker?.close?.(); resources.current.context?.close?.(); resources.current = {};
  }

  async function requestSensors() {
    setPhase('requesting'); setMessage('카메라와 마이크 권한을 확인하는 중입니다.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }); setAudioMode('vision'); }
      catch { setPhase('idle'); setMessage('카메라 권한이 필요합니다. 브라우저 설정을 확인하세요.'); return; }
    }
    resources.current.stream = stream; videoRef.current.srcObject = stream; await videoRef.current.play();
    setPoints([]); setPhase('calibrating'); setMessage(LABELS[0] + '을 누르세요.');
  }

  function addCalibrationPoint(event) {
    if (phase !== 'calibrating') return;
    const rect = event.currentTarget.getBoundingClientRect(); const point = { x: 1 - (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    const next = [...points, point]; setPoints(next);
    if (next.length < 3) { setMessage(LABELS[next.length] + '을 누르세요.'); return; }
    try { calibrationRef.current = createCalibration({ soundhole: next[0], neck: next[1], bandEdge: next[2], mirrored: true }); setPhase('ready'); setMessage('보정 완료. 기타와 손이 보이는지 확인한 뒤 시작하세요.'); }
    catch (error) { setPoints([]); setMessage(error.message === 'NECK_POINT_TOO_CLOSE' ? '넥 방향 점을 사운드홀에서 더 멀리 지정하세요.' : '줄 영역 가장자리를 사운드홀 중심에서 떨어뜨려 지정하세요.'); }
  }

  async function startPractice() {
    if (!calibrationRef.current) return; setResult(null); setMetrics(initialMetrics); strokesRef.current = []; detectorRef.current = new StrokeDetector();
    setRemaining(duration); setPhase('loading'); setMessage('손 추적 모델을 불러오는 중입니다.');
    try { resources.current.tracker = await createHandTracker(); } catch { setPhase('ready'); setMessage('손 추적 모델을 불러오지 못했습니다. 네트워크 연결을 확인하세요.'); return; }
    setupAudio(); setPhase('running'); setMessage(audioMode === 'audio' ? '영상 움직임과 기타 소리를 함께 분석합니다.' : '마이크 없이 영상만 분석합니다. 판정 신뢰도가 낮아질 수 있습니다.');
    const started = performance.now(); let previousPoint = null; let lastInference = 0;
    const loop = (now) => {
      if (now - lastInference >= 66 && videoRef.current?.readyState >= 2) {
        lastInference = now;
        const hands = resources.current.tracker.detect(videoRef.current, now); const selected = chooseStrumHand(hands, calibrationRef.current, previousPoint);
        if (selected?.point) { previousPoint = selected.point; const stroke = detectorRef.current.push({ timestamp: now, landmarks: selected.hand.landmarks, calibration: calibrationRef.current, trackingConfidence: selected.hand.score }); if (stroke && (stroke.audioConfirmed || audioMode === 'vision') && stroke.confidence >= (audioMode === 'vision' ? 0.42 : 0.55)) { strokesRef.current.push(stroke); setMetrics(sessionMetrics(strokesRef.current, bpm)); } }
        drawOverlay(selected?.point);
      }
      resources.current.raf = requestAnimationFrame(loop);
    }; resources.current.raf = requestAnimationFrame(loop);
    resources.current.timer = setInterval(() => { const left = Math.max(0, duration - Math.floor((performance.now() - started) / 1000)); setRemaining(left); if (!left) finishPractice(); }, 250);
    if (metronome) resources.current.clicker = setInterval(playClick, 60000 / bpm);
  }

  function setupAudio() {
    const audioTrack = resources.current.stream?.getAudioTracks()[0]; if (!audioTrack) return;
    const context = new AudioContext({ latencyHint: 'interactive' }); const source = context.createMediaStreamSource(new MediaStream([audioTrack])); const analyser = context.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
    const data = new Float32Array(analyser.fftSize); const onset = new AudioOnsetDetector(); resources.current.context = context;
    const sample = () => { if (!resources.current.context) return; analyser.getFloatTimeDomainData(data); const rms = Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length); detectorRef.current.addOnset(onset.push(rms, performance.now())); resources.current.audioRaf = requestAnimationFrame(sample); }; sample();
  }
  function playClick() { const context = resources.current.context; if (!context) return; const oscillator = context.createOscillator(); const gain = context.createGain(); gain.gain.value = 0.06; oscillator.frequency.value = 900; oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.04); }
  function finishPractice() { cancelAnimationFrame(resources.current.raf); cancelAnimationFrame(resources.current.audioRaf); clearInterval(resources.current.timer); clearInterval(resources.current.clicker); const summary = sessionMetrics(strokesRef.current, bpm); setMetrics(summary); setResult(summary); setPhase('result'); }
  function drawOverlay(handPoint) {
    const canvas = canvasRef.current; if (!canvas || !calibrationRef.current) return; const ctx = canvas.getContext('2d'); const w = canvas.width = canvas.clientWidth * devicePixelRatio; const h = canvas.height = canvas.clientHeight * devicePixelRatio; ctx.clearRect(0, 0, w, h); ctx.lineWidth = 3 * devicePixelRatio; ctx.strokeStyle = '#62e6a7';
    const c = calibrationRef.current; const corners = [[c.strumZone.alongMin,c.strumZone.acrossMin],[c.strumZone.alongMax,c.strumZone.acrossMin],[c.strumZone.alongMax,c.strumZone.acrossMax],[c.strumZone.alongMin,c.strumZone.acrossMax]].map(([along,across]) => fromGuitarSpace({along,across},c)); ctx.beginPath(); corners.forEach((p,i) => i ? ctx.lineTo(p.x*w,p.y*h) : ctx.moveTo(p.x*w,p.y*h)); ctx.closePath(); ctx.stroke();
    if (handPoint) { ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(handPoint.x*w, handPoint.y*h, 8*devicePixelRatio, 0, Math.PI*2); ctx.fill(); }
  }

  return <div className="coach-shell">
    <header><div><span className="kicker">GUITAR COACH</span><h1>스트럼 연습</h1></div><span className={`mode-pill ${audioMode}`}>{audioMode === 'audio' ? '카메라 + 마이크' : '영상 전용 모드'}</span></header>
    {tab === 'practice' && <main>
      <section className="controls"><label>BPM <input type="range" min="35" max="180" value={bpm} disabled={running} onChange={(e)=>setBpm(Number(e.target.value))}/><strong>{bpm}</strong></label><label><input type="checkbox" checked={metronome} disabled={running} onChange={(e)=>setMetronome(e.target.checked)}/> 메트로놈</label><select value={duration} disabled={running} onChange={(e)=>setDuration(Number(e.target.value))}><option value="30">30초</option><option value="60">60초</option></select></section>
      <section className="camera-card" onClick={addCalibrationPoint}><video ref={videoRef} playsInline muted/><canvas ref={canvasRef}/>{points.map((p,i)=><span key={i} className="calibration-point" style={{left:`${(1-p.x)*100}%`,top:`${p.y*100}%`}}>{i+1}</span>)}<div className="camera-status">{running ? `${remaining}초` : message}</div></section>
      <div className="primary-actions">{phase === 'idle' && <button onClick={requestSensors}>카메라 시작</button>}{phase === 'ready' && <button onClick={startPractice}>연습 시작</button>}{running && <button onClick={finishPractice}>연습 종료</button>}{phase === 'result' && <button onClick={()=>setPhase('ready')}>다시 연습</button>}</div>
      <section className="live-metrics"><div><strong>{metrics.currentBpm || '—'}</strong><span>BPM</span></div><div><strong>{metrics.down} / {metrics.up}</strong><span>DOWN / UP</span></div><div><strong>{metrics.consistency || '—'}</strong><span>박자 안정도</span></div></section>
      <p className="feedback">{feedback}</p>
      {result && <section className="results"><h2>연습 결과</h2><dl><div><dt>총 스트로크</dt><dd>{result.total}</dd></div><div><dt>평균 BPM</dt><dd>{result.averageBpm || '측정 부족'}</dd></div><div><dt>평균 박자 오차</dt><dd>{result.averageOffsetMs} ms</dd></div><div><dt>놓친 박 추정</dt><dd>{result.missedBeatEstimate}</dd></div></dl></section>}
    </main>}
    {tab !== 'practice' && <main className="empty-state"><h2>{tab === 'history' ? '기록' : '설정'}</h2><p>이 화면은 아직 데이터를 제공하지 않습니다.</p></main>}
    <nav className="bottom-nav"><button className={tab==='practice'?'active':''} onClick={()=>setTab('practice')}>연습</button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>기록</button><button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}>설정</button></nav>
  </div>;
}
