import { useEffect, useMemo, useRef, useState } from 'react';
import { createCalibration, fromGuitarSpace } from './strum/geometry.js';
import { AudioOnsetDetector, StrokeDetector, chooseStrumHand, sessionMetrics } from './strum/engine.js';
import { createHandTracker } from './strum/hand-tracker.js';

const LABELS = ['?ъ슫?쒗? 以묒떖', '??諛⑺뼢??????, '以??곸뿭 媛?μ옄由?];
const initialMetrics = { total: 0, down: 0, up: 0, currentBpm: 0, averageBpm: 0, consistency: 0 };

export default function StrumCoach() {
  const videoRef = useRef(null); const canvasRef = useRef(null); const resources = useRef({});
  const calibrationRef = useRef(null); const detectorRef = useRef(new StrokeDetector()); const strokesRef = useRef([]);
  const [phase, setPhase] = useState('idle'); const [points, setPoints] = useState([]); const [bpm, setBpm] = useState(80);
  const [metronome, setMetronome] = useState(true); const [duration, setDuration] = useState(30); const [remaining, setRemaining] = useState(30);
  const [metrics, setMetrics] = useState(initialMetrics); const [message, setMessage] = useState('移대찓?쇰? ?덉슜?섍퀬 湲고? ?꾩튂瑜?媛꾨떒??蹂댁젙?섏꽭??');
  const [audioMode, setAudioMode] = useState('audio'); const [result, setResult] = useState(null); const [tab, setTab] = useState('practice');
  const running = phase === 'running';
  const feedback = useMemo(() => {
    if (metrics.total < 4) return running ? '洹쇨굅瑜?紐⑥쑝??以묒엯?덈떎.' : message;
    if (metrics.consistency < 60) return `理쒓렐 ?ㅽ듃濡쒗겕 媛꾧꺽???붾뱾由쎈땲?? ${Math.max(35, bpm - 5)} BPM?쇰줈 ??떠蹂댁꽭??`;
    const diff = Math.abs(metrics.down - metrics.up); if (diff > 3) return `${metrics.down > metrics.up ? '?ㅼ슫' : '??} ?ㅽ듃濡쒗겕媛 ${diff}????留롮뒿?덈떎.`;
    return '?ㅼ슫/??洹좏삎怨?諛뺤옄 媛꾧꺽???꾩옱 痢≪젙 援ш컙?먯꽌 怨좊Ⅴ寃??좎??⑸땲??';
  }, [metrics, running, message, bpm]);

  useEffect(() => () => stopAll(), []);
  function stopAll() {
    cancelAnimationFrame(resources.current.raf); clearInterval(resources.current.timer); clearInterval(resources.current.clicker);
    resources.current.stream?.getTracks().forEach((track) => track.stop()); resources.current.tracker?.close?.(); resources.current.context?.close?.(); resources.current = {};
  }

  async function requestSensors() {
    setPhase('requesting'); setMessage('移대찓?쇱? 留덉씠??沅뚰븳???뺤씤?섎뒗 以묒엯?덈떎.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }); setAudioMode('vision'); }
      catch { setPhase('idle'); setMessage('移대찓??沅뚰븳???꾩슂?⑸땲?? 釉뚮씪?곗? ?ㅼ젙???뺤씤?섏꽭??'); return; }
    }
    resources.current.stream = stream; videoRef.current.srcObject = stream; await videoRef.current.play();
    setPoints([]); setPhase('calibrating'); setMessage(LABELS[0] + '???꾨Ⅴ?몄슂.');
  }

  function addCalibrationPoint(event) {
    if (phase !== 'calibrating') return;
    const rect = event.currentTarget.getBoundingClientRect(); const point = { x: 1 - (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    const next = [...points, point]; setPoints(next);
    if (next.length < 3) { setMessage(LABELS[next.length] + '???꾨Ⅴ?몄슂.'); return; }
    try { calibrationRef.current = createCalibration({ soundhole: next[0], neck: next[1], bandEdge: next[2], mirrored: true }); setPhase('ready'); setMessage('蹂댁젙 ?꾨즺. 湲고?? ?먯씠 蹂댁씠?붿? ?뺤씤?????쒖옉?섏꽭??'); }
    catch (error) { setPoints([]); setMessage(error.message === 'NECK_POINT_TOO_CLOSE' ? '??諛⑺뼢 ?먯쓣 ?ъ슫?쒗??먯꽌 ??硫由?吏?뺥븯?몄슂.' : '以??곸뿭 媛?μ옄由щ? ?ъ슫?쒗? 以묒떖?먯꽌 ?⑥뼱?⑤젮 吏?뺥븯?몄슂.'); }
  }

  async function startPractice() {
    if (!calibrationRef.current) return; setResult(null); setMetrics(initialMetrics); strokesRef.current = []; detectorRef.current = new StrokeDetector();
    setRemaining(duration); setPhase('loading'); setMessage('??異붿쟻 紐⑤뜽??遺덈윭?ㅻ뒗 以묒엯?덈떎.');
    try { resources.current.tracker = await createHandTracker(); } catch { setPhase('ready'); setMessage('??異붿쟻 紐⑤뜽??遺덈윭?ㅼ? 紐삵뻽?듬땲?? ?ㅽ듃?뚰겕 ?곌껐???뺤씤?섏꽭??'); return; }
    setupAudio(); setPhase('running'); setMessage(audioMode === 'audio' ? '?곸긽 ?吏곸엫怨?湲고? ?뚮━瑜??④퍡 遺꾩꽍?⑸땲??' : '留덉씠???놁씠 ?곸긽留?遺꾩꽍?⑸땲?? ?먯젙 ?좊ː?꾧? ??븘吏????덉뒿?덈떎.');
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
    <header><div><span className="kicker">GUITAR COACH</span><h1>?ㅽ듃???곗뒿</h1></div><span className={`mode-pill ${audioMode}`}>{audioMode === 'audio' ? '移대찓??+ 留덉씠?? : '?곸긽 ?꾩슜 紐⑤뱶'}</span></header>
    {tab === 'practice' && <main>
      <section className="controls"><label>BPM <input type="range" min="35" max="180" value={bpm} disabled={running} onChange={(e)=>setBpm(Number(e.target.value))}/><strong>{bpm}</strong></label><label><input type="checkbox" checked={metronome} disabled={running} onChange={(e)=>setMetronome(e.target.checked)}/> 硫뷀듃濡쒕냸</label><select value={duration} disabled={running} onChange={(e)=>setDuration(Number(e.target.value))}><option value="30">30珥?/option><option value="60">60珥?/option></select></section>
      <section className="camera-card" onClick={addCalibrationPoint}><video ref={videoRef} playsInline muted/><canvas ref={canvasRef}/>{points.map((p,i)=><span key={i} className="calibration-point" style={{left:`${(1-p.x)*100}%`,top:`${p.y*100}%`}}>{i+1}</span>)}<div className="camera-status">{running ? `${remaining}珥? : message}</div></section>
      <div className="primary-actions">{phase === 'idle' && <button onClick={requestSensors}>移대찓???쒖옉</button>}{phase === 'ready' && <button onClick={startPractice}>?곗뒿 ?쒖옉</button>}{running && <button onClick={finishPractice}>?곗뒿 醫낅즺</button>}{phase === 'result' && <button onClick={()=>setPhase('ready')}>?ㅼ떆 ?곗뒿</button>}</div>
      <section className="live-metrics"><div><strong>{metrics.currentBpm || '??}</strong><span>BPM</span></div><div><strong>{metrics.down} / {metrics.up}</strong><span>DOWN / UP</span></div><div><strong>{metrics.consistency || '??}</strong><span>諛뺤옄 ?덉젙??/span></div></section>
      <p className="feedback">{feedback}</p>
      {result && <section className="results"><h2>?곗뒿 寃곌낵</h2><dl><div><dt>珥??ㅽ듃濡쒗겕</dt><dd>{result.total}</dd></div><div><dt>?됯퇏 BPM</dt><dd>{result.averageBpm || '痢≪젙 遺議?}</dd></div><div><dt>?됯퇏 諛뺤옄 ?ㅼ감</dt><dd>{result.averageOffsetMs} ms</dd></div><div><dt>?볦튇 諛?異붿젙</dt><dd>{result.missedBeatEstimate}</dd></div></dl></section>}
    </main>}
    {tab !== 'practice' && <main className="empty-state"><h2>{tab === 'history' ? '湲곕줉' : '?ㅼ젙'}</h2><p>???붾㈃? ?꾩쭅 ?곗씠?곕? ?쒓났?섏? ?딆뒿?덈떎.</p></main>}
    <nav className="bottom-nav"><button className={tab==='practice'?'active':''} onClick={()=>setTab('practice')}>?곗뒿</button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>湲곕줉</button><button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}>?ㅼ젙</button></nav>
  </div>;
}
