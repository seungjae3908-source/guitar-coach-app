import App from './App';
import FocusAnalyzer from './FocusAnalyzer';

export default function AppSafe() {
  const focusMode = new URLSearchParams(window.location.search).get('focus') === '1';
  return focusMode ? <FocusAnalyzer /> : <App />;
}
