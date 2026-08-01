export type PixelSize = { width: number; height: number };
export type CameraNormalizedPoint = { x: number; y: number };
export type CameraNormalizedRegion = { left: number; top: number; right: number; bottom: number };

type CoverMetrics = {
  previewWidth: number;
  previewHeight: number;
  displayedWidth: number;
  displayedHeight: number;
  cropX: number;
  cropY: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function safeSize(size: PixelSize): PixelSize {
  return {
    width: Math.max(1, Number.isFinite(size.width) ? size.width : 1),
    height: Math.max(1, Number.isFinite(size.height) ? size.height : 1),
  };
}

export function cameraCoverMetrics(preview: PixelSize, image: PixelSize): CoverMetrics {
  const safePreview = safeSize(preview);
  const safeImage = safeSize(image);
  const scale = Math.max(
    safePreview.width / safeImage.width,
    safePreview.height / safeImage.height,
  );
  const displayedWidth = safeImage.width * scale;
  const displayedHeight = safeImage.height * scale;
  return {
    previewWidth: safePreview.width,
    previewHeight: safePreview.height,
    displayedWidth,
    displayedHeight,
    cropX: Math.max(0, (displayedWidth - safePreview.width) / 2),
    cropY: Math.max(0, (displayedHeight - safePreview.height) / 2),
  };
}

export function previewPointToImage(
  point: CameraNormalizedPoint,
  preview: PixelSize,
  image: PixelSize,
): CameraNormalizedPoint {
  const metrics = cameraCoverMetrics(preview, image);
  return {
    x: clamp01((clamp01(point.x) * metrics.previewWidth + metrics.cropX) / metrics.displayedWidth),
    y: clamp01((clamp01(point.y) * metrics.previewHeight + metrics.cropY) / metrics.displayedHeight),
  };
}

export function imagePointToPreview(
  point: CameraNormalizedPoint,
  preview: PixelSize,
  image: PixelSize,
): CameraNormalizedPoint {
  const metrics = cameraCoverMetrics(preview, image);
  return {
    x: clamp01((clamp01(point.x) * metrics.displayedWidth - metrics.cropX) / metrics.previewWidth),
    y: clamp01((clamp01(point.y) * metrics.displayedHeight - metrics.cropY) / metrics.previewHeight),
  };
}

export function expandNormalizedRegion(
  region: CameraNormalizedRegion,
  padding = 0,
): CameraNormalizedRegion {
  const safePadding = Math.max(0, Number.isFinite(padding) ? padding : 0);
  return {
    left: clamp01(Math.min(region.left, region.right) - safePadding),
    top: clamp01(Math.min(region.top, region.bottom) - safePadding),
    right: clamp01(Math.max(region.left, region.right) + safePadding),
    bottom: clamp01(Math.max(region.top, region.bottom) + safePadding),
  };
}

export function previewRegionToImage(
  region: CameraNormalizedRegion,
  preview: PixelSize,
  image: PixelSize,
  padding = 0,
): CameraNormalizedRegion {
  const topLeft = previewPointToImage({ x: region.left, y: region.top }, preview, image);
  const bottomRight = previewPointToImage({ x: region.right, y: region.bottom }, preview, image);
  return expandNormalizedRegion({
    left: Math.min(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y),
    right: Math.max(topLeft.x, bottomRight.x),
    bottom: Math.max(topLeft.y, bottomRight.y),
  }, padding);
}
