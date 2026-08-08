import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), 'src/AppSafe.jsx');
const source = `import App from './App';
import DebugCenter from './AdaptiveDebugCenter';
import FocusAnalyzer from './FocusAnalyzer';
import PracticeApp from './PracticeApp';

export default function AppSafe() {
  const params = new URLSearchParams(window.location.search);

  // The public entry is the compact real-practice shell. Full adaptive
  // diagnostics remain explicitly available for troubleshooting only.
  if (params.get('admin') === '1' || params.get('debug') === '1') return <DebugCenter />;
  if (params.get('studio') === '1') return <App />;
  if (params.get('focus') === '1') return <FocusAnalyzer />;
  return <PracticeApp />;
}
`;

writeFileSync(target, source);
console.log('Restored compact PracticeApp as the public entry after adaptive source installation.');
