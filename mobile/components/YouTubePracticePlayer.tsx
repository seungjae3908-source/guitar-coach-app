import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export type YouTubePlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued' | 'unknown';

type PlayerLoadState = 'idle' | 'loading' | 'ready' | 'error';

export function extractYouTubeVideoId(input: string) {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (url.hostname.endsWith('youtube.com')) {
      const queryId = url.searchParams.get('v');
      if (queryId && /^[A-Za-z0-9_-]{11}$/.test(queryId)) return queryId;
      const parts = url.pathname.split('/').filter(Boolean);
      const markerIndex = parts.findIndex((part) => part === 'embed' || part === 'shorts' || part === 'live');
      const id = markerIndex >= 0 ? parts[markerIndex + 1] : null;
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch {
    return null;
  }
  return null;
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
  return `YouTube 재생 오류${code == null ? '' : ` 코드 ${code}`}가 발생했습니다.`;
}

function playerHtml(videoId: string) {
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
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
      playerVars: {
        playsinline: 1,
        rel: 0,
        controls: 1,
        fs: 1,
        enablejsapi: 1,
        origin: 'https://www.youtube.com'
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
      if (message.type === 'seek' && player) player.seekTo(Math.max(0, Number(message.seconds) || 0), true);
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
        const message = 'YouTube 플레이어 준비 시간이 초과되었습니다. 네트워크를 확인하고 다시 시도하세요.';
        setLoadError(message);
        onError?.(message);
        return 'error';
      });
    }, 12_000);
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
        <Text style={styles.emptyText}>공식 영상 또는 사용 가능한 영상의 공유 URL을 붙여넣으면 실제 재생 위치와 악보를 동기화합니다.</Text>
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <WebView
        key={`${videoId}-${reloadKey}`}
        ref={webRef}
        source={{ html, baseUrl: 'https://www.youtube.com' }}
        originWhitelist={['https://*', 'http://*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
        mixedContentMode="compatibility"
        onLoadStart={() => setLoadState('loading')}
        onMessage={onMessage}
        onError={() => fail('YouTube 플레이어를 불러오지 못했습니다.')}
        onHttpError={(event) => fail(`YouTube 네트워크 응답 오류 ${event.nativeEvent.statusCode}`)}
        style={styles.webView}
      />
      {loadState === 'loading' ? (
        <View pointerEvents="none" style={styles.overlay}>
          <ActivityIndicator />
          <Text style={styles.overlayTitle}>영상 플레이어 준비 중</Text>
          <Text style={styles.overlayText}>재생 준비와 속도·구간 반복 설정을 연결하고 있습니다.</Text>
        </View>
      ) : null}
      {loadState === 'error' ? (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>영상을 재생하지 못했습니다</Text>
          <Text style={styles.overlayText}>{loadError}</Text>
          <Pressable onPress={() => setReloadKey((value) => value + 1)} style={styles.retryButton}>
            <Text style={styles.retryText}>다시 불러오기</Text>
          </Pressable>
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
  retryButton: { minHeight: 38, borderRadius: 10, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 12 },
  retryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  empty: { minHeight: 180, borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: '#8b949e', fontSize: 9, lineHeight: 15, textAlign: 'center', marginTop: 7 },
});
