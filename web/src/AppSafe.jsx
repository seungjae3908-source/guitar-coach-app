import App from './App';
import DebugCenter from './DebugCenter';
import FocusAnalyzer from './FocusAnalyzer';

export default function AppSafe() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === '1') return <DebugCenter />;
  const focusMode = params.get('focus') === '1';
  return focusMode ? <FocusAnalyzer /> : <App />;
}
