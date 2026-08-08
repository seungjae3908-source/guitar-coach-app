import App from './App';
import DebugCenter from './DebugCenter';
import FocusAnalyzer from './FocusAnalyzer';
import PracticeApp from './PracticeApp';

export default function AppSafe() {
  const params = new URLSearchParams(window.location.search);

  // Public users get the compact practice app. Full diagnostics and the old
  // studio prototype remain explicit troubleshooting/development surfaces.
  if (params.get('admin') === '1' || params.get('debug') === '1') return <DebugCenter />;
  if (params.get('studio') === '1') return <App />;
  if (params.get('focus') === '1') return <FocusAnalyzer />;
  return <PracticeApp />;
}
