export function coverTransform({ videoWidth, videoHeight, displayWidth, displayHeight, mirrored = false }) {
  if (![videoWidth, videoHeight, displayWidth, displayHeight].every((value) => value > 0)) throw new Error('INVALID_VIDEO_GEOMETRY');
  const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
  const scaledWidth = videoWidth * scale; const scaledHeight = videoHeight * scale;
  return { videoWidth, videoHeight, displayWidth, displayHeight, mirrored, scale, cropX: (scaledWidth - displayWidth) / 2, cropY: (scaledHeight - displayHeight) / 2 };
}

export function displayToSource(point, transform) {
  const renderedX = transform.mirrored ? transform.displayWidth - point.x : point.x;
  return {
    x: (renderedX + transform.cropX) / transform.scale / transform.videoWidth,
    y: (point.y + transform.cropY) / transform.scale / transform.videoHeight,
  };
}

export function sourceToDisplay(point, transform) {
  const renderedX = point.x * transform.videoWidth * transform.scale - transform.cropX;
  return {
    x: transform.mirrored ? transform.displayWidth - renderedX : renderedX,
    y: point.y * transform.videoHeight * transform.scale - transform.cropY,
  };
}
