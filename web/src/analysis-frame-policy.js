function positiveDimension(value, fallback) {
  const numeric = Math.round(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function analysisFrameDimensions(
  sourceWidth,
  sourceHeight,
  landscapeWidth = 240,
  landscapeHeight = 135,
) {
  const width = positiveDimension(sourceWidth, landscapeWidth);
  const height = positiveDimension(sourceHeight, landscapeHeight);
  const longSide = Math.max(
    positiveDimension(landscapeWidth, 240),
    positiveDimension(landscapeHeight, 135),
  );
  const shortSide = Math.min(
    positiveDimension(landscapeWidth, 240),
    positiveDimension(landscapeHeight, 135),
  );

  return width >= height
    ? { width: longSide, height: shortSide, orientation: 'landscape' }
    : { width: shortSide, height: longSide, orientation: 'portrait' };
}

function sourcePixels(imageData) {
  if (!imageData) return null;
  return imageData.data || imageData;
}

function channelAt(source, width, height, x, y, channel) {
  const boundedX = Math.max(0, Math.min(width - 1, x));
  const boundedY = Math.max(0, Math.min(height - 1, y));
  return source[(boundedY * width + boundedX) * 4 + channel] || 0;
}

export function restoreAnalysisAspect(
  imageData,
  inputWidth,
  inputHeight,
  sourceWidth,
  sourceHeight,
) {
  const width = positiveDimension(inputWidth, 240);
  const height = positiveDimension(inputHeight, 135);
  const target = analysisFrameDimensions(sourceWidth, sourceHeight, width, height);
  const source = sourcePixels(imageData);

  if (!source || source.length < width * height * 4) {
    return { imageData, width, height, orientation: target.orientation, restored: false };
  }

  if (target.width === width && target.height === height) {
    return { imageData, width, height, orientation: target.orientation, restored: false };
  }

  const output = new Uint8ClampedArray(target.width * target.height * 4);
  for (let targetY = 0; targetY < target.height; targetY += 1) {
    const sourceY = ((targetY + 0.5) * height) / target.height - 0.5;
    const y0 = Math.floor(sourceY);
    const y1 = y0 + 1;
    const yWeight = sourceY - y0;

    for (let targetX = 0; targetX < target.width; targetX += 1) {
      const sourceX = ((targetX + 0.5) * width) / target.width - 0.5;
      const x0 = Math.floor(sourceX);
      const x1 = x0 + 1;
      const xWeight = sourceX - x0;
      const outputIndex = (targetY * target.width + targetX) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const top =
          channelAt(source, width, height, x0, y0, channel) * (1 - xWeight) +
          channelAt(source, width, height, x1, y0, channel) * xWeight;
        const bottom =
          channelAt(source, width, height, x0, y1, channel) * (1 - xWeight) +
          channelAt(source, width, height, x1, y1, channel) * xWeight;
        output[outputIndex + channel] = Math.round(top * (1 - yWeight) + bottom * yWeight);
      }
      output[outputIndex + 3] = 255;
    }
  }

  return {
    imageData: { data: output, width: target.width, height: target.height },
    width: target.width,
    height: target.height,
    orientation: target.orientation,
    restored: true,
  };
}
