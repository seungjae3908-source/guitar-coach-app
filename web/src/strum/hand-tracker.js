export async function createHandTracker() {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm');
  const tracker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.45, minTrackingConfidence: 0.45,
  });
  return {
    detect(video, timestamp) {
      const result = tracker.detectForVideo(video, timestamp);
      return result.landmarks.map((landmarks, index) => ({ landmarks, handedness: result.handednesses[index]?.[0]?.categoryName, score: result.handednesses[index]?.[0]?.score ?? 0 }));
    },
    close: () => tracker.close(),
  };
}
