"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cameraCoverMetrics = cameraCoverMetrics;
exports.previewPointToImage = previewPointToImage;
exports.imagePointToPreview = imagePointToPreview;
exports.expandNormalizedRegion = expandNormalizedRegion;
exports.previewRegionToImage = previewRegionToImage;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
function safeSize(size) {
    return {
        width: Math.max(1, Number.isFinite(size.width) ? size.width : 1),
        height: Math.max(1, Number.isFinite(size.height) ? size.height : 1),
    };
}
function cameraCoverMetrics(preview, image) {
    const safePreview = safeSize(preview);
    const safeImage = safeSize(image);
    const scale = Math.max(safePreview.width / safeImage.width, safePreview.height / safeImage.height);
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
function previewPointToImage(point, preview, image) {
    const metrics = cameraCoverMetrics(preview, image);
    return {
        x: clamp01((clamp01(point.x) * metrics.previewWidth + metrics.cropX) / metrics.displayedWidth),
        y: clamp01((clamp01(point.y) * metrics.previewHeight + metrics.cropY) / metrics.displayedHeight),
    };
}
function imagePointToPreview(point, preview, image) {
    const metrics = cameraCoverMetrics(preview, image);
    return {
        x: clamp01((clamp01(point.x) * metrics.displayedWidth - metrics.cropX) / metrics.previewWidth),
        y: clamp01((clamp01(point.y) * metrics.displayedHeight - metrics.cropY) / metrics.previewHeight),
    };
}
function expandNormalizedRegion(region, padding = 0) {
    const safePadding = Math.max(0, Number.isFinite(padding) ? padding : 0);
    return {
        left: clamp01(Math.min(region.left, region.right) - safePadding),
        top: clamp01(Math.min(region.top, region.bottom) - safePadding),
        right: clamp01(Math.max(region.left, region.right) + safePadding),
        bottom: clamp01(Math.max(region.top, region.bottom) + safePadding),
    };
}
function previewRegionToImage(region, preview, image, padding = 0) {
    const topLeft = previewPointToImage({ x: region.left, y: region.top }, preview, image);
    const bottomRight = previewPointToImage({ x: region.right, y: region.bottom }, preview, image);
    return expandNormalizedRegion({
        left: Math.min(topLeft.x, bottomRight.x),
        top: Math.min(topLeft.y, bottomRight.y),
        right: Math.max(topLeft.x, bottomRight.x),
        bottom: Math.max(topLeft.y, bottomRight.y),
    }, padding);
}
