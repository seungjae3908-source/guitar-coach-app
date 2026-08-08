import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const appSafe = readFileSync(resolve(process.cwd(), 'src/AppSafe.jsx'), 'utf8');
const practice = readFileSync(resolve(process.cwd(), 'src/PracticeApp.jsx'), 'utf8');
const styles = readFileSync(resolve(process.cwd(), 'src/practice-app.css'), 'utf8');

test('public entry renders the compact practice app instead of the diagnostic center', () => {
  assert.match(appSafe, /return <PracticeApp \/>/);
  assert.match(appSafe, /params\.get\('debug'\) === '1'/);
  const practiceReturn = appSafe.lastIndexOf('return <PracticeApp />');
  const debugRoute = appSafe.indexOf("params.get('debug') === '1'");
  assert.ok(practiceReturn > debugRoute);
});

test('practice app exposes only real camera, focus practice and diagnostic surfaces', () => {
  assert.match(practice, /AI 카메라/);
  assert.match(practice, /집중연습/);
  assert.match(practice, /고급 진단/);
  assert.match(practice, /<FocusAnalyzer \/>/);
  assert.match(practice, /<DebugCenter \/>/);
  assert.doesNotMatch(practice, /NOT CONNECTED|UI PROTOTYPE|준비 중/);
});

test('camera mode collapses the long diagnostic-only sections', () => {
  assert.match(styles, /\.practice-camera \.debug-header/);
  assert.match(styles, /section:not\(\.debug-camera-card\):not\(\.debug-instruction-card\)/);
  assert.match(styles, /\.practice-bottom-nav/);
  assert.match(styles, /position:\s*fixed/);
});
