const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function stripTrailingPunctuation(value: string) {
  return value
    .trim()
    .replace(/^[\s<({\["'`]+/, '')
    .replace(/[\s>)}\]"'`,.;!?]+$/, '');
}

function firstUrlLikeValue(input: string) {
  const match = input.match(/(?:https?:\/\/|www\.|m\.|music\.|youtube\.com\/|youtu\.be\/|youtube-nocookie\.com\/)[^\s<>"']+/i);
  return stripTrailingPunctuation(match?.[0] ?? input);
}

function validId(value: string | null | undefined) {
  return value && VIDEO_ID_PATTERN.test(value) ? value : null;
}

function parseYouTubeId(input: string, depth = 0): string | null {
  if (depth > 3) return null;
  let value = firstUrlLikeValue(input);
  if (VIDEO_ID_PATTERN.test(value)) return value;

  if (/^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(value)) {
    value = `https://${value}`;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);

    if (hostname === 'youtu.be') return validId(parts[0]);

    const isYouTube = hostname === 'youtube.com'
      || hostname.endsWith('.youtube.com')
      || hostname === 'youtube-nocookie.com'
      || hostname.endsWith('.youtube-nocookie.com');
    if (!isYouTube) return null;

    const queryId = validId(url.searchParams.get('v'));
    if (queryId) return queryId;

    const markerIndex = parts.findIndex((part) => ['embed', 'shorts', 'live', 'v'].includes(part));
    const pathId = markerIndex >= 0 ? validId(parts[markerIndex + 1]) : null;
    if (pathId) return pathId;

    if (parts[0] === 'watch') {
      const watchPathId = validId(parts[1]);
      if (watchPathId) return watchPathId;
    }

    for (const parameter of ['q', 'u', 'url']) {
      const nested = url.searchParams.get(parameter);
      if (!nested) continue;
      const decoded = decodeURIComponent(nested);
      const absolute = decoded.startsWith('/') ? `https://www.youtube.com${decoded}` : decoded;
      const nestedId = parseYouTubeId(absolute, depth + 1);
      if (nestedId) return nestedId;
    }
  } catch {
    const looseMatch = value.match(/(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([A-Za-z0-9_-]{11})/i);
    return validId(looseMatch?.[1]);
  }

  return null;
}

export function extractYouTubeVideoId(input: string) {
  return parseYouTubeId(input);
}

export function normalizeYouTubeUrl(input: string) {
  const id = extractYouTubeVideoId(input);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
