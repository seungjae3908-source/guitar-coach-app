import App from './App';
import DebugCenter from './DebugCenter';
import FocusAnalyzer from './FocusAnalyzer';

export default function AppSafe() {
  const params = new URLSearchParams(window.location.search);

  // The public HTTPS entry point is the real remote diagnostic center.
  // Legacy studio/focus screens remain available only through explicit URLs
  // so an unfinished prototype can never be mistaken for the deployed site.
  if (params.get('studio') === '1') return <App />;
  if (params.get('focus') === '1') return <FocusAnalyzer />;
  return <DebugCenter />;
}
