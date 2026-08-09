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

const LABELS = ["ì‚¬ìš´ë“œí™€ ì¤‘ì‹¬", "ë„¥ ë°©í–¥ì˜ í•œ ì ", "êµµì€ 6ë²ˆì¤„ ìª½ ê°€ì¥ìë¦¬"];
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
      "ì¹´ë©”ë¼ë¥¼ í—ˆìš©í•˜ê³  ê¸°íƒ€ ìœ„ì¹˜ë¥¼ ê°„ë‹¨íˆ ë³´ì •í•˜ì„¸ìš”.",
    ),
    [audioMode, setAudioMode] = useState("audio"),
    [result, setResult] = useState(null),
    [tab, setTab] = useState("practice"),
    [trackerMode, setTrackerMode] = useState(null),
    [calibrationValid, setCalibrationValid] = useState(false),
    [debugSnapshot, setDebugSnapshot] = useState(null);

  const running = phase === "running";
  const feedback = useMemo(() => {
    if (metrics.total < 4) return running ? "ê·¼ê±°ë¥¼ ëª¨ìœ¼ëŠ” ì¤‘ì…ë‹ˆë‹¤." : message;
    if (metrics.consistency < 60)
      return `ìµœê·¼ ìŠ¤íŠ¸ë¡œí¬ ê°„ê²©ì´ í”ë“¤ë¦½ë‹ˆë‹¤. ${Math.max(35, bpm - 5)} BPMìœ¼ë¡œ ë‚®ì¶°ë³´ì„¸ìš”.`;
    if (metrics.averageOffsetMs > 25)
      return `ìµœê·¼ ì—°ì£¼ê°€ ë°•ìë³´ë‹¤ í‰ê·  ${metrics.averageOffsetMs}ms ëŠ¦ìŠµë‹ˆë‹¤.`;
    if (metrics.averageOffsetMs < -25)
      return `ìµœê·¼ ì—°ì£¼ê°€ ë°•ìë³´ë‹¤ í‰ê·  ${Math.abs(metrics.averageOffsetMs)}ms ë¹ ë¦…ë‹ˆë‹¤.`;
    return "ë‹¤ìš´/ì—… ê· í˜•ê³¼ ë°•ì ê°„ê²©ì´ í˜„ì¬ ì¸¡ì • êµ¬ê°„ì—ì„œ ê³ ë¥´ê²Œ ìœ ì§€ë©ë‹ˆë‹¤.";
  }, [metrics, running, message, bpm]);

  useEffect(() => () => resources.current.stopAll(), []);
  useEffect(() => {
    if (!debugMode) return undefined;
    const snapshot = Object.freeze({
      ...(debugSnapshot || {}),
      down: metrics.down,
      up: metrics.up,
      totalAcceptedStrokes: metrics.total,
    });
    window.__GUITAR_COACH_DEBUG__ = snapshot;
    console.debug("[guitar-coach-debug]", snapshot);
    return () => {
      if (window.__GUITAR_COACH_DEBUG__ === snapshot)
        delete window.__GUITAR_COACH_DEBUG__;
    };
  }, [debugMode, debugSnapshot, metrics.down, metrics.up, metrics.total]);
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
    setMessage("ì¹´ë©”ë¼ì™€ ë§ˆì´í¬ ê¶Œí•œì„ í™•ì¸í•˜ëŠ” ì¤‘ì…ë‹ˆë‹¤.");
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
        setMessage("ì¹´ë©”ë¼ ê¶Œí•œì´ í•„ìš”í•©ë‹ˆë‹¤. ë¸Œë¼ìš°ì € ì„¤ì •ì„ í™•ì¸í•˜ì„¸ìš”.");
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
    setMessage(`${LABELS[0]}ì„ ëˆ„ë¥´ì„¸ìš”.`);
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
      setMessage(`${LABELS[next.length]}ì„ ëˆ„ë¥´ì„¸ìš”.`);
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
      setMessage("ì´ˆë¡ ì˜ì—­ì´ ì‹¤ì œ ì‚¬ìš´ë“œí™€ì˜ ìŠ¤íŠ¸ëŸ¼ ìœ„ì¹˜ì— ë§ëŠ”ì§€ í™•ì¸í•˜ì„¸ìš”.");
      requestAnimationFrame(() => drawOverlay(null));
    } catch (error) {
      calibrationRef.current = null;
      setCalibrationValidity(false);
      setPoints([]);
      setMessage(
        error.message === "NECK_POINT_TOO_CLOSE"
          ? "ë„¥ ë°©í–¥ ì ì„ ë” ë©€ë¦¬ ì§€ì •í•˜ì„¸ìš”."
          : "6ë²ˆì¤„ ìª½ ê°€ì¥ìë¦¬ë¥¼ ì‚¬ìš´ë“œí™€ ì¤‘ì‹¬ì—ì„œ ë–¨ì–´ëœ¨ë ¤ ì§€ì •í•˜ì„¸ìš”.",
      );
    }
  }

  function confirmCalibration() {
    if (!calibrationRef.current) return;
    setCalibrationValidity(true);
    setPhase("ready");
    setMessage("ë³´ì • í™•ì¸ ì™„ë£Œ. 6ë²ˆì¤„ì—ì„œ 1ë²ˆì¤„ ë°©í–¥ì„ DOWNìœ¼ë¡œ íŒì •í•©ë‹ˆë‹¤.");
    requestAnimationFrame(() => drawOverlay(null));
  }

  function invalidateCalibration(reason) {
    resources.current.stopAnalysis();
    setCalibrationValidity(false);
    setPhase("needs-calibration");
    setMessage(reason || "ê¸°íƒ€/ì† ìœ„ì¹˜ë¥¼ ì˜¤ë˜ ìƒì—ˆìŠµë‹ˆë‹¤. ë‹¤ì‹œ ë³´ì •í•˜ì„¸ìš”.");
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
    setMessage("ì† ì¶”ì  ëª¨ë¸ì„ ë¶ˆëŸ¬ì˜¤ëŠ” ì¤‘ì…ë‹ˆë‹¤.");
    let tracker;
    try {
      tracker = await createHandTracker();
    } catch {
      resources.current.stopAnalysis();
      setPhase("ready");
      setMessage(
        "GPUì™€ CPU ëª¨ë‘ ì† ì¶”ì  ëª¨ë¸ ì´ˆê¸°í™”ì— ì‹¤íŒ¨í–ˆìŠµë‹ˆë‹¤. ë„¤íŠ¸ì›Œí¬ ì—°ê²°ì„ í™•ì¸í•˜ì„¸ìš”.",
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
        ? `${tracker.delegate} ì† ì¶”ì ê³¼ ê¸°íƒ€ ì†Œë¦¬ë¥¼ í•¨ê»˜ ë¶„ì„í•©ë‹ˆë‹¤.`
        : `${tracker.delegate} ì˜ìƒ ì „ìš© ëª¨ë“œì…ë‹ˆë‹¤. ê°•í•œ ì›€ì§ì„ë§Œ ê¸°ë¡í•©ë‹ˆë‹¤.`,
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
            invalidateCalibration("ì† ë˜ëŠ” ê¸°íƒ€ ìœ„ì¹˜ë¥¼ ì•½ 3ì´ˆ ë™ì•ˆ ìƒì—ˆìŠµë‹ˆë‹¤. ì¬ë³´ì •í•˜ì„¸ìš”.");
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
      [c.strumZone.alowë­­¢G§²ÚîÆ­yÔ5Dõ%“¢%$Te$5Dõ%’"ÀĞ¢tTµõd•4”ôåôäõôTD”ó¢%tTµõd•4”ôåôäõôTD”ò"ÀĞ¢EUÄ”4DS¢$EUÄ”4DR"ÀĞ¢õD„U#¢$õD„U""ÀĞ§Ò“°Ğ Ğ¦6öç7BW&6VçF–ÆRÒ‡fÇVW2Â&F–ò’Óâ°Ğ¢–b‚fÇVW2æÆVæwF‚’&WGW&â°Ğ¢6öç7B6÷'FVBÒ²ââçfÇVW5Òç6÷'B‚†Â"’ÓâÒ"“°Ğ¢&WGW&â6÷'FVE´ÖF‚æÖ–â‡6÷'FVBæÆVæwF‚ÒÂÖF‚æfÆö÷"‡6÷'FVBæÆVæwF‚¢&F–ò’•Ó°Ğ§Ó°Ğ Ğ¦W‡÷'B6Æ72VF–ôöç6WDFWFV7F÷"°Ğ¢6öç7G'V7F÷"‡²&Vg&7F÷'”×2Ò“Â6Æ–'&F–öä×2ÒcSÒÒ·Ò’°Ğ¢ö&¦V7Bæ76–vâ‡F†—2Â²&Vg&7F÷'”×2Â6Æ–'&F–öä×2Ò“°Ğ¢F†—2ææö—6TfÆö÷"Òãƒ°Ğ¢F†—2æÆ7Döç6WBÒÔ–æf–æ—G“°Ğ¢F†—2ç&Wf–÷W2Ò°Ğ¢F†—2ç7F'FVDBÒçVÆÃ°Ğ¢F†—2æÖ&–VçBÒµÓ°Ğ¢F†—2ç&V6VçBÒµÓ°Ğ¢ĞĞ¢W6‚‡&×2ÂF–ÖW7F×’°Ğ¢–b‡F†—2ç7F'FVDBÓÒçVÆÂ’F†—2ç7F'FVDBÒF–ÖW7F×°Ğ¢–b‡F–ÖW7F×ÒF†—2ç7F'FVDBÂF†—2æ6Æ–'&F–öä×2’°Ğ¢F†—2æÖ&–VçBçW6‚‡&×2“°Ğ¢F†—2ææö—6TfÆö÷"ÒW&6VçF–ÆR‡F†—2æÖ&–VçBÂãr’ÇÂF†—2ææö—6TfÆö÷#°Ğ¢F†—2ç&Wf–÷W2Ò&×3°Ğ¢&WGW&âçVÆÃ°Ğ¢ĞĞ¢F†—2ç&V6VçBçW6‚‡&×2“°Ğ¢–b‡F†—2ç&V6VçBæÆVæwF‚â“’F†—2ç&V6VçBç6†–gB‚“°Ğ¢6öç7B&ö'W7DfÆö÷"ÒW&6VçF–ÆR‡F†—2ç&V6VçBÂã3R“°Ğ¢–b‡&ö'W7DfÆö÷"âĞ¢F†—2ææö—6TfÆö÷"ÒF†—2ææö—6TfÆö÷"¢ã“b²&ö'W7DfÆö÷"¢ãC°Ğ¢6öç7BF‡&W6†öÆBÒÖF‚æÖ‚ƒã‚ÂF†—2ææö—6TfÆö÷"¢"ã‚“°Ğ¢6öç7Böç6WBĞĞ¢&×2âF‡&W6†öÆBb`Ğ¢&×2âF†—2ç&Wf–÷W2¢ãcRb`Ğ¢F–ÖW7F×ÒF†—2æÆ7Döç6WBãÒF†—2ç&Vg&7F÷'”×3°Ğ¢F†—2ç&Wf–÷W2Ò&×3°Ğ¢–b†öç6WB’F†—2æÆ7Döç6WBÒF–ÖW7F×°Ğ¢&WGW&âöç6W@Ğ¢ò°Ğ¢F–ÖW7F×ÀĞ¢7G&VæwFƒ¢6Æ×‚‡&×2ÒF‡&W6†öÆB’òÖF‚æÖ‚‡F‡&W6†öÆBÂã’’ÀĞ¢ĞĞ¢¢çVÆÃ°Ğ¢ĞĞ§ĞĞ Ğ¦W‡÷'BgVæ7F–öâgW6U7G&ö¶TWf–FVæ6R†6æF–FFRÂVF–ôöç6WB’°Ğ¢–b‚6æF–FFR’&WGW&âçVÆÃ°Ğ¢6öç7BVF–ô6öæf—&ÖVBÒ&ööÆVâ†VF–ôöç6WB“°Ğ¢6öç7Bf—6–öâÒ6æF–FFRçf—6–öä6öæf–FVæ6Róò°Ğ¢òòF—&V7B6ÆÆW'2&VFFRG&¦V7F÷'’ÖWFFFÂ6òöÖ—GFVBÖVç2F†R6ÆÆW Ğ¢òòÇ&VG’7WÆ–VBfÆ–FFVBf—7VÂ6æF–FFRâ7G&ö¶TFWFV7F÷"Çv—276W0Ğ¢òòâW‡Æ–6—B&ööÆVâ†W&RàĞ¢6öç7B7&÷76VD6VçG&Ä&æBÒ6æF–FFRæ7&÷76VD6VçG&Ä&æBóòG'VS°Ğ¢6öç7B6öæf–FVæ6RÒ6Æ×€Ğ¢f—6–öâ¢†VF–ô6öæf—&ÖVBòãs"¢ãƒ‚’°Ğ¢†VF–ôöç6WCòç7G&VæwF‚óò’¢ã#‚ÀĞ¢“°Ğ¢6öç7B66WFVBĞĞ¢†7&÷76VD6VçG&Ä&æBbbf—6–öâãÒãcB’ÇÀĞ¢†VF–ô6öæf—&ÖVBbbf—6–öâãÒã3‚bb6öæf–FVæ6RãÒãC‚“°Ğ¢&WGW&â°Ğ¢ââæ6æF–FFRÀĞ¢7&÷76VD6VçG&Ä&æBÀĞ¢VF–ô6öæf—&ÖVBÀĞ¢6öæf–FVæ6RÀĞ¢66WFVBÀĞ¢Wf–FVæ6S¢VF–ô6öæf—&ÖV@Ğ¢ò7&÷76VD6VçG&Ä&æ@Ğ¢ò'f—6–öâ¶VF–ò Ğ¢¢&VF–ò×7W÷'FVB×G&¦V7F÷'’ Ğ¢¢66WFV@Ğ¢ò'7G&öær×f—6–öâ Ğ¢¢'vV²×f—6–öâ"ÀĞ¢Ó°Ğ§ĞĞ Ğ¦W‡÷'B6Æ727G&ö¶TFWFV7F÷"°Ğ¢6öç7G'V7F÷"‡°Ğ¢Ö–åG&fVÂÒãCRÀĞ¢Ö–åfVÆö6—G’Òã#RÀĞ¢&Vg&7F÷'”×2ÒRÀĞ¢VF–õv–æF÷t×2ÒSÀĞ¢6×ÆUv–æF÷t×2Ò#ƒÀĞ¢ÒÒ·Ò’°Ğ¢ö&¦V7Bæ76–vâ‡F†—2Â°Ğ¢Ö–åG&fVÂÀĞ¢Ö–åfVÆö6—G’ÀĞ¢&Vg&7F÷'”×2ÀĞ¢VF–õv–æF÷t×2ÀĞ¢6×ÆUv–æF÷t×2ÀĞ¢Ò“°Ğ¢F†—2ç6×ÆW2ÒµÓ°Ğ¢F†—2æöç6WG2ÒµÓ°Ğ¢F†—2æÆ7E7G&ö¶RÒÔ–æf–æ—G“°Ğ¢F†—2æ66WFVD6÷VçBÒ°Ğ¢F†—2ç&V¦V7F–öä6÷VçG2Ò·Ó°Ğ¢F†—2æÆ7DFV'VrÒçVÆÃ°Ğ¢ĞĞ Ğ¢FDöç6WB†öç6WB’°Ğ¢–b†öç6WB’F†—2æöç6WG2çW6‚†öç6WB“°Ğ¢F†—2æöç6WG2ÒF†—2æöç6WG2ç6Æ–6R‚Ób“°Ğ¢ĞĞ Ğ¢Ö&µ&V¦V7B‡&V6öâÂFFÒ·Ò’°Ğ¢F†—2ç&V¦V7F–öä6÷VçG5·&V6öåÒÒ‡F†—2ç&V¦V7F–öä6÷VçG5·&V6öåÒÇÂ’²°Ğ¢F†—2æÆ7DFV'VrÒ°Ğ¢66WFVC¢fÇ6RÀĞ¢&V6öâÀĞ¢ââæFFÀĞ¢Ó°Ğ¢&WGW&âçVÆÃ°Ğ¢ĞĞ Ğ¢vWDFV'Vu6æ6†÷B‚’°Ğ¢&WGW&â°Ğ¢âââ‡F†—2æÆ7DFV'VrÇÂ·Ò’ÀĞ¢66WFVD6÷VçC¢F†—2æ66WFVD6÷VçBÀĞ¢&V¦V7F–öä6÷VçG3¢²ââçF†—2ç&V¦V7F–öä6÷VçG2ÒÀĞ¢Ö–åG&fVÃ¢F†—2æÖ–åG&fVÂÀĞ¢Ö–åfVÆö6—G“¢F†—2æÖ–åfVÆö6—G’ÀĞ¢Ó°Ğ¢ĞĞ Ğ¢W6‚‡²F–ÖW7F×ÂÆæFÖ&·2Â6Æ–'&F–öâÂG&6¶–æt6öæf–FVæ6RÒÒ’°Ğ¢6öç7Bö–çBÒ7G'VÕö–çB†ÆæFÖ&·2ÇÂµÒ“°Ğ¢–b‚ö–çBĞ¢&WGW&âF†—2æÖ&µ&V¦V7B…$T¤T5Eõ$T4ôå2ääõô„äBÂ²F–ÖW7F×Ò“°Ğ¢–b‚6Æ–'&F–öâĞ¢&WGW&âF†—2æÖ&µ&V¦V7B…$T¤T5Eõ$T4ôå2ä4Ä”%$D”ôåô”ådÄ”BÂ°Ğ¢F–ÖW7F×ÀĞ¢ö–çBÀĞ¢Ò“°Ğ¢–b‡G&6¶–æt6öæf–FVæ6RÂã"Ğ¢&WGW&âF†—2æÖ&µ&V¦V7B…$T¤T5Eõ$T4ôå2åE$4´”äuô4ôäd”DTä4UôÄõrÂ°Ğ¢F–ÖW7F×ÀĞ¢ö–çBÀĞ¢G&6¶–æt6öæf–FVæ6RÀĞ¢Ò“°Ğ Ğ¢6öç7BwV—F"ÒFôwV—F%76R‡ö–çBÂ6Æ–'&F–öâ“°Ğ¢6öç7B¢Ò6Æ–'&F–öâç7G'VÕ¦öæS°Ğ¢6öç7BæV"ĞĞ¢wV—F"æÆöærãÒ¢æÆöætÖ–âb`Ğ¢wV—F"æÆöærÃÒ¢æÆöætÖ‚b`Ğ¢wV—F"æ7&÷72ãÒ¢æ7&÷74Ö–âb`Ğ¢wV—F"æ7&÷72ÃÒ¢æ7&÷74Öƒ°Ğ Ğ¢F†—2ç6×ÆW2çW6‚‡²F–ÖW7F×Âö–çBÂwV—F"ÂæV"Ò“°Ğ¢F†—2ç6×ÆW2ÒF†—2ç6×ÆW2æf–ÇFW"€Ğ¢‡6×ÆR’ÓâF–ÖW7F×Ò6×ÆRçF–ÖW7F×ÃÒF†—2ç6×ÆUv–æF÷t×2ÀĞ¢“°Ğ Ğ¢–b‚æV"Ğ¢&WGW&âF†—2æÖ&µ&V¦V7B…$T¤T5Eõ$T4ôå2äõUE4”DUõ5E%TÕõ¤ôäRÂ°Ğ¢F–ÖW7F×ÀĞ¢ö–çBÀĞ¢wV—F"ÀĞ¢G&6¶–æt6öæf–FVæ6RÀĞ¢Ò“°Ğ¢–b‡F–ÖW7F×ÒF†—2æÆ7E7G&ö¶RÂF†—2ç&Vg&7F÷'”×2Ğ¢&WGW&âF†—2æÖ&µ&V¦V7B…$T¤T5Eõ$T4ôå2å$Te$5Dõ%’Â°Ğ¢F–ÖW7F×ÀĞ¢ö–çBÀĞ¢wV—F"ÀĞ¢G&6¶–æt6öæf–FVæ6RÀĞ¢Ò“°Ğ Ğ¢6öç7B&–÷"ÒF†—2ç6×ÆW0Ğ¢ç6Æ–6RƒÂÓĞ¢æf–ÇFW"‚‡6×ÆR’Óâ6×ÆRææV"Ğ¢æÖ‚‡6×ÆR’Óâ‡°Ğ¢ââç6×ÆRÀĞ¢G&fVÃ¢ÖF‚æ'2†wV—F"æ7&÷72Ò6×ÆRæwV—F"æ7&÷72’ÀĞ¢Ò’Ğ¢ç6÷'B‚†Â"’Óâ"çG&fVÂÒçG&fVÂ•³Ó°Ğ Ğ¢–b‚&–÷"Ğ¢&WGW&âF†—2æÖ&µ&V¦V7B…$T¤T5Eõ$T4ôå2åt•D”äuôdõ%õE$¤T5Dõ%’Â°Ğ¢F–ÖW7F×ÀĞ¢ö–çBÀĞ¢wV—F"ÀĞ¢G&6¶–æt6öæf–FVæ6RÀĞ¢Ò“°Ğ Ğ¢6öç7BGBÒÖF‚æÖ‚ƒÂF–ÖW7F×Ò&–÷"çF–ÖW7F×“°Ğ¢6öç7BFVÇF7&÷72ÒwV—F"æ7&÷72Ò&–÷"æwV—F"æ7&÷73°Ğ¢6öç7BG&fVÂÒÖF‚æ'2†FVÇF7&÷72“°Ğ¢6öç7BfVÆö6—G’ÒG&fVÂò†GBò“°Ğ¢–b‡G&fVÂÂF†—2æÖ–åG&fVÂĞ¢&WGW&âF†—2æÖ&µ&V¦V7B…$T¤T5Eõ$T4ôå2åE$dTÅõDôõõ4ÔÄÂÂ°Ğ¢F–ÖW7F×ÀĞ¢ö–çBÀĞ¢wV—F"ÀĞ¢G&fVÂÀĞ¢fVÆö6—G’ÀĞ¢G&6¶–æt6öæf–FVæ6RÀĞ¢Ò“°Ğ¢–b‡fVÆö6—G’ÂF†—2æÖ–åfVÆö6—G’Ğ¢&WGW&âF†—2æÖ&µ&V¦V7B…$T¤T5Eõ$T4ôå2ådTÄô4•E•õDôõôÄõrÂ°Ğ¢F–ÖW7F×ÀĞ¢ö–çBÀĞ¢wV—F"ÀĞ¢G&fVÂÀĞ¢fVÆö6—G’ÀĞ¢G&6¶–æt6öæf–FVæ6RÀĞ¢Ò“°Ğ Ğ¢6öç7B6VçG&Ä†Æev–GF‚Ò6Æ–'&F–öâç7G&–æt&æBæÖ‚¢ãc°Ğ¢6öç7BÆ÷rÒÖF‚æÖ–â‡&–÷"æwV—F"æ7&÷72ÂwV—F"æ7&÷72“°Ğ¢6öç7B†–v‚ÒÖF‚æÖ‚‡&–÷"æwV—F"æ7&÷72ÂwV—F"æ7&÷72“°Ğ¢6öç7B7&÷76VD6VçG&Ä&æBÒÆ÷rÃÒ6VçG&Ä†Æev–GF‚bb†–v‚ãÒÖ6VçG&Ä†Æev–GFƒ°Ğ¢6öç7Böç6WBÒF†—2æöç6WG2æf–æDÆ7B€Ğ¢†—FVÒ’ÓâÖF‚æ'2†—FVÒçF–ÖW7F×ÒF–ÖW7F×’ÃÒF†—2æVF–õv–æF÷t×2ÀĞ¢“°Ğ Ğ¢6öç7BG&fVÅ66÷&RÒ6Æ×‡G&fVÂò‡F†—2æÖ–åG&fVÂ¢"’“°Ğ¢6öç7BfVÆö6—G•66÷&RÒ6Æ×‡fVÆö6—G’ò‡F†—2æÖ–åfVÆö6—G’¢2’“°Ğ¢6öç7Bf—6–öä6öæf–FVæ6RÒ6Æ×€Ğ¢G&fVÅ66÷&R¢ãC"°Ğ¢fVÆö6—G•66÷&R¢ã2°Ğ¢6Æ×‡G&6¶–æt6öæf–FVæ6R’¢ã‚°Ğ¢†7&÷76VD6VçG&Ä&æBòã¢’ÀĞ¢“°Ğ Ğ¢6öç7BgW6VBÒgW6U7G&ö¶TWf–FVæ6R€Ğ¢°Ğ¢F–ÖW7F×ÀĞ¢F—&V7F–öã¢FVÇF7&÷72Âò&F÷vâ"¢'W"ÀĞ¢f—6–öä6öæf–FVæ6RÀĞ¢G&fVÂÀĞ¢fVÆö6—G’ÀĞ¢ö–çBÀĞ¢7&÷76VD6VçG&Ä&æBÀĞ¢ÒÀĞ¢öç6WBÀĞ¢“°Ğ Ğ¢–b‚gW6VCòæ66WFVB’°Ğ¢6öç7B&V6öâÒ7&÷76VD6VçG&Ä&æBbböç6W@Ğ¢ò$T¤T5Eõ$T4ôå2ääõô„•5ô5$õ50Ğ¢¢$T¤T5Eõ$T4ôå2åtTµõd•4”ôåôäõôTD”ó°Ğ¢&WGW&âF†—2æÖ&µ&V¦V7B‡&V6öâÂ°¢F–ÖW7F×ÀĞ¢ö–çBÀĞ¢wV—F"À¢&Wf–÷W4wV—F#¢&–÷"æwV—F"À¢G&fVÂÀĞ¢fVÆö6—G’ÀĞ¢f—6–öä6öæf–FVæ6RÀĞ¢7&÷76VD6VçG&Ä&æBÀĞ¢VF–ôÖF6†VC¢&ööÆVâ†öç6WB’ÀĞ¢G&6¶–æt6öæf–FVæ6RÀĞ¢Ò“°Ğ¢ĞĞ Ğ¢òòöæÇ’â66WFVB‡—6–6Â7G&ö¶RÖ’6öç7VÖRF†R&Vg&7F÷'’v–æF÷ràĞ¢F†—2æÆ7E7G&ö¶RÒF–ÖW7F×°Ğ¢F†—2ç6×ÆW2Ò·F†—2ç6×ÆW2æB‚Ó•Ó°Ğ¢F†—2æ66WFVD6÷VçB³Ò°Ğ¢F†—2æÆ7DFV'VrÒ°Ğ¢66WFVC¢G'VRÀĞ¢&V6öã¢çVÆÂÀĞ¢F–ÖW7F×ÀĞ¢ö–çBÀĞ¢wV—F"À¢&Wf–÷W4wV—F#¢&–÷"æwV—F"À¢G&fVÂÀĞ¢fVÆö6—G’ÀĞ¢f—6–öä6öæf–FVæ6RÀĞ¢7&÷76VD6VçG&Ä&æBÀĞ¢VF–ôÖF6†VC¢&ööÆVâ†öç6WB’ÀĞ¢G&6¶–æt6öæf–FVæ6RÀĞ¢F—&V7F–öã¢gW6VBæF—&V7F–öâÀĞ¢Ó°Ğ¢&WGW&âgW6VC°Ğ¢ĞĞ§ĞĞ Ğ¦W‡÷'BgVæ7F–öâ6W76–öäÖWG&–72‡7G&ö¶W2ÂF&vWD'ÒÂ&VG2ÒµÒ’°Ğ¢6öç7B–çFW'fÇ2Ò7G&ö¶W0Ğ¢ç6Æ–6RƒĞ¢æÖ‚‡2Â’’Óâ2çF–ÖW7F×Ò7G&ö¶W5¶•ÒçF–ÖW7F×Ğ¢æf–ÇFW"‚†â’ÓâââSbbâÂ#S“°Ğ¢6öç7BÖVâÒ–çFW'fÇ2æÆVæwF€Ğ¢ò–çFW'fÇ2ç&VGV6R‚†Â"’Óâ²"Â’ò–çFW'fÇ2æÆVæwF€Ğ¢¢°Ğ¢6öç7B'ÒÒÖVâòcòÖVâ¢°Ğ¢6öç7BF&vWD×2ÒcòF&vWD'Ó°Ğ¢6öç7Bf–Æ&ÆRÒæWr6WB†&VG2æÖ‚…òÂ’’Óâ’’“°Ğ¢6öç7Böfg6WG2ÒµÓ°Ğ¢f÷"†6öç7B7G&ö¶Röb7G&ö¶W2’°Ğ¢ÆWB&W7BÒçVÆÃ°Ğ¢f÷"†6öç7B’öbf–Æ&ÆR’°Ğ¢6öç7Böfg6WBÒ7G&ö¶RçF–ÖW7F×Ò&VG5¶•ÒçF–ÖW7F×°Ğ¢6öç7BBÒÖF‚æ'2†öfg6WB“°Ğ¢–b†BÃÒF&vWD×2¢ãCbbb‚&W7BÇÂBÂ&W7BæB’Ğ¢&W7BÒ²’Âöfg6WBÂBÓ°Ğ¢ĞĞ¢–b†&W7B’°Ğ¢f–Æ&ÆRæFVÆWFR†&W7Bæ’“°Ğ¢öfg6WG2çW6‚†&W7Bæöfg6WB“°Ğ¢ĞĞ¢ĞĞ¢6öç7Bftöfg6WBÒöfg6WG2æÆVæwF€Ğ¢òöfg6WG2ç&VGV6R‚†Â"’Óâ²"Â’òöfg6WG2æÆVæwF€Ğ¢¢°Ğ¢6öç7Bf&–æ6RÒöfg6WG2æÆVæwF€Ğ¢òöfg6WG2ç&VGV6R‚‡7VÒÂâ’Óâ7VÒ²†âÒftöfg6WB’¢¢"Â’ğĞ¢öfg6WG2æÆVæwF€Ğ¢¢°Ğ¢6öç7B6öç6—7FVæ7’ÒÖF‚ç&÷VæB€Ğ¢6Æ×ƒÒÖF‚ç7'B‡f&–æ6R’ò‡F&vWD×2¢ã3R’’¢ÀĞ¢“°Ğ¢&WGW&â°Ğ¢F÷FÃ¢7G&ö¶W2æÆVæwF‚ÀĞ¢F÷vã¢7G&ö¶W2æf–ÇFW"‚‡2’Óâ2æF—&V7F–öâÓÓÒ&F÷vâ"’æÆVæwF‚ÀĞ¢W¢7G&ö¶W2æf–ÇFW"‚‡2’Óâ2æF—&V7F–öâÓÓÒ'W"’æÆVæwF‚ÀĞ¢7W'&VçD'Ó¢ÖF‚ç&÷VæB†'Ò’ÀĞ¢fW&vT'Ó¢ÖF‚ç&÷VæB†'Ò’ÀĞ¢fW&vTöfg6WD×3¢ÖF‚ç&÷VæB†ftöfg6WB’ÀĞ¢F–Ö–æu7FDFWd×3¢ÖF‚ç&÷VæB„ÖF‚ç7'B‡f&–æ6R’’ÀĞ¢6öç6—7FVæ7’ÀĞ¢Ö—76VD&VDW7F–ÖFS¢f–Æ&ÆRç6—¦RÀĞ¢ÖF6†VD&VG3¢öfg6WG2æÆVæwF‚ÀĞ¢V&Ç“¢öfg6WG2æf–ÇFW"‚†â’ÓââÂ’æÆVæwF‚ÀĞ¢ÆFS¢öfg6WG2æf–ÇFW"‚†â’Óâââ’æÆVæwF‚ÀĞ¢Ó°Ğ§ĞĞ