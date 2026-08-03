import { useEffect, useMemo, useRef, useState } from 'react';
import './debug-center.css';

const TESTS = [
  { id: 'camera', title: '카메라 연결', instruction: '카메라 허용을 누르고 기타와 오른손이 화면에 보이게 세워 주세요.', mode: 'auto' },
  { id: 'feed', title: '검은 화면 검사', instruction: '카메라를 가리지 말고 화면이 실제로 보이는지 3초간 유지해 주세요.', mode: 'auto' },
  { id: 'hand', title: '오른손 위치', instruction: '오른손 전체가 잘리지 않게 화면 중앙에 3초간 보여 주세요.', mode: 'confirm' },
  { id: 'guitar', title: '기타와 줄 위치', instruction: '브리지와 줄이 보이게 기타를 화면 안에 맞춰 주세요.', mode: 'confirm' },
  { id: 'down', title: '다운 스트럼', instruction: '다운 스트럼을 천천히 5번 해 주세요.', mode: 'motion' },
  { id: 'up', title: '업 스트럼', instruction: '업 스트럼을 천천히 5번 해 주세요.', mode: 'motion' },
  { id: 'voice', title: '음성 안내', instruction: '음성 테스트 버튼을 누르고 안내가 들리는지 확인해 주세요.', mode: 'voice' },
  { id: 'complete', title: '진단 완료', instruction: '진단 결과를 저장했습니다. 실패 항목은 해결될 때까지 다시 검사합니다.', mode: 'finish' },
];

const initialResults = Object.fromEntries(TESTS.map((test) => [test.id, { status: 'pending', note: '' }]));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const timeLabel = () => new Date().toLocaleTimeString('ko-KR', { hour12: false });

async function digest(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function makeCode() {
  return Math.random().toString(36).slice(2, 5).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function LoginGate({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const stored = localStorage.getItem('gc-debug-pin-hash');
  const setup = !stored;

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!/^\d{4,8}$/.test(pin)) {
      setError('숫자 4~8자리로 입력해 주세요.');
      return;
    }
    const hashed = await digest(pin);
    if (setup) {
      if (pin !== confirmPin) {
        setError('두 비밀번호가 다릅니다.');
        return;
      }
      localStorage.setItem('gc-debug-pin-hash', hashed);
    } else if (hashed !== stored) {
      setError('비밀번호가 맞지 않습니다.');
      return;
    }
    sessionStorage.setItem('gc-debug-unlocked', '1');
    onUnlock();
  };

  return (
    <div className="debug-login-shell">
      <form className="debug-login-card" onSubmit={submit}>
        <div className="debug-logo">GC</div>
        <span className="debug-kicker">GUITAR COACH DEBUG CENTER</span>
        <h1>{setup ? '진단센터 비밀번호 만들기' : '진단센터 로그인'}</h1>
        <p>이 비밀번호는 현재 브라우저에만 저장됩니다. 카메라 영상은 사용자가 전송을 켜기 전까지 서버로 보내지지 않습니다.</p>
        <label>
          비밀번호
          <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password" autoFocus />
        </label>
        {setup ? (
          <label>
            비밀번호 확인
            <input value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password" />
          </label>
        ) : null}
        {error ? <div className="debug-error">{error}</div> : null}
        <button className="debug-primary" type="submit">{setup ? '비밀번호 저장하고 시작' : '로그인'}</button>
      </form>
    </div>
  );
}

function StatusPill({ status }) {
  const labels = { pending: '대기', active: '검사 중', pass: '통과', fail: '재검사' };
  return <span className={`debug-pill ${status}`}>{labels[status] || status}</span>;
}

function DeviceCenter() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(0);
  const lastSampleRef = useRef(0);
  const previousGrayRef = useRef(null);
  const healthyFramesRef = useRef(0);
  const motionEventsRef = useRef([]);
  const currentIdRef = useRef('camera');
  const [sessionCode] = useState(() => localStorage.getItem('gc-debug-session') || makeCode());
  const [running, setRunning] = useState(false);
  const [facing, setFacing] = useState('environment');
  const [results, setResults] = useState(initialResults);
  const [currentId, setCurrentId] = useState('camera');
  const [stats, setStats] = useState({ fps: 0, brightness: 0, motion: 0, width: 0, height: 0, healthy: false });
  const [strokeCount, setStrokeCount] = useState(0);
  const [logs, setLogs] = useState([]);
  const [banner, setBanner] = useState('테스트 시작을 누르면 화면과 음성으로 한 단계씩 안내합니다.');
  const [thresholds, setThresholds] = useState({ minBrightness: 10, motionThreshold: 8 });
  const [voiceResult, setVoiceResult] = useState('');
  const [apiUrl] = useState(() => localStorage.getItem('gc-debug-api-url') || import.meta.env.VITE_DIAGNOSTIC_API_URL || '');

  useEffect(() => {
    localStorage.setItem('gc-debug-session', sessionCode);
  }, [sessionCode]);

  useEffect(() => {
    currentIdRef.current = currentId;
    const test = TESTS.find((item) => item.id === currentId);
    if (test && running) {
      setBanner(test.instruction);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(test.instruction);
        utterance.lang = 'ko-KR';
        utterance.rate = 1.02;
        window.speechSynthesis.speak(utterance);
      }
    }
  }, [currentId, running]);

  const addLog = (message, level = 'info') => {
    setLogs((current) => [{ at: timeLabel(), message, level }, ...current].slice(0, 60));
  };

  const updateResult = (id, status, note = '') => {
    setResults((current) => ({ ...current, [id]: { status, note } }));
  };

  const goNext = (finishedId, note = '') => {
    updateResult(finishedId, 'pass', note);
    const index = TESTS.findIndex((test) => test.id === finishedId);
    const next = TESTS[index + 1];
    if (next) {
      updateResult(next.id, 'active');
      setCurrentId(next.id);
      setStrokeCount(0);
      motionEventsRef.current = [];
    }
  };

  const sampleFrame = (timestamp) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;
    if (timestamp - lastSampleRef.current >= 180 && video.readyState >= 2) {
      lastSampleRef.current = timestamp;
      const width = 160;
      const height = 90;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(video, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const gray = new Uint8Array(width * height);
      let total = 0;
      let motionTotal = 0;
      const previous = previousGrayRef.current;
      for (let pixel = 0, index = 0; pixel < pixels.length; pixel += 4, index += 1) {
        const value = Math.round(pixels[pixel] * 0.299 + pixels[pixel + 1] * 0.587 + pixels[pixel + 2] * 0.114);
        gray[index] = value;
        total += value;
        if (previous) motionTotal += Math.abs(value - previous[index]);
      }
      previousGrayRef.current = gray;
      const brightness = total / gray.length;
      const motion = previous ? motionTotal / gray.length : 0;
      const track = streamRef.current.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      const fps = Number(settings.frameRate || 0);
      const healthy = brightness >= thresholds.minBrightness;
      healthyFramesRef.current = healthy ? healthyFramesRef.current + 1 : 0;
      setStats({ fps, brightness, motion, width: settings.width || video.videoWidth, height: settings.height || video.videoHeight, healthy });

      if (currentIdRef.current === 'camera' && video.videoWidth > 0) {
        addLog(`카메라 연결 ${video.videoWidth}×${video.videoHeight}`);
        goNext('camera', '브라우저 카메라 스트림 정상');
      } else if (currentIdRef.current === 'feed') {
        if (healthyFramesRef.current >= 12) {
          addLog(`검은 화면 검사 통과 · 밝기 ${brightness.toFixed(1)}`);
          goNext('feed', `평균 밝기 ${brightness.toFixed(1)}`);
        } else if (brightness < thresholds.minBrightness) {
          updateResult('feed', 'fail', `화면 밝기 ${brightness.toFixed(1)} · 카메라 가림 또는 검은 프레임`);
          setBanner('화면이 검습니다. 렌즈를 가리지 않았는지 확인하고 전후면 전환을 눌러 주세요.');
        }
      }

      if ((currentIdRef.current === 'down' || currentIdRef.current === 'up') && motion >= thresholds.motionThreshold) {
        const now = performance.now();
        const recent = motionEventsRef.current.filter((value) => now - value < 5000);
        if (!recent.length || now - recent[recent.length - 1] > 280) recent.push(now);
        motionEventsRef.current = recent;
        setStrokeCount(recent.length);
        if (recent.length >= 5) {
          const id = currentIdRef.current;
          addLog(`${id === 'down' ? '다운' : '업'} 스트럼 움직임 5회 감지`);
          goNext(id, '브라우저 움직임 감지 5회');
        }
      }
    }
    loopRef.current = requestAnimationFrame(sampleFrame);
  };

  const stopCamera = () => {
    cancelAnimationFrame(loopRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    previousGrayRef.current = null;
    setStats({ fps: 0, brightness: 0, motion: 0, width: 0, height: 0, healthy: false });
  };

  const startCamera = async (requestedFacing = facing) => {
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: requestedFacing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      addLog(`카메라 시작 · ${requestedFacing === 'environment' ? '후면' : '전면'}`);
      loopRef.current = requestAnimationFrame(sampleFrame);
    } catch (error) {
      updateResult('camera', 'fail', error?.message || '카메라 권한 실패');
      setBanner('카메라 권한이 차단됐습니다. 브라우저 주소창의 카메라 권한을 허용해 주세요.');
      addLog(`카메라 오류 · ${error?.message || error}`, 'error');
    }
  };

  const begin = async () => {
    setResults({ ...initialResults, camera: { status: 'active', note: '' } });
    setCurrentId('camera');
    setRunning(true);
    setLogs([]);
    setVoiceResult('');
    await startCamera();
  };

  const switchFacing = async () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    await startCamera(next);
  };

  const confirmVisible = (id, visible) => {
    if (visible) {
      addLog(`${id === 'hand' ? '오른손' : '기타·줄'} 화면 확인`);
      goNext(id, '사용자 화면 확인');
    } else {
      updateResult(id, 'fail', '화면에서 잘리거나 보이지 않음');
      setBanner(id === 'hand' ? '오른손 전체가 보이도록 휴대폰 위치를 조정해 주세요.' : '브리지와 기타 줄이 보이도록 카메라 각도를 조정해 주세요.');
    }
  };

  const testVoice = () => {
    if (!('speechSynthesis' in window)) {
      setVoiceResult('지원 안 됨');
      updateResult('voice', 'fail', '브라우저 음성 합성 미지원');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance('음성 테스트입니다. 기타와 오른손을 화면 안에 맞춰 주세요.');
    utterance.lang = 'ko-KR';
    utterance.rate = 1.02;
    utterance.onerror = () => {
      setVoiceResult('재생 실패');
      updateResult('voice', 'fail', '브라우저 음성 재생 실패');
    };
    utterance.onend = () => setVoiceResult('재생 완료 · 실제로 들렸는지 선택');
    window.speechSynthesis.speak(utterance);
  };

  const confirmVoice = (heard) => {
    if (heard) {
      setVoiceResult('들림');
      goNext('voice', '사용자 음성 확인');
    } else {
      setVoiceResult('안 들림');
      updateResult('voice', 'fail', 'TTS 호출 후 실제 소리 안 들림');
      setBanner('휴대폰 미디어 음량과 무음 모드를 확인한 뒤 음성 테스트를 다시 눌러 주세요.');
    }
  };

  const report = useMemo(() => ({
    sessionCode,
    createdAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    stats,
    thresholds,
    results,
    logs,
  }), [sessionCode, stats, thresholds, results, logs]);

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `guitar-coach-diagnostic-${sessionCode}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (!apiUrl || !running) return undefined;
    const timer = window.setInterval(() => {
      fetch(`${apiUrl.replace(/\/$/, '')}/api/sessions/${sessionCode}/telemetry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stats, results, currentId, banner, at: Date.now() }),
      }).catch(() => undefined);
      fetch(`${apiUrl.replace(/\/$/, '')}/api/sessions/${sessionCode}/settings`)
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => {
          if (!payload) return;
          if (payload.thresholds) setThresholds((current) => ({ ...current, ...payload.thresholds }));
          if (payload.instruction && payload.instruction !== banner) {
            setBanner(payload.instruction);
            if ('speechSynthesis' in window) {
              window.speechSynthesis.cancel();
              const utterance = new SpeechSynthesisUtterance(payload.instruction);
              utterance.lang = 'ko-KR';
              window.speechSynthesis.speak(utterance);
            }
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [apiUrl, running, sessionCode, stats, results, currentId, banner]);

  const current = TESTS.find((test) => test.id === currentId);
  const completed = Object.values(results).filter((item) => item.status === 'pass').length;

  return (
    <div className="debug-shell">
      <header className="debug-header">
        <div>
          <span className="debug-kicker">DEVICE TEST SESSION</span>
          <h1>기타 코치 실시간 진단센터</h1>
          <p>채팅 대신 이 화면이 한 단계씩 지시하고 결과를 기록합니다.</p>
        </div>
        <div className="debug-session-box"><span>세션 코드</span><strong>{sessionCode}</strong><small>{apiUrl ? '원격 서버 연결 준비' : '현재 로컬 진단 모드'}</small></div>
      </header>

      <div className="debug-progress"><span style={{ width: `${(completed / TESTS.length) * 100}%` }} /></div>

      <main className="debug-grid">
        <section className="debug-camera-card">
          <div className="debug-video-wrap">
            <video ref={videoRef} playsInline muted />
            {!streamRef.current ? <div className="debug-video-empty">카메라 대기</div> : null}
            <div className={`debug-feed-badge ${stats.healthy ? 'good' : 'bad'}`}>{stats.healthy ? '영상 정상' : '영상 확인 중'} · 밝기 {stats.brightness.toFixed(1)}</div>
          </div>
          <canvas ref={canvasRef} hidden />
          <div className="debug-metrics">
            <div><span>FPS</span><strong>{stats.fps ? stats.fps.toFixed(0) : '-'}</strong></div>
            <div><span>해상도</span><strong>{stats.width ? `${stats.width}×${stats.height}` : '-'}</strong></div>
            <div><span>밝기</span><strong>{stats.brightness.toFixed(1)}</strong></div>
            <div><span>움직임</span><strong>{stats.motion.toFixed(1)}</strong></div>
          </div>
          <div className="debug-button-row">
            <button className="debug-primary" onClick={() => void begin()}>{running ? '처음부터 다시 검사' : '테스트 시작'}</button>
            <button className="debug-secondary" onClick={() => void switchFacing()} disabled={!running}>전후면 전환</button>
          </div>
        </section>

        <section className="debug-instruction-card">
          <span className="debug-kicker">현재 지시</span>
          <h2>{current?.title}</h2>
          <p className="debug-instruction">{banner}</p>
          {(currentId === 'down' || currentId === 'up') ? <div className="debug-count">{strokeCount}<span>/ 5회</span></div> : null}
          {currentId === 'hand' ? (
            <div className="debug-button-row"><button className="debug-primary" onClick={() => confirmVisible('hand', true)}>오른손 전체가 보임</button><button className="debug-danger" onClick={() => confirmVisible('hand', false)}>안 보임</button></div>
          ) : null}
          {currentId === 'guitar' ? (
            <div className="debug-button-row"><button className="debug-primary" onClick={() => confirmVisible('guitar', true)}>기타와 줄이 보임</button><button className="debug-danger" onClick={() => confirmVisible('guitar', false)}>안 보임</button></div>
          ) : null}
          {currentId === 'voice' ? (
            <><button className="debug-primary debug-wide" onClick={testVoice}>음성 테스트</button><div className="debug-voice-result">{voiceResult || '아직 재생하지 않음'}</div><div className="debug-button-row"><button className="debug-primary" onClick={() => confirmVoice(true)}>들림</button><button className="debug-danger" onClick={() => confirmVoice(false)}>안 들림</button></div></>
          ) : null}
          {currentId === 'complete' ? <button className="debug-primary debug-wide" onClick={downloadReport}>진단 결과 저장</button> : null}
          <div className="debug-thresholds">
            <label>검은 화면 기준 <input type="range" min="3" max="35" value={thresholds.minBrightness} onChange={(event) => setThresholds((currentValue) => ({ ...currentValue, minBrightness: Number(event.target.value) }))} /><strong>{thresholds.minBrightness}</strong></label>
            <label>움직임 기준 <input type="range" min="2" max="25" value={thresholds.motionThreshold} onChange={(event) => setThresholds((currentValue) => ({ ...currentValue, motionThreshold: Number(event.target.value) }))} /><strong>{thresholds.motionThreshold}</strong></label>
          </div>
        </section>

        <section className="debug-checklist-card">
          <div className="debug-card-title"><div><span className="debug-kicker">REQUIREMENTS</span><h2>요청사항 검사</h2></div><strong>{completed}/{TESTS.length}</strong></div>
          <div className="debug-test-list">
            {TESTS.map((test) => (
              <button key={test.id} className={currentId === test.id ? 'active' : ''} onClick={() => running && setCurrentId(test.id)}>
                <div><strong>{test.title}</strong><small>{results[test.id]?.note || test.instruction}</small></div><StatusPill status={results[test.id]?.status || 'pending'} />
              </button>
            ))}
          </div>
        </section>

        <section className="debug-log-card">
          <div className="debug-card-title"><div><span className="debug-kicker">LIVE LOG</span><h2>진단 기록</h2></div><button onClick={downloadReport}>JSON 저장</button></div>
          <div className="debug-log-list">
            {logs.length ? logs.map((log, index) => <div key={`${log.at}-${index}`} className={log.level}><time>{log.at}</time><span>{log.message}</span></div>) : <p>아직 기록이 없습니다.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}

function AdminCenter() {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('gc-debug-api-url') || import.meta.env.VITE_DIAGNOSTIC_API_URL || '');
  const [sessionCode, setSessionCode] = useState(() => localStorage.getItem('gc-debug-session') || '');
  const [state, setState] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [thresholds, setThresholds] = useState({ minBrightness: 10, motionThreshold: 8 });
  const [connection, setConnection] = useState('서버 주소와 세션 코드를 입력해 주세요.');

  useEffect(() => {
    if (!apiUrl || !sessionCode) return undefined;
    localStorage.setItem('gc-debug-api-url', apiUrl);
    localStorage.setItem('gc-debug-session', sessionCode);
    const timer = setInterval(() => {
      fetch(`${apiUrl.replace(/\/$/, '')}/api/sessions/${sessionCode}/state`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then((payload) => { setState(payload); setConnection('실시간 연결됨'); })
        .catch((error) => setConnection(`연결 대기 · ${error.message}`));
    }, 1000);
    return () => clearInterval(timer);
  }, [apiUrl, sessionCode]);

  const sendSettings = async () => {
    if (!apiUrl || !sessionCode) return;
    await fetch(`${apiUrl.replace(/\/$/, '')}/api/sessions/${sessionCode}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction, thresholds }),
    });
    setConnection('새 지시와 기준값을 전송했습니다.');
  };

  return (
    <div className="debug-shell admin">
      <header className="debug-header"><div><span className="debug-kicker">REMOTE CONSOLE</span><h1>원격 진단 관리자</h1><p>사용자 화면의 상태를 보고 지시와 기준값을 즉시 변경합니다.</p></div><div className="debug-session-box"><span>연결 상태</span><strong>{connection}</strong></div></header>
      <main className="debug-admin-grid">
        <section className="debug-instruction-card">
          <h2>세션 연결</h2>
          <label className="debug-field">진단 서버 주소<input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} placeholder="https://debug.example.com" /></label>
          <label className="debug-field">세션 코드<input value={sessionCode} onChange={(event) => setSessionCode(event.target.value.toUpperCase())} placeholder="ABC-123" /></label>
          <label className="debug-field">사용자에게 보낼 지시<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="기타 줄이 잘 보이도록 휴대폰을 조금 낮춰 주세요." /></label>
          <div className="debug-thresholds">
            <label>밝기 기준 <input type="range" min="3" max="35" value={thresholds.minBrightness} onChange={(event) => setThresholds((value) => ({ ...value, minBrightness: Number(event.target.value) }))} /><strong>{thresholds.minBrightness}</strong></label>
            <label>움직임 기준 <input type="range" min="2" max="25" value={thresholds.motionThreshold} onChange={(event) => setThresholds((value) => ({ ...value, motionThreshold: Number(event.target.value) }))} /><strong>{thresholds.motionThreshold}</strong></label>
          </div>
          <button className="debug-primary debug-wide" onClick={() => void sendSettings()}>지시와 설정 즉시 전송</button>
        </section>
        <section className="debug-checklist-card">
          <div className="debug-card-title"><div><span className="debug-kicker">LIVE DEVICE STATE</span><h2>휴대폰 상태</h2></div></div>
          {state?.telemetry ? (
            <><div className="debug-metrics"><div><span>FPS</span><strong>{state.telemetry.stats?.fps?.toFixed?.(0) || '-'}</strong></div><div><span>밝기</span><strong>{state.telemetry.stats?.brightness?.toFixed?.(1) || '-'}</strong></div><div><span>움직임</span><strong>{state.telemetry.stats?.motion?.toFixed?.(1) || '-'}</strong></div><div><span>현재 단계</span><strong>{state.telemetry.currentId || '-'}</strong></div></div><pre className="debug-json">{JSON.stringify(state.telemetry.results, null, 2)}</pre></>
          ) : <div className="debug-empty-state">세션 데이터 대기 중</div>}
        </section>
      </main>
    </div>
  );
}

export default function DebugCenter() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('gc-debug-unlocked') === '1');
  if (!unlocked) return <LoginGate onUnlock={() => setUnlocked(true)} />;
  const admin = new URLSearchParams(window.location.search).get('admin') === '1';
  return admin ? <AdminCenter /> : <DeviceCenter />;
}
