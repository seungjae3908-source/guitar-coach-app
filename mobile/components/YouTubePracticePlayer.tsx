import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export type YouTubePlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued' | 'unknown';
export type YouTubeSeekRequest = { seconds: number; nonce: number };

type PlayerLoadState = 'idle' | 'loading' | 'ready' | 'error';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const PLAYER_ORIGIN = 'https://guitar-coach.local';

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

function stateFromCode(code: number): YouTubePlayerState {
  if (code === -1) return 'unstarted';
  if (code === 0) return 'ended';
  if (code === 1) return 'playing';
  if (code === 2) return 'paused';
  if (code === 3) return 'buffering';
  if (code === 5) return 'cued';
  return 'unknown';
}

function youtubeErrorMessage(code: number | undefined) {
  if (code === 2) return 'YouTube 영상 주소가 올바르지 않습니다.';
  if (code === 5) return '이 영상은 휴대폰 HTML5 플레이어에서 재생할 수 없습니다.';
  if (code === 100) return '삭제되었거나 비공개인 영상입니다.';
  if (code === 101 || code === 150) return '영상 소유자가 앱 안에서의 재생을 허용하지 않았습니다. 다른 공식 영상을 선택하세요.';
  if (code === 153) return 'YouTube가 앱 플레이어의 출처를 확인하지 못했습니다. 다시 불러오거나 다른 영상을 선택하세요.';
  return `YouTube 재생 오류${code == null ? '' : ` 코드 ${code}`}가 발생했습니다.`;
}

function playerHtml(videoId: string) {
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<meta name="referrer" content="strict-origin-when-cross-origin" />
<style>
  html, body, #player { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
</style>
</head>
<body>
<div id="player"></div>
<script>
  let player = null;
  let desiredRate = 1;
  let loopEnabled = false;
  let loopStart = 0;
  let loopEnd = 0;
  let lastSentAt = 0;
  function send(payload) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  function applySettings() {
    if (!player) return;
    try {
      const available = player.getAvailablePlaybackRates ? player.getAvailablePlaybackRates() : [];
      if (!available.length || available.indexOf(desiredRate) >= 0) player.setPlaybackRate(desiredRate);
    } catch (_) {}
  }
  function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
      videoId: '${videoId}',
      width: '100%',
      height: '100%',
      host: 'https://www.youtube.com',
      playerVars: {
        playsinline: 1,
        rel: 0,
        controls: 1,
        fs: 1,
        enablejsapi: 1,
        origin: '${PLAYER_ORIGIN}',
        widget_referrer: '${PLAYER_ORIGIN}/'
      },
      events: {
        onReady: function () {
          applySettings();
          send({ type: 'ready', duration: player.getDuration() || 0 });
        },
        onStateChange: function (event) {
          send({ type: 'state', state: event.data });
        },
        onPlaybackRateChange: function (event) {
          send({ type: 'rate', rate: event.data });
        },
        onError: function (event) {
          send({ type: 'error', code: event.data });
        }
      }
    });
  }
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.referrerPolicy = 'strict-origin-when-cross-origin';
  tag.onerror = function () { send({ type: 'network-error' }); };
  document.head.appendChild(tag);

  function handleCommand(raw) {
    try {
      const message = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!message) return;
      if (message.type === 'rate') {
        desiredRate = Math.max(0.25, Math.min(2, Number(message.value) || 1));
        applySettings();
      }
      if (message.type === 'seek' && player) {
        player.seekTo(Math.max(0, Number(message.seconds) || 0), true);
      }
      if (message.type === 'loop') {
        loopEnabled = Boolean(message.enabled);
        loopStart = Math.max(0, Number(message.start) || 0);
        loopEnd = Math.max(loopStart, Number(message.end) || 0);
      }
    } catch (_) {}
  }
  document.addEventListener('message', function (event) { handleCommand(event.data); });
  window.addEventListener('message', function (event) { handleCommand(event.data); });

  setInterval(function () {
    if (!player || typeof player.getCurrentTime !== 'function') return;
    const currentTime = player.getCurrentTime() || 0;
    const duration = player.getDuration() || 0;
    if (loopEnabled && loopEnd > loopStart && currentTime >= loopEnd) {
      player.seekTo(loopStart, true);
    }
    const now = Date.now();
    if (now - lastSentAt >= 250) {
      lastSentAt = now;
      send({
        type: 'time',
        currentTime: currentTime,
        duration: duration,
        rate: player.getPlaybackRate ? player.getPlaybackRate() : desiredRate
      });
    }
  }, 100);
</script>
</body>
</html>`;
}

export default function YouTubePracticePlayer({
  url,
  playbackRate,
  loopEnabled,
  loopStartSeconds,
  loopEndSeconds,
  seekRequest,
  onTimeChange,
  onDurationChange,
  onStateChange,
  onError,
}: {
  url: string;
  playbackRate: number;
  loopEnabled: boolean;
  loopStartSeconds: number;
  loopEndSeconds: number;
  seekRequest?: YouTubeSeekRequest | null;
  onTimeChange: (seconds: number) => void;
  onDurationChange: (seconds: number) => void;
  onStateChange?: (state: YouTubePlayerState) => void;
  onError?: (message: string) => void;
}) {
  const webRef = useRef<WebView>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadState, setLoadState] = useState<PlayerLoadState>('idle');
  const [loadError, setLoadError] = useState('');
  const videoId = useMemo(() => extractYouTubeVideoId(url), [url]);
  const canonicalUrl = useMemo(() => normalizeYouTubeUrl(url), [url]);
  const html = useMemo(() => videoId ? playerHtml(videoId) : '', [videoId]);

  const fail = (message: string) => {
    setLoadState('error');
    setLoadError(message);
    onError?.(message);
  };

  useEffect(() => {
    if (!videoId) {
      setLoadState('idle');
      setLoadError('');
      return;
    }
    setLoadState('loading');
    setLoadError('');
    onTimeChange(0);
    onDurationChange(0);
    onStateChange?.('unstarted');
    const timeout = setTimeout(() => {
      setLoadState((current) => {
        if (current === 'ready') return current;
        const message = 'YouTube 플레이어 준비 시간이 초과되었습니다. 인터넷 연결을 확인하고 다시 시도하세요.';
        setLoadError(message);
        onError?.(message);
        return 'error';
      });
    }, 18_000);
    return () => clearTimeout(timeout);
  }, [reloadKey, videoId]);

  useEffect(() => {
    if (!videoId || loadState !== 'ready') return;
    webRef.current?.postMessage(JSON.stringify({ type: 'rate', value: playbackRate }));
  }, [loadState, playbackRate, videoId]);

  useEffect(() => {
    if (!videoId || loadState !== 'ready') return;
    webRef.current?.postMessage(JSON.stringify({
      type: 'loop',
      enabled: loopEnabled,
      start: loopStartSeconds,
      end: loopEndSeconds,
    }));
  }, [loadState, loopEnabled, loopEndSeconds, loopStartSeconds, videoId]);

  useEffect(() => {
    if (!videoId || loadState !== 'ready' || !seekRequest) return;
    webRef.current?.postMessage(JSON.stringify({ type: 'seek', seconds: seekRequest.seconds }));
  }, [loadState, seekRequest?.nonce, videoId]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        currentTime?: number;
        duration?: number;
        state?: number;
        code?: number;
      };
      if (message.type === 'time') {
        if (Number.isFinite(message.currentTime)) onTimeChange(message.currentTime ?? 0);
        if (Number.isFinite(message.duration) && (message.duration ?? 0) > 0) onDurationChange(message.duration ?? 0);
      } else if (message.type === 'ready') {
        setLoadState('ready');
        setLoadError('');
        if (Number.isFinite(message.duration)) onDurationChange(message.duration ?? 0);
        onStateChange?.('cued');
        requestAnimationFrame(() => {
          webRef.current?.postMessage(JSON.stringify({ type: 'rate', value: playbackRate }));
          webRef.current?.postMessage(JSON.stringify({
            type: 'loop',
            enabled: loopEnabled,
            start: loopStartSeconds,
            end: loopEndSeconds,
          }));
        });
      } else if (message.type === 'state') {
        setLoadState('ready');
        onStateChange?.(stateFromCode(message.state ?? -99));
      } else if (message.type === 'network-error') {
        fail('YouTube 플레이어 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
      } else if (message.type === 'error') {
        fail(youtubeErrorMessage(message.code));
      }
    } catch {
      fail('YouTube 재생 상태를 읽지 못했습니다.');
    }
  };

  if (!videoId) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>유효한 YouTube URL이 필요합니다</Text>
        <Text style={styles.emptyText}>앱 안에서 영상을 검색해 선택하거나 공유 URL을 붙여넣은 뒤 ‘링크 적용’을 누르세요.</Text>
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <WebView
        key={`${videoId}-${reloadKey}`}
        ref={webRef}
        source={{ html, baseUrl: `${PLAYER_ORIGIN}/` }}
        originWhitelist={['https://*', 'http://*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        cacheEnabled
        mixedContentMode="compatibility"
        setSupportMultipleWindows={false}
        applicationNameForUserAgent="GuitarCoachAI/0.6.0"
        onLoadStart={() => setLoadState('loading')}
        onMessage={onMessage}
        onError={(event) => fail(event.nativeEvent.description || 'YouTube 플레이어를 불러오지 못했습니다.')}
        onHttpError={(event) => fail(`YouTube 네트워크 응답 오류 ${event.nativeEvent.statusCode}`)}
        onContentProcessDidTerminate={() => fail('영상 표시 프로세스가 종료되었습니다. 다시 불러오세요.')}
        onRenderProcessGone={() => fail('Android 영상 프로세스가 종료되었습니다. 다시 불러오세요.')}
        style={styles.webView}
      />
      {loadState === 'loading' ? (
        <View pointerEvents="none" style={styles.overlay}>
          <ActivityIndicator />
          <Text style={styles.overlayTitle}>영상 플레이어 준비 중</Text>
          <Text style={styles.overlayText}>재생 준비와 속도·구간 반복 설정을 실제 플레이어에 연결하고 있습니다.</Text>
        </View>
      ) : null}
      {loadState === 'error' ? (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>영상을 재생하지 못했습니다</Text>
          <Text style={styles.overlayText}>{loadError}</Text>
          <View style={styles.errorButtons}>
            <Pressable onPress={() => setReloadKey((value) => value + 1)} style={styles.retryButton}>
              <Text style={styles.retryText}>다시 불러오기</Text>
            </Pressable>
            {canonicalUrl ? (
              <Pressable onPress={() => void Linking.openURL(canonicalUrl)} style={styles.externalButton}>
                <Text style={styles.externalText}>YouTube에서 확인</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 16 / 9, borderRadius: 15, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d' },
  webView: { flex: 1, backgroundColor: '#000000' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.86)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  overlayTitle: { color: '#ffffff', fontSize: 12, fontWeight: '900', marginTop: 9 },
  errorTitle: { color: '#ff7b72', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  overlayText: { color: '#b1bac4', fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 6 },
  errorButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12 },
  retryButton: { minHeight: 38, borderRadius: 10, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  retryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  externalButton: { minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: '#58a6ff', backgroundColor: '#111d2f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  externalText: { color: '#79c0ff', fontSize: 9, fontWeight: '900' },
  empty: { minHeight: 180, borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: '#8b949e', fontSize: 9, lineHeight: 15, textAlign: 'center', marginTop: 7 },
});
