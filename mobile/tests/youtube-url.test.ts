import { extractYouTubeVideoId, normalizeYouTubeUrl } from '../services/youtube-url';

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

const id = 'M7lc1UVf-VE';
const supported = [
  id,
  `https://youtu.be/${id}?si=share-token`,
  `https://www.youtube.com/watch?v=${id}&si=share-token`,
  `https://m.youtube.com/watch?v=${id}`,
  `https://music.youtube.com/watch?v=${id}`,
  `https://www.youtube.com/shorts/${id}?feature=share`,
  `https://www.youtube.com/live/${id}?si=share-token`,
  `https://www.youtube.com/embed/${id}`,
  `https://www.youtube-nocookie.com/embed/${id}`,
  `공유한 영상입니다 https://youtu.be/${id}?si=abc 확인해 주세요`,
  `https://www.youtube.com/attribution_link?u=%2Fwatch%3Fv%3D${id}%26feature%3Dshare`,
];

supported.forEach((value, index) => {
  equal(extractYouTubeVideoId(value), id, `extract supported ${index + 1}`);
  equal(normalizeYouTubeUrl(value), `https://www.youtube.com/watch?v=${id}`, `normalize supported ${index + 1}`);
});

equal(extractYouTubeVideoId('https://example.com/video'), null, 'reject non YouTube URL');
equal(normalizeYouTubeUrl('잘못된 주소'), null, 'reject invalid text');

console.log(`YouTube URL tests passed: ${supported.length + 2}`);
