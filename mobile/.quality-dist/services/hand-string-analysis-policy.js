"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldRefreshStringVision = shouldRefreshStringVision;
function shouldRefreshStringVision(input) {
    if (input.requested === true)
        return true;
    if (input.requested === false)
        return false;
    if (input.cachedAt == null)
        return true;
    return input.now - input.cachedAt > input.reuseMs;
}
