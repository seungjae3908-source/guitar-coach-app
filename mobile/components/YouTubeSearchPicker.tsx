import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { normalizeYouTubeUrl } from './YouTubePracticePlayer';

const SEARCH_BRIDGE = `
(function () {
  if (window.__guitarCoachSearchBridgeInstalled) return true;
  window.__guitarCoachSearchBridgeInstalled = true;
  function send(href) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'youtube-navigation', href: String(href || location.href) }));
    } catch (_) {}
  }
  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node !== document && !node.href) node = node.parentElement;
    if (node && node.href) send(node.href);
  }, true);
  var lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      send(lastHref);
    }
  }, 350);
  send(location.href);
  true;
})();`;

function searchUrl(query: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
}

export default function YouTubeSearchPicker({
  visible,
  initialQuery,
  onClose,
  onSelect,
}: {
  visible: boolean;
  initialQuery: string;
  onClose: () => void;
  onSelect: (canonicalUrl: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [webKey, setWebKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const url = useMemo(() => searchUrl(submittedQuery || initialQuery), [initialQuery, submittedQuery]);

  useEffect(() => {
    if (!visible) return;
    setQuery(initialQuery);
    setSubmittedQuery(initialQuery);
    setCurrentUrl('');
    setError('');
    setLoading(true);
    setWebKey((value) => value + 1);
  }, [initialQuery, visible]);

  const chooseFromUrl = (candidate: string) => {
    const canonical = normalizeYouTubeUrl(candidate);
    if (!canonical) return false;
    onSelect(canonical);
    return true;
  };

  const handleNavigation = (navigation: WebViewNavigation) => {
    setCurrentUrl(navigation.url);
    if (chooseFromUrl(navigation.url)) return;
    setLoading(navigation.loading);
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; href?: string };
      if (message.type === 'youtube-navigation' && message.href) {
        setCurrentUrl(message.href);
        chooseFromUrl(message.href);
      }
    } catch {
      // Ignore unrelated YouTube page messages.
    }
  };

  const submitSearch = () => {
    const next = query.trim();
    if (!next) {
      setError('검색할 곡명이나 가수를 입력하세요.');
      return;
    }
    setError('');
    setSubmittedQuery(next);
    setLoading(true);
    setWebKey((value) => value + 1);
  };

  const currentCanonical = normalizeYouTubeUrl(currentUrl);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>IN-APP YOUTUBE SEARCH</Text>
            <Text style={styles.title}>영상 선택 시 URL 자동 입력</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>닫기</Text>
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submitSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="곡명, 가수, 기타 커버 검색"
            placeholderTextColor="#6e7681"
            style={styles.input}
          />
          <Pressable onPress={submitSearch} style={styles.searchButton}>
            <Text style={styles.searchText}>검색</Text>
          </Pressable>
        </View>

        <View style={styles.guideCard}>
          <Text style={styles.guideText}>검색 결과에서 원하는 영상을 누르면 앱이 영상 ID를 감지해 곡 스튜디오에 자동 입력하고 바로 재생 준비를 시작합니다.</Text>
          {currentCanonical ? (
            <Pressable onPress={() => onSelect(currentCanonical)} style={styles.useButton}>
              <Text style={styles.useText}>현재 영상 사용</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.webFrame}>
          <WebView
            key={`${webKey}-${url}`}
            source={{ uri: url, headers: { Referer: 'https://www.youtube.com/' } }}
            injectedJavaScript={SEARCH_BRIDGE}
            injectedJavaScriptBeforeContentLoaded={SEARCH_BRIDGE}
            onMessage={handleMessage}
            onNavigationStateChange={handleNavigation}
            onShouldStartLoadWithRequest={(request) => {
              if (chooseFromUrl(request.url)) return false;
              return true;
            }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={(event) => setError(event.nativeEvent.description || 'YouTube 검색 화면을 열지 못했습니다.')}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            allowsFullscreenVideo
            applicationNameForUserAgent="GuitarCoachAI/0.6.0"
            style={styles.webView}
          />
          {loading ? (
            <View pointerEvents="none" style={styles.loadingOverlay}>
              <ActivityIndicator />
              <Text style={styles.loadingText}>YouTube 검색 결과 불러오는 중</Text>
            </View>
          ) : null}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  headerText: { flex: 1, paddingRight: 10 },
  eyebrow: { color: '#ff7b72', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '900', marginTop: 3 },
  closeButton: { minWidth: 58, minHeight: 40, borderRadius: 11, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#484f58', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  searchRow: { flexDirection: 'row', gap: 7, padding: 11, paddingBottom: 6 },
  input: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', color: '#f0f6fc', paddingHorizontal: 11, fontSize: 10 },
  searchButton: { minWidth: 66, minHeight: 44, borderRadius: 12, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center' },
  searchText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  guideCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 11, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#102418', padding: 10 },
  guideText: { flex: 1, color: '#b9e6c5', fontSize: 8, lineHeight: 13, paddingRight: 8 },
  useButton: { minHeight: 36, borderRadius: 9, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  useText: { color: '#ffffff', fontSize: 8, fontWeight: '900' },
  webFrame: { flex: 1, marginHorizontal: 9, marginBottom: 8, overflow: 'hidden', borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#000000' },
  webView: { flex: 1, backgroundColor: '#000000' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(13,17,23,0.78)' },
  loadingText: { color: '#ffffff', fontSize: 9, fontWeight: '800', marginTop: 8 },
  errorText: { color: '#ff7b72', fontSize: 9, lineHeight: 14, paddingHorizontal: 12, paddingBottom: 10 },
});
