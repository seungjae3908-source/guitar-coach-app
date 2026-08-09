import { useEffect, useMemo, useRef, useState } from "react";
import { createCalibration, fromGuitarSpace } from "./strum/geometry.js";
import {
  AudioOnsetDetector,
  StrokeDetector,
  sessionMetrics,
} from "./strum/engine.js";
import { createHandTracker } from "./strum/hand-tracker.js";
import { HandIdentityTracker } from "./strum/hand-identity.js";
import {
  coverTransform,
  displayToSource,
  sourceToDisplay,
} from "./strum/camera-coordinates.js";
import { createWebAudioMetronome } from "./strum/timing.js";
import { PracticeResources } from "./strum/resources.js";

const LABELS = ["사운드홀 중심", "넥 방향의 한 점", "굵은 6번줄 쪽 가장자리"];
const EMPTY = {
  total: 0,
  down: 0,
  up: 0,
  currentBpm: 0,
  averageBpm: 0,
  consistency: 0,
  averageOffsetMs: 0,
  timingStdDevMs: 0,
  missedBeatEstimate: 0,
};

export default function StrumCoach() {
  const videoRef = useRef(null),
    canvasRef = useRef(null),
    cardRef = useRef(null),
    resources = useRef(null),
    calibrationRef = useRef(null),
    calibrationValidRef = useRef(false),
    detectorRef = useRef(new StrokeDetector()),
    identityRef = useRef(new HandIdentityTracker()),
    strokesRef = useRef([]),
    beatsRef = useRef([]),
    lostFramesRef = useRef(0),
    fpsRef = useRef({ startedAt: 0, frames: 0, value: 0 }),
    debugUpdateRef = useRef(0);

  if (!resources.current) resources.current = new PracticeResources();

  const debugMode = useMemo(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("debug") === "1",
    [],
  );

  const [phase, setPhase] = useState("idle"),
    [points, setPoints] = useState([]),
    [bpm, setBpm] = useState(80),
    [metronome, setMetronome] = useState(true),
    [duration, setDuration] = useState(30),
    [remaining, setRemaining] = useState(30),
    [metrics, setMetrics] = useState(EMPTY),
    [message, setMessage] = useState(
      "카메라를 허용하고 기타 위치를 간단히 보정하세요.",
    ),
    [audioMode, setAudioMode] = useState("audio"),
    [result, setResult] = useState(null),
    [tab, setTab] = useState("practice"),
    [trackerMode, setTrackerMode] = useState(null),
    [calibrationValid, setCalibrationValid] = useState(false),
    [debugSnapshot, setDebugSnapshot] = useState(null);

  const running = phase === "running";
  const feedback = useMemo(() => {
    if (metrics.total < 4) return running ? "근거를 모으는 중입니다." : message;
    if (metrics.consistency < 60)
      return `최근 스트로크 간격이 흔들립니다. ${Math.max(35, bpm - 5)} BPM으로 낮춰보세요.`;
    if (metrics.averageOffsetMs > 25)
      return `최근 연주가 박자보다 평균 ${metrics.averageOffsetMs}ms 늦습니다.`;
    if (metrics.averageOffsetMs < -25)
      return `최근 연주가 박자보다 평균 ${Math.abs(metrics.averageOffsetMs)}ms 빠릅니다.`;
    return "다운/업 균형과 박자 간격이 현재 측정 구간에서 고르게 유지됩니다.";
  }, [metrics, running, message, bpm]);

  useEffect(() => () => resources.current.stopAll(), []);
  useEffect(() => {
    if (!calibrationRef.current) return undefined;
    const frame = requestAnimationFrame(() => drawOverlay(null));
    return () => cancelAnimationFrame(frame);
  }, [phase, points]);

  function transform() {
    const video = videoRef.current,
      card = cardRef.current;
    if (!video?.videoWidth || !card) return null;
    const rect = card.getBoundingClientRect();
    return coverTransform({
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      displayWidth: rect.width,
      displayHeight: rect.height,
      mirrored: true,
    });
  }

  function setCalibrationValidity(value) {
    calibrationValidRef.current = value;
    setCalibrationValid(value);
  }

  async function requestSensors() {
    resources.current.stopAll();
    setCalibrationValidity(false);
    setPhase("requesting");
    setMessage("카메라와 마이크 권한을 확인하는 중입니다.");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 540 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      setAudioMode("audio");
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        setAudioMode("vision");
      } catch {
        setPhase("idle");
        setMessage("카메라 권한이 필요합니다. 브라우저 설정을 확인하세요.");
        return;
      }
    }
    resources.current.values.stream = stream;
    videoRef.current.srcObject = stream;
    await videoRef.current.play();
    beginCalibration();
  }

  function beginCalibration() {
    resources.current.stopAnalysis();
    calibrationRef.current = null;
    setCalibrationValidity(false);
    identityRef.current.reset();
    detectorRef.current = new StrokeDetector();
    setPoints([]);
    setResult(null);
    setDebugSnapshot(null);
    setPhase("calibrating");
    setMessage(`${LABELS[0]}을 누르세요.`);
  }

  function addCalibrationPoint(event) {
    if (phase !== "calibrating") return;
    const t = transform(),
      rect = event.currentTarget.getBoundingClientRect();
    if (!t) return;
    const point = displayToSource(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        t,
      ),
      next = [...points, point];
    setPoints(next);
    if (next.length < 3) {
      setMessage(`${LABELS[next.length]}을 누르세요.`);
      return;
    }
    try {
      calibrationRef.current = createCalibration({
        soundhole: next[0],
        neck: next[1],
        sixStringEdge: next[2],
        mirrored: true,
      });
      setCalibrationValidity(false);
      setPhase("confirming");
      setMessage("초록 영역이 실제 사운드홀의 스트럼 위치에 맞는지 확인하세요.");
      requestAnimationFrame(() => drawOverlay(null));
    } catch (error) {
      calibrationRef.current = null;
      setCalibrationValidity(false);
      setPoints([]);
      setMessage(
        error.message === "NECK_POINT_TOO_CLOSE"
          ? "넥 방향 점을 더 멀리 지정하세요."
          : "6번줄 쪽 가장자리를 사운드홀 중심에서 떨어뜨려 지정하세요.",
      );
    }
  }

  function confirmCalibration() {
    if (!calibrationRef.current) return;
    setCalibrationValidity(true);
    setPhase("ready");
    setMessage("보정 확인 완료. 6번줄에서 1번줄 방향을 DOWN으로 판정합니다.");
    requestAnimationFrame(() => drawOverlay(null));
  }

  function invalidateCalibration(reason) {
    resources.current.stopAnalysis();
    setCalibrationValidity(false);
    setPhase("needs-calibration");
    setMessage(reason || "기타/손 위치를 오래 잃었습니다. 다시 보정하세요.");
  }

  async function startPractice() {
    if (!calibrationRef.current || !calibrationValidRef.current) return;
    resources.current.stopAnalysis();
    const generation = resources.current.begin();
    const gestureContext = new AudioContext({ latencyHint: "interactive" });
    void gestureContext.resume();
    resources.current.values.context = gestureContext;
    setResult(null);
    setMetrics(EMPTY);
    strokesRef.current = [];
    beatsRef.current = [];
    lostFramesRef.current = 0;
    fpsRef.current = { startedAt: performance.now(), frames: 0, value: 0 };
    detectorRef.current = new StrokeDetector();
    identityRef.current.reset();
    setRemaining(duration);
    setPhase("loading");
    setMessage("손 추적 모델을 불러오는 중입니다.");
    let tracker;
    try {
      tracker = await createHandTracker();
    } catch {
      resources.current.stopAnalysis();
      setPhase("ready");
      setMessage(
        "GPU와 CPU 모두 손 추적 모델 초기화에 실패했습니다. 네트워크 연결을 확인하세요.",
      );
      return;
    }
    if (!resources.current.current(generation)) {
      tracker.close();
      return;
    }
    resources.current.values.tracker = tracker;
    setTrackerMode(tracker.delegate);
    setupAudio(generation);
    setPhase("running");
    setMessage(
      audioMode === "audio"
        ? `${tracker.delegate} 손 추적과 기타 소리를 함께 분석합니다.`
        : `${tracker.delegate} 영상 전용 모드입니다. 강한 움직임만 기록합니다.`,
    );

    const started = performance.now();
    const loop = (now) => {
      if (!resources.current.current(generation)) return;
      if (
        videoRef.current?.readyState >= 2 &&
        now - (resources.current.values.lastInference || 0) >= 66
      ) {
        resources.current.values.lastInference = now;
        updateFps(now);
        const hands = tracker.detect(videoRef.current, now);
        const selected = identityRef.current.update(
          hands,
          calibrationRef.current,
        );

        if (!selected) {
          lostFramesRef.current += 1;
          detectorRef.current.markReject("NO_STRUM_HAND", { timestamp: now });
          if (lostFramesRef.current >= 45) {
            updateDebug(now, null);
            invalidateCalibration("손 또는 기타 위치를 약 3초 동안 잃었습니다. 재보정하세요.");
            return;
          }
        } else {
          lostFramesRef.current = 0;
          const candidate = detectorRef.current.push({
            timestamp: now,
            landmarks: selected.hand.landmarks,
            calibration: calibrationValidRef.current
              ? calibrationRef.current
              : null,
            trackingConfidence: selected.hand.score,
          });
          if (candidate?.accepted) {
            strokesRef.current.push(candidate);
            setMetrics(
              sessionMetrics(strokesRef.current, bpm, beatsRef.current),
            );
          }
        }

        if (debugMode && now - debugUpdateRef.current >= 180) {
          debugUpdateRef.current = now;
          updateDebug(now, selected);
        }
        drawOverlay(selected?.point);
      }
      resources.current.values.raf = requestAnimationFrame(loop);
    };

    resources.current.values.raf = requestAnimationFrame(loop);
    resources.current.values.timer = setInterval(() => {
      const left = Math.max(
        0,
        duration - Math.floor((performance.now() - started) / 1000),
      );
      setRemaining(left);
      if (!left) finishPractice();
    }, 250);
  }

  function updateFps(now) {
    const state = fpsRef.current;
    if (!state.startedAt) state.startedAt = now;
    state.frames += 1;
    const elapsed = now - state.startedAt;
    if (elapsed >= 1000) {
      state.value = Math.round((state.frames * 1000) / elapsed);
      state.frames = 0;
      state.startedAt = now;
    }
  }

  function updateDebug(now, selected) {
    const t = transform();
    const detector = detectorRef.current.getDebugSnapshot();
    setDebugSnapshot({
      ...detector,
      now,
      handDetected: Boolean(selected?.hand),
      strumHandSelected: Boolean(selected),
      trackId: selected?.id ?? null,
      selectedConfidence: selected?.hand?.score ?? null,
      zoneDistance: selected?.zoneDistance ?? null,
      analysisFps: fpsRef.current.value,
      trackerMode,
      calibrationValid: calibrationValidRef.current,
      videoWidth: t?.videoWidth ?? 0,
      videoHeight: t?.videoHeight ?? 0,
      displayWidth: t ? Math.round(t.displayWidth) : 0,
      displayHeight: t ? Math.round(t.displayHeight) : 0,
      cropX: t ? Math.round(t.cropX) : 0,
      cropY: t ? Math.round(t.cropY) : 0,
      lostFrames: lostFramesRef.current,
    });
  }

  function setupAudio(generation) {
    const context =
      resources.current.values.context ||
      new AudioContext({ latencyHint: "interactive" });
    resources.current.values.context = context;
    const audioTrack = resources.current.values.stream?.getAudioTracks()[0];
    if (audioTrack) {
      const source = context.createMediaStreamSource(
          new MediaStream([audioTrack]),
        ),
        analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      Object.assign(resources.current.values, { source, analyser });
      const data = new Float32Array(analyser.fftSize),
        onset = new AudioOnsetDetector(),
        sample = () => {
          if (!resources.current.current(generation)) return;
          analyser.getFloatTimeDomainData(data);
          const rms = Math.sqrt(
            data.reduce((sum, value) => sum + value * value, 0) / data.length,
          );
          detectorRef.current.addOnset(onset.push(rms, performance.now()));
          resources.current.values.audioRaf = requestAnimationFrame(sample);
        };
      sample();
    }
    resources.current.values.metronome = createWebAudioMetronome({
      context,
      bpm,
      audible: metronome,
      onBeat: (beat) => {
        if (resources.current.current(generation)) beatsRef.current.push(beat);
      },
    });
  }

  function finishPractice() {
    resources.current.stopAnalysis();
    const summary = sessionMetrics(strokesRef.current, bpm, beatsRef.current);
    setMetrics(summary);
    setResult(summary);
    setPhase("result");
  }

  function drawOverlay(handPoint) {
    const canvas = canvasRef.current;
    const t = transform();
    if (!canvas || !t) return;
    const ratio = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    canvas.width = Math.round(t.displayWidth * ratio);
    canvas.height = Math.round(t.displayHeight * ratio);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const c = calibrationRef.current;
    if (!c) return;

    const corners = [
      [c.strumZone.alongMin, c.strumZone.acrossMin],
      [c.strumZone.alongMax, c.strumZone.acrossMin],
      [c.strumZone.alongMax, c.strumZone.acrossMax],
      [c.strumZone.alongMin, c.strumZone.acrossMax],
    ].map(([along, across]) =>
      sourceToDisplay(fromGuitarSpace({ along, across }, c), t),
    );

    ctx.lineWidth = 3 * ratio;
    ctx.strokeStyle = calibrationValidRef.current ? "#62e6a7" : "#ffd166";
    ctx.beginPath();
    corners.forEach((point, index) =>
      index
        ? ctx.lineTo(point.x * ratio, point.y * ratio)
        : ctx.moveTo(point.x * ratio, point.y * ratio),
    );
    ctx.closePath();
    ctx.stroke();

    const axisStart = sourceToDisplay(
      fromGuitarSpace({ along: -c.axisLength * 0.16, across: 0 }, c),
      t,
    );
    const axisEnd = sourceToDisplay(
      fromGuitarSpace({ along: c.axisLength * 0.72, across: 0 }, c),
      t,
    );
    ctx.lineWidth = 2 * ratio;
    ctx.strokeStyle = "#80bfff";
    ctx.beginPath();
    ctx.moveTo(axisStart.x * ratio, axisStart.y * ratio);
    ctx.lineTo(axisEnd.x * ratio, axisEnd.y * ratio);
    ctx.stroke();

    const downStart = sourceToDisplay(
      fromGuitarSpace({ along: 0, across: c.stringBand.max * 1.2 }, c),
      t,
    );
    const downEnd = sourceToDisplay(
      fromGuitarSpace({ along: 0, across: -c.stringBand.max * 1.2 }, c),
      t,
    );
    ctx.strokeStyle = "#ff8d5c";
    ctx.fillStyle = "#ff8d5c";
    ctx.beginPath();
    ctx.moveTo(downStart.x * ratio, downStart.y * ratio);
    ctx.lineTo(downEnd.x * ratio, downEnd.y * ratio);
    ctx.stroke();
    ctx.font = `${12 * ratio}px system-ui`;
    ctx.fillText("DOWN", downEnd.x * ratio + 5 * ratio, downEnd.y * ratio);

    if (handPoint) {
      const point = sourceToDisplay(handPoint, t);
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.arc(point.x * ratio, point.y * ratio, 8 * ratio, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const markerStyle = (point) => {
    const t = transform();
    if (!t) return {};
    const display = sourceToDisplay(point, t);
    return { left: display.x, top: display.y };
  };

  return (
    <div className="coach-shell">
      <header>
        <div>
          <span className="kicker">GUITAR COACH</span>
          <h1>스트럼 연습</h1>
        </div>
        <span className={`mode-pill ${audioMode}`}>
          {audioMode === "audio" ? "카메라 + 마이크" : "영상 전용 모드"}
        </span>
      </header>

      {tab === "practice" && (
        <main>
          <section className="controls">
            <label>
              BPM{" "}
              <input
                type="range"
                min="35"
                max="180"
                value={bpm}
                disabled={running}
                onChange={(event) => setBpm(Number(event.target.value))}
              />
              <strong>{bpm}</strong>
            </label>
            <label>
              <input
                type="checkbox"
                checked={metronome}
                disabled={running}
                onChange={(event) => setMetronome(event.target.checked)}
              />{" "}
              메트로놈
            </label>
            <select
              value={duration}
              disabled={running}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              <option value="30">30초</option>
              <option value="60">60초</option>
            </select>
          </section>

          <section
            ref={cardRef}
            className="camera-card"
            onClick={addCalibrationPoint}
          >
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} />
            {points.map((point, index) => (
              <span
                key={index}
                className="calibration-point"
                style={markerStyle(point)}
              >
                {index + 1}
              </span>
            ))}
            <div className="camera-status">
              {running ? `${remaining}초 · ${trackerMode}` : message}
            </div>
          </section>

          {phase === "confirming" && (
            <div className="calibration-confirm">
              초록 박스가 실제 사운드홀 주변 스트럼 영역에 놓이고, 주황 DOWN 화살표가 6번줄→1번줄 방향인지 확인하세요.
            </div>
          )}

          <div className="primary-actions">
            {phase === "idle" && (
              <button onClick={requestSensors}>카메라 시작</button>
            )}
            {phase === "confirming" && (
              <>
                <button onClick={confirmCalibration}>보정 맞음</button>
                <button className="secondary" onClick={beginCalibration}>
                  다시 보정
                </button>
              </>
            )}
            {phase === "ready" && calibrationValid && (
              <>
                <button onClick={startPractice}>연습 시작</button>
                <button className="secondary" onClick={beginCalibration}>
                  재보정
                </button>
              </>
            )}
            {running && <button onClick={finishPractice}>연습 종료</button>}
            {phase === "needs-calibration" && (
              <button onClick={beginCalibration}>즉시 재보정</button>
            )}
            {phase === "result" && (
              <>
                <button onClick={() => setPhase("ready")}>다시 연습</button>
                <button className="secondary" onClick={beginCalibration}>
                  재보정
                </button>
              </>
            )}
          </div>

          <section className="live-metrics">
            <div>
              <strong>{metrics.currentBpm || "—"}</strong>
              <span>BPM</span>
            </div>
            <div>
              <strong>
                {metrics.down} / {metrics.up}
              </strong>
              <span>DOWN / UP</span>
            </div>
            <div>
              <strong>{metrics.consistency || "—"}</strong>
              <span>박자 안정도</span>
            </div>
          </section>

          <p className="feedback">{feedback}</p>

          {debugMode && (
            <section className="debug-panel">
              <h3>DEVICE DEBUG · ?debug=1</h3>
              <dl className="debug-grid">
                <div><dt>HAND</dt><dd>{debugSnapshot?.handDetected ? "YES" : "NO"}</dd></div>
                <div><dt>STRUM HAND</dt><dd>{debugSnapshot?.strumHandSelected ? "YES" : "NO"}</dd></div>
                <div><dt>TRACK ID</dt><dd>{debugSnapshot?.trackId ?? "—"}</dd></div>
                <div><dt>CONFIDENCE</dt><dd>{debugSnapshot?.selectedConfidence?.toFixed?.(2) ?? "—"}</dd></div>
                <div><dt>REJECT</dt><dd>{debugSnapshot?.reason ?? "—"}</dd></div>
                <div><dt>ACCEPTED</dt><dd>{debugSnapshot?.acceptedCount ?? 0}</dd></div>
                <div><dt>TRAVEL</dt><dd>{debugSnapshot?.travel?.toFixed?.(3) ?? "—"}</dd></div>
                <div><dt>MIN TRAVEL</dt><dd>{debugSnapshot?.minTravel ?? "—"}</dd></div>
                <div><dt>VELOCITY</dt><dd>{debugSnapshot?.velocity?.toFixed?.(2) ?? "—"}</dd></div>
                <div><dt>MIN VELOCITY</dt><dd>{debugSnapshot?.minVelocity ?? "—"}</dd></div>
                <div><dt>AXIS/BAND</dt><dd>{debugSnapshot?.crossedCentralBand ? "CROSS" : "NO"}</dd></div>
                <div><dt>AUDIO</dt><dd>{debugSnapshot?.audioMatched ? "MATCH" : "NO"}</dd></div>
                <div><dt>FPS</dt><dd>{debugSnapshot?.analysisFps ?? 0}</dd></div>
                <div><dt>TRACKER</dt><dd>{debugSnapshot?.trackerMode ?? trackerMode ?? "—"}</dd></div>
                <div><dt>CALIBRATION</dt><dd>{debugSnapshot?.calibrationValid ? "VALID" : "INVALID"}</dd></div>
                <div><dt>LOST FRAMES</dt><dd>{debugSnapshot?.lostFrames ?? 0}</dd></div>
                <div><dt>VIDEO</dt><dd>{debugSnapshot ? `${debugSnapshot.videoWidth}×${debugSnapshot.videoHeight}` : "—"}</dd></div>
                <div><dt>DISPLAY</dt><dd>{debugSnapshot ? `${debugSnapshot.displayWidth}×${debugSnapshot.displayHeight}` : "—"}</dd></div>
                <div><dt>CROP X/Y</dt><dd>{debugSnapshot ? `${debugSnapshot.cropX}/${debugSnapshot.cropY}` : "—"}</dd></div>
              </dl>
              <div className="debug-rejects">
                REJECT COUNTS {JSON.stringify(debugSnapshot?.rejectionCounts || {})}
              </div>
            </section>
          )}

          {result && (
            <section className="results">
              <h2>연습 결과</h2>
              <dl>
                <div>
                  <dt>총 스트로크</dt>
                  <dd>{result.total}</dd>
                </div>
                <div>
                  <dt>평균 BPM</dt>
                  <dd>{result.averageBpm || "측정 부족"}</dd>
                </div>
                <div>
                  <dt>평균 박자 오차</dt>
                  <dd>{result.averageOffsetMs} ms</dd>
                </div>
                <div>
                  <dt>놓친 박</dt>
                  <dd>{result.missedBeatEstimate}</dd>
                </div>
              </dl>
            </section>
          )}
        </main>
      )}

      {tab !== "practice" && (
        <main className="empty-state">
          <h2>{tab === "history" ? "기록" : "설정"}</h2>
          <p>이 화면은 아직 데이터를 제공하지 않습니다.</p>
        </main>
      )}

      <nav className="bottom-nav">
        <button
          className={tab === "practice" ? "active" : ""}
          onClick={() => setTab("practice")}
        >
          연습
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          기록
        </button>
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
        >
          설정
        </button>
      </nav>
    </div>
  );
}
