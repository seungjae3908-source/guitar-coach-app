import { useEffect, useRef, useState } from 'react';

const MODES = {
  코드: {
    pattern: ['C', 'G', 'Am', 'F'],
    instruction: '박자마다 다음 코드를 한 번에 잡고 한 번씩 스트럼하세요.',
  },
  핑거링: {
    pattern: ['1', '2', '3', '4'],
    instruction: '한 박에 한 손가락씩 누르며 음의 시작을 분명하게 만드세요.',
  },
  아르페지오: {
    pattern: ['P', 'I', 'P', 'M'],
    instruction: '한 박에 한 음씩 연주하고 사용한 손가락을 바로 복귀시키세요.',
  },
  스트럼: {
    pattern: ['↓', '↓↑', '↑', '↓↑'],
    instruction: '강조되는 방향을 따라 피크 깊이와 손목 속도를 일정하게 유지하세요.',
  },
  피킹: {
    pattern: ['D', 'U', 'D', 'U'],
    instruction: '한 박에 한 번씩 다운·업을 교대로 연주하세요.',
  },
};

const DURATION_OPTIONS = [15, 30, 60, 180];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

function deviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function buildFeedback(metrics, mode) {
  const ranked = [
    ['박자 정확도', metrics.rhythm],
    ['간격 일관성', metrics.consistency],
    ['음량 안정성', metrics.volume],
    ['연주 완성도', metrics.coverage],
  ].sort((a, b) => a[1] - b[1]);

  const weakest = ranked[0][0];
  if (metrics.detected < 3) {
    return '기타 소리가 충분히 감지되지 않았습니다. 휴대폰을 사운드홀에서 40~80cm 떨어뜨리고 다시 연주하세요.';
  }
  if (weakest === '박자 정확도') {
    return metrics.timingMean > 0
      ? `평균 ${Math.round(Math.abs(metrics.timingMean))}ms 늦습니다. 클릭을 들은 뒤 치지 말고 클릭과 손 동작이 동시에 끝나게 준비하세요.`
      : `평균 ${Math.round(Math.abs(metrics.timingMean))}ms 빠릅니다. 다음 음을 서두르지 말고 클릭 직전에 손가락을 준비만 하세요.`;
  }
  if (weakest === '간격 일관성') {
    return '음 사이 간격이 흔들립니다. BPM을 5~10 낮추고 8마디 연속 같은 간격을 먼저 만드세요.';
  }
  if (weakest === '음량 안정성') {
    return mode === '아르페지오'
      ? '엄지와 검지·중지의 음량 차이가 큽니다. 줄에 들어가는 손가락 깊이를 같게 맞추세요.'
      : '강약 차이가 큽니다. 피크 또는 손가락이 줄 안으로 들어가는 깊이를 일정하게 유지하세요.';
  }
  return '빠진 음이 있습니다. 속도를 낮추고 강조되는 패턴 하나마다 소리가 한 번씩 확실히 나게 연주하세요.';
}

function scoreSession({ attacks, expected, beatMs, noiseFloor, mode }) {
  const used = new Set();
  const errors = [];
  const matchedVolumes = [];
  const windowMs = beatMs * 0.46;

  expected.forEach((beat) => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    attacks.forEach((attack, index) => {
      if (used.has(index)) return;
      const distance = Math.abs(attack.time - beat.time);
      if (distance < bestDistance && distance <= windowMs) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      used.add(bestIndex);
      const attack = attacks[bestIndex];
      errors.push(attack.time - beat.time);
      matchedVolumes.push(attack.rms);
    }
  });

  const absErrors = errors.map(Math.abs);
  const meanAbsError = average(absErrors);
  const timingMean = average(errors);
  const rhythm = clamp(100 - (meanAbsError / Math.max(80, beatMs * 0.33)) * 100);
  const consistency = clamp(100 - (deviation(errors) / Math.max(65, beatMs * 0.28)) * 100);
  const coverage = clamp((used.size / Math.max(1, expected.length)) * 100);
  const volumeMean = average(matchedVolumes);
  const volumeVariation = volumeMean > 0 ? deviation(matchedVolumes) / volumeMean : 1;
  const volume = clamp(100 - volumeVariation * 175);
  const noise = clamp(100 - noiseFloor * 4200);
  const confidence = clamp((Math.min(1, attacks.length / Math.max(4, expected.length * 0.7)) * 70) + (noise * 0.3));
  const total = Math.round(
    rhythm * 0.34 + consistency * 0.22 + volume * 0.18 + coverage * 0.2 + noise * 0.06,
  );

  const metrics = {
    total: clamp(total),
    rhythm: Math.round(rhythm),
    consistency: Math.round(consistency),
    volume: Math.round(volume),
    coverage: Math.round(coverage),
    noise: Math.round(noise),
    confidence: Math.round(confidence),
    timingMean,
    meanAbsError: Math.round(meanAbsError),
    detected: attacks.length,
    matched: used.size,
    expected: expected.length,
  };

  return { ...metrics, feedback: buildFeedback(metrics, mode) };
}

function Metric({ label, value, suffix = '점' }) {
  return (
    <div style={styles.metric}>
      <strong style={styles.metricValue}>{value}{suffix}</strong>
      <span style={styles.metricLabel}>{label}</span>
    </div>
  );
}

export default function FocusAnalyzer() {
  const [mode, setMode] = useState('아르페지오');
  const [bpm, setBpm] = useState(65);
  const [duration, setDuration] = useState(30);
  const [phase, setPhase] = useState('idle');
  const [message, setMessage] = useState('이어폰을 사용하면 메트로놈 소리가 마이크에 섞이지 않아 분석이 더 정확합니다.');
  const [remaining, setRemaining] = useState(30);
  const [countdown, setCountdown] = useState(0);
  const [beatIndex, setBeatIndex] = useState(0);
  const [db, setDb] = useState(-80);
  const [detected, setDetected] = useState(0);
  const [matchedLive, setMatchedLive] = useState(0);
  const [lastTiming, setLastTiming] = useState(null);
  const [metronomeSound, setMetronomeSound] = useState(true);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('guitar-focus-ai-history') || '[]');
    } catch {
      return [];
    }
  });

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);
  const beatTimerRef = useRef(null);
  const clockTimerRef = useRef(null);
  const expectedRef = useRef([]);
  const attacksRef = useRef([]);
  const lastAttackRef = useRef(0);
  const previousRmsRef = useRef(0);
  const noiseFloorRef = useRef(0.008);
  const startedAtRef = useRef(0);
  const runningRef = useRef(false);
  const metronomeSoundRef = useRef(true);

  useEffect(() => {
    metronomeSoundRef.current = metronomeSound;
  }, [metronomeSound]);

  useEffect(() => () => stopAudio(), []);

  function stopAudio() {
    runningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (beatTimerRef.current) clearInterval(beatTimerRef.current);
    if (clockTimerRef.current) clearInterval(clockTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    sourceRef.current?.disconnect?.();
    analyserRef.current?.disconnect?.();
    sourceRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
  }

  function playClick(accent = false) {
    const context = audioContextRef.current;
    if (!context || !metronomeSoundRef.current) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = accent ? 1250 : 900;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.13 : 0.075, context.currentTime + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.045);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.05);
  }

  function startMonitor(analyser, threshold) {
    const data = new Float32Array(analyser.fftSize);
    const loop = () => {
      if (!runningRef.current) return;
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += sample * sample;
      const rms = Math.sqrt(sum / data.length);
      const currentDb = 20 * Math.log10(Math.max(rms, 0.00001));
      setDb(Math.max(-80, currentDb));

      const now = performance.now();
      const rising = rms > threshold && previousRmsRef.current <= threshold * 0.82;
      if (rising && now - lastAttackRef.current > 105) {
        const attack = { time: now, rms };
        attacksRef.current.push(attack);
        lastAttackRef.current = now;
        setDetected(attacksRef.current.length);

        const latestBeat = expectedRef.current
          .filter((beat) => Math.abs(now - beat.time) <= (60000 / bpm) * 0.48)
          .sort((a, b) => Math.abs(now - a.time) - Math.abs(now - b.time))[0];
        if (latestBeat) {
          const error = now - latestBeat.time;
          setLastTiming(Math.round(error));
          const nearMatched = attacksRef.current.filter((item) =>
            expectedRef.current.some((beat) => Math.abs(item.time - beat.time) <= (60000 / bpm) * 0.46),
          ).length;
          setMatchedLive(nearMatched);
        }
      }
      previousRmsRef.current = rms;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  async function calibrateNoise(analyser) {
    const data = new Float32Array(analyser.fftSize);
    const samples = [];
    const endAt = performance.now() + 2000;
    while (performance.now() < endAt) {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += sample * sample;
      samples.push(Math.sqrt(sum / data.length));
      setDb(20 * Math.log10(Math.max(samples.at(-1), 0.00001)));
      await wait(45);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0.006;
    noiseFloorRef.current = median;
    return Math.max(0.012, median * 2.8 + 0.004);
  }

  async function startSession() {
    stopAudio();
    setResult(null);
    setDetected(0);
    setMatchedLive(0);
    setLastTiming(null);
    setRemaining(duration);
    setPhase('requesting');
    setMessage('마이크 권한을 확인하는 중입니다.');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('이 브라우저는 실시간 마이크 분석을 지원하지 않습니다. 최신 Chrome에서 열어 주세요.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      streamRef.current = stream;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass({ latencyHint: 'interactive' });
      audioContextRef.current = context;
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.12;
      source.connect(analyser);
      sourceRef.current = source;
      analyserRef.current = analyser;

      setPhase('calibrating');
      setMessage('2초 동안 기타를 치지 마세요. 주변 소음을 측정합니다.');
      const threshold = await calibrateNoise(analyser);

      setPhase('countdown');
      setMessage('기타를 준비하세요.');
      for (let count = 3; count >= 1; count -= 1) {
        setCountdown(count);
        playClick(count === 1);
        navigator.vibrate?.(35);
        await wait(1000);
      }

      expectedRef.current = [];
      attacksRef.current = [];
      lastAttackRef.current = 0;
      previousRmsRef.current = 0;
      startedAtRef.current = performance.now();
      runningRef.current = true;
      setPhase('running');
      setCountdown(0);
      setMessage('강조되는 패턴을 메트로놈과 동시에 연주하세요.');

      const beatMs = 60000 / bpm;
      let beat = 0;
      const fireBeat = () => {
        const time = performance.now();
        expectedRef.current.push({ time, beat });
        setBeatIndex(beat % MODES[mode].pattern.length);
        playClick(beat % MODES[mode].pattern.length === 0);
        navigator.vibrate?.(beat % MODES[mode].pattern.length === 0 ? 45 : 20);
        beat += 1;
      };
      fireBeat();
      beatTimerRef.current = setInterval(fireBeat, beatMs);
      startMonitor(analyser, threshold);

      clockTimerRef.current = setInterval(() => {
        const elapsed = (performance.now() - startedAtRef.current) / 1000;
        setRemaining(Math.max(0, duration - elapsed));
        if (elapsed >= duration) finishSession();
      }, 100);
    } catch (error) {
      stopAudio();
      setPhase('error');
      setMessage(error instanceof Error ? error.message : '마이크 분석을 시작하지 못했습니다.');
    }
  }

  function finishSession() {
    if (!runningRef.current) return;
    const elapsedMs = performance.now() - startedAtRef.current;
    const beatMs = 60000 / bpm;
    const expected = expectedRef.current.filter((beat) => beat.time <= startedAtRef.current + elapsedMs + 80);
    const attacks = [...attacksRef.current];
    const scored = scoreSession({ attacks, expected, beatMs, noiseFloor: noiseFloorRef.current, mode });
    const completed = {
      ...scored,
      id: `${Date.now()}`,
      mode,
      bpm,
      duration: Math.round(elapsedMs / 1000),
      createdAt: new Date().toISOString(),
    };
    stopAudio();
    setResult(completed);
    setPhase('result');
    setRemaining(0);
    setMessage('분석이 완료되었습니다.');
    setHistory((current) => {
      const next = [completed, ...current].slice(0, 20);
      localStorage.setItem('guitar-focus-ai-history', JSON.stringify(next));
      return next;
    });
  }

  const running = ['requesting', 'calibrating', 'countdown', 'running'].includes(phase);
  const meterWidth = `${clamp(((db + 70) / 55) * 100)}%`;
  const activePattern = MODES[mode].pattern;

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <div style={styles.header}>
          <div>
            <span style={styles.eyebrow}>GUITAR COACH AI · WEB AUDIO</span>
            <h1 style={styles.title}>집중 연습 소리 분석</h1>
            <p style={styles.subtitle}>APK와 분리된 Chrome 마이크 분석이라 앱 본체가 종료되지 않습니다.</p>
          </div>
          <span style={styles.safeBadge}>안전 분리형</span>
        </div>

        <div style={styles.notice}>
          <strong>정확도 안내</strong>
          <span>휴대폰 스피커의 클릭이 마이크에 잡힐 수 있으므로 이어폰 사용을 권장합니다. 정확한 코드명·음정 판정은 아직 포함하지 않습니다.</span>
        </div>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>훈련 설정</h2>
          <div style={styles.chips}>
            {Object.keys(MODES).map((item) => (
              <button
                key={item}
                type="button"
                disabled={running}
                onClick={() => setMode(item)}
                style={{ ...styles.chip, ...(mode === item ? styles.chipActive : {}) }}
              >
                {item}
              </button>
            ))}
          </div>
          <p style={styles.instruction}>{MODES[mode].instruction}</p>

          <div style={styles.settingGrid}>
            <div style={styles.settingBox}>
              <span style={styles.settingLabel}>속도</span>
              <strong style={styles.settingValue}>{bpm} BPM</strong>
              <div style={styles.row}>
                <button type="button" disabled={running} style={styles.smallButton} onClick={() => setBpm((value) => Math.max(35, value - 5))}>−5</button>
                <button type="button" disabled={running} style={styles.smallButton} onClick={() => setBpm((value) => Math.min(180, value + 5))}>＋5</button>
              </div>
            </div>
            <div style={styles.settingBox}>
              <span style={styles.settingLabel}>연습 시간</span>
              <div style={styles.durationRow}>
                {DURATION_OPTIONS.map((seconds) => (
                  <button
                    type="button"
                    key={seconds}
                    disabled={running}
                    onClick={() => { setDuration(seconds); setRemaining(seconds); }}
                    style={{ ...styles.durationButton, ...(duration === seconds ? styles.durationActive : {}) }}
                  >
                    {seconds < 60 ? `${seconds}초` : `${seconds / 60}분`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label style={styles.toggleRow}>
            <input type="checkbox" checked={metronomeSound} disabled={running} onChange={(event) => setMetronomeSound(event.target.checked)} />
            <span>메트로놈 소리 사용</span>
          </label>
        </section>

        <section style={styles.practiceCard}>
          <div style={styles.practiceTop}>
            <div>
              <span style={styles.phaseLabel}>{phase === 'running' ? '분석 중' : phase === 'calibrating' ? '환경 측정' : phase === 'countdown' ? '준비' : '대기'}</span>
              <strong style={styles.timer}>{phase === 'countdown' ? countdown : formatTime(remaining)}</strong>
            </div>
            <div style={styles.liveStats}>
              <div><strong>{detected}</strong><span>감지 음</span></div>
              <div><strong>{matchedLive}</strong><span>박자 근접</span></div>
              <div><strong>{lastTiming === null ? '—' : `${lastTiming > 0 ? '+' : ''}${lastTiming}`}</strong><span>최근 ms</span></div>
            </div>
          </div>

          <div style={styles.patternRow}>
            {activePattern.map((step, index) => (
              <div key={`${step}-${index}`} style={{ ...styles.pattern, ...(phase === 'running' && beatIndex === index ? styles.patternActive : {}) }}>
                <strong>{step}</strong>
                <span>{index + 1}</span>
              </div>
            ))}
          </div>

          <div style={styles.meterHeader}><span>마이크 입력</span><strong>{Math.round(db)} dB</strong></div>
          <div style={styles.meterTrack}><div style={{ ...styles.meterFill, width: meterWidth }} /></div>
          <p style={styles.statusMessage}>{message}</p>

          {!running && phase !== 'result' ? (
            <button type="button" style={styles.startButton} onClick={startSession}>환경 측정 후 AI 분석 시작</button>
          ) : null}
          {phase === 'running' ? (
            <button type="button" style={styles.stopButton} onClick={finishSession}>중지하고 분석 결과 보기</button>
          ) : null}
          {phase === 'error' ? (
            <button type="button" style={styles.startButton} onClick={startSession}>마이크 다시 시도</button>
          ) : null}
        </section>

        {result ? (
          <section style={styles.resultCard}>
            <div style={styles.scoreBlock}>
              <span>AI 종합 점수</span>
              <strong>{result.total}</strong>
              <small>분석 신뢰도 {result.confidence}점</small>
            </div>
            <div style={styles.metricGrid}>
              <Metric label="박자 정확도" value={result.rhythm} />
              <Metric label="간격 일관성" value={result.consistency} />
              <Metric label="음량 안정성" value={result.volume} />
              <Metric label="연주 완성도" value={result.coverage} />
            </div>
            <div style={styles.detailBox}>
              <strong>측정 상세</strong>
              <span>평균 박자 오차 {result.meanAbsError}ms · 감지 {result.detected}음 · 매칭 {result.matched}/{result.expected}박</span>
            </div>
            <div style={styles.feedbackBox}>
              <span>지금 고칠 것</span>
              <strong>{result.feedback}</strong>
            </div>
            <button type="button" style={styles.startButton} onClick={() => { setResult(null); setPhase('idle'); setRemaining(duration); }}>같은 설정으로 다시 연습</button>
          </section>
        ) : null}

        {history.length ? (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>최근 분석 기록</h2>
            <div style={styles.historyList}>
              {history.slice(0, 5).map((item) => (
                <div key={item.id} style={styles.historyItem}>
                  <div><strong>{item.mode} · {item.bpm} BPM</strong><span>{new Date(item.createdAt).toLocaleString('ko-KR')}</span></div>
                  <strong style={styles.historyScore}>{item.total}점</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

const styles = {
  page: { minHeight: '100vh', padding: '18px', background: 'radial-gradient(circle at top right, rgba(56,139,253,.18), transparent 35%), #0d1117', color: '#f0f6fc' },
  shell: { maxWidth: '760px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'flex-start', marginBottom: '14px' },
  eyebrow: { color: '#79c0ff', fontSize: '10px', fontWeight: 900, letterSpacing: '1.3px' },
  title: { margin: '6px 0 0', fontSize: 'clamp(28px, 8vw, 42px)', lineHeight: 1.08 },
  subtitle: { color: '#8b949e', fontSize: '13px', lineHeight: 1.55, margin: '8px 0 0' },
  safeBadge: { flexShrink: 0, border: '1px solid #238636', borderRadius: '999px', padding: '7px 10px', color: '#7ee787', background: '#17251b', fontSize: '10px', fontWeight: 900 },
  notice: { display: 'grid', gap: '4px', border: '1px solid #9e6a03', background: '#2b2109', color: '#f2cc60', borderRadius: '14px', padding: '13px', fontSize: '12px', lineHeight: 1.55, marginBottom: '12px' },
  card: { border: '1px solid #30363d', borderRadius: '18px', background: 'rgba(22,27,34,.96)', padding: '16px', marginBottom: '12px' },
  cardTitle: { margin: '0 0 12px', fontSize: '17px' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '7px' },
  chip: { border: '1px solid #30363d', background: '#21262d', color: '#b1bac4', borderRadius: '999px', padding: '9px 13px', fontWeight: 800, cursor: 'pointer' },
  chipActive: { borderColor: '#2ea043', background: '#238636', color: '#fff' },
  instruction: { margin: '13px 0', color: '#b1bac4', fontSize: '13px', lineHeight: 1.55 },
  settingGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' },
  settingBox: { border: '1px solid #30363d', borderRadius: '14px', background: '#0d1117', padding: '13px' },
  settingLabel: { display: 'block', color: '#8b949e', fontSize: '11px', fontWeight: 800, marginBottom: '6px' },
  settingValue: { display: 'block', color: '#7ee787', fontSize: '22px', marginBottom: '8px' },
  row: { display: 'flex', gap: '7px' },
  smallButton: { flex: 1, border: '1px solid #30363d', borderRadius: '10px', background: '#21262d', color: '#fff', padding: '9px', fontWeight: 900 },
  durationRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px' },
  durationButton: { border: '1px solid #30363d', borderRadius: '9px', background: '#21262d', color: '#b1bac4', padding: '9px 4px', fontSize: '11px', fontWeight: 800 },
  durationActive: { borderColor: '#58a6ff', background: '#1158a7', color: '#fff' },
  toggleRow: { display: 'flex', gap: '9px', alignItems: 'center', marginTop: '13px', color: '#b1bac4', fontSize: '12px' },
  practiceCard: { border: '1px solid #388bfd', borderRadius: '20px', background: 'linear-gradient(180deg, #111d2d, #161b22)', padding: '18px', marginBottom: '12px', boxShadow: '0 18px 60px rgba(0,0,0,.25)' },
  practiceTop: { display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'flex-start' },
  phaseLabel: { display: 'block', color: '#79c0ff', fontSize: '10px', fontWeight: 900, letterSpacing: '1px' },
  timer: { display: 'block', fontSize: '44px', marginTop: '4px' },
  liveStats: { display: 'flex', gap: '8px' },
  patternRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '7px', margin: '18px 0' },
  pattern: { minHeight: '78px', border: '1px solid #30363d', borderRadius: '14px', background: '#0d1117', display: 'grid', placeItems: 'center', color: '#8b949e', transition: '120ms ease' },
  patternActive: { border: '2px solid #7ee787', background: '#238636', color: '#fff', transform: 'scale(1.04)' },
  meterHeader: { display: 'flex', justifyContent: 'space-between', color: '#b1bac4', fontSize: '11px', marginBottom: '6px' },
  meterTrack: { height: '11px', overflow: 'hidden', borderRadius: '999px', background: '#0d1117', border: '1px solid #30363d' },
  meterFill: { height: '100%', borderRadius: '999px', background: 'linear-gradient(90deg, #2ea043, #f2cc60, #f85149)', transition: 'width 80ms linear' },
  statusMessage: { minHeight: '38px', color: '#b1bac4', fontSize: '12px', lineHeight: 1.55, textAlign: 'center', margin: '12px 0 0' },
  startButton: { width: '100%', border: 0, borderRadius: '14px', padding: '14px', background: '#2ea043', color: '#fff', fontWeight: 900, fontSize: '14px', marginTop: '10px' },
  stopButton: { width: '100%', border: 0, borderRadius: '14px', padding: '14px', background: '#da3633', color: '#fff', fontWeight: 900, fontSize: '14px', marginTop: '10px' },
  resultCard: { border: '1px solid #2ea043', borderRadius: '20px', background: '#101d14', padding: '18px', marginBottom: '12px' },
  scoreBlock: { display: 'grid', justifyItems: 'center', marginBottom: '16px' },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' },
  metric: { border: '1px solid #30363d', borderRadius: '13px', background: '#0d1117', padding: '12px', textAlign: 'center' },
  metricValue: { display: 'block', color: '#7ee787', fontSize: '21px' },
  metricLabel: { display: 'block', color: '#8b949e', fontSize: '10px', marginTop: '3px' },
  detailBox: { display: 'grid', gap: '4px', borderRadius: '13px', padding: '12px', background: '#0d1117', color: '#b1bac4', fontSize: '11px', marginTop: '10px' },
  feedbackBox: { display: 'grid', gap: '6px', borderRadius: '13px', padding: '13px', background: '#2b2109', color: '#f2cc60', fontSize: '12px', lineHeight: 1.55, marginTop: '10px' },
  historyList: { display: 'grid', gap: '7px' },
  historyItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', borderBottom: '1px solid #21262d', padding: '9px 0' },
  historyScore: { color: '#7ee787', fontSize: '18px' },
};

Object.assign(styles.liveStats, { flexWrap: 'wrap', justifyContent: 'flex-end' });
Object.assign(styles.liveStats, {});
