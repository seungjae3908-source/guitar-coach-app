import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export type YouTubePlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued' | 'unknown';

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
  let loopEnabled = false;
  let loopStart = 0;
  let loopEnd = 0;
  let lastSentAt = 0;
  function send(payload) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
      videoId: '${videoId}',
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, controls: 1, fs: 1 },
      events: {
        onReady: function () {
          send({ type: 'ready', duration: player.getDuration() || 0 });
        },
        onStateChange: function (event) {
          send({ type: 'state', state: event.data });
        },
        onError: function (event) {
          send({ type: 'error', code: event.data });
        }
      }
    });
  }
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);

  function handleCommand(raw) {
    try {
      const message = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!player || !message) return;
      if (message.type === 'rate') {
        const available = player.getAvailablePlaybackRates ? player.getAvailablePlaybackRates() : [];
        if (!available.length || available.indexOf(message.value) >= 0) player.setPlaybackRate(message.value);
      }
      if (message.type === 'seek') player.seekTo(Math.max(0, Number(message.seconds) || 0), true);
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
        rate: player.getPlaybackRate ? player.getPlaybackRate() : 1
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
  const videoId = useMemo(() => extractYouTubeVideoId(url), [url]);
  const html = useMemo(() => videoId ? playerHtml(videoId) : '', [videoId]);

  useEffect(() => {
    if (!videoId) return;
    webRef.current?.postMessage(JSON.stringify({ type: 'rate', value: playbackRate }));
  }, [playbackRate, videoId]);

  useEffect(() => {
    if (!videoId) return;
    webRef.current?.postMessage(JSON.stringify({
      type: 'loop',
      enabled: loopEnabled,
      start: loopStartSeconds,
      end: loopEndSeconds,
    }));
  }, [loopEnabled, loopEndSeconds, loopStartSeconds, videoId]);

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
        if (Number.isFinite(message.duration)) onDurationChange(message.duration ?? 0);
      } else if (message.type === 'state') {
        onStateChange?.(stateFromCode(message.state ?? -99));
      } else if (message.type === 'error') {
        onError?.(`YouTube 재생 오류 코드 ${message.code ?? '-'}`);
      }
    } catch {
      onError?.('YouTube 재생 상태를 읽지 못했습니다.');
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
        ref={webRef}
        source={{ html, baseUrl: 'https://www.youtube.com' }}
        originWhitelist={['https://*', 'http://*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
        onMessage={onMessage}
        onError={() => onError?.('YouTube 플레이어를 불러오지 못했습니다.')}
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 16 / 9, borderRadius: 15, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d' },
  webView: { flex: 1, backgroundColor: '#000000' },
  empty: { minHeight: 180, borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: '#8b949e', fontSize: 9, lineHeight: 15, textAlign: 'center', marginTop: 7 },
});
