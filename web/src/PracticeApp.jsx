import { useState } from 'react';
import DebugCenter from './AdaptiveDebugCenter';
import FocusAnalyzer from './FocusAnalyzer';
import './practice-app.css';

const TABS = [
  { id: 'camera', label: 'AI 카메라', icon: '◉' },
  { id: 'practice', label: '집중연습', icon: '♪' },
  { id: 'diagnostic', label: '진단', icon: '⚙' },
];

export default function PracticeApp() {
  const [active, setActive] = useState('camera');

  return (
    <div className="practice-app-shell">
      <header className="practice-app-header">
        <div>
          <span>GUITAR COACH AI · TEST BETA</span>
          <h1>{active === 'camera' ? 'AI 카메라 연습' : active === 'practice' ? '집중 연습' : '고급 진단'}</h1>
        </div>
        <strong>{active === 'diagnostic' ? '문제 확인용' : '실제 동작 기능'}</strong>
      </header>

      <main className="practice-app-main">
        {active === 'camera' ? (
          <section className="practice-camera" aria-label="AI 카메라 연습">
            <DebugCenter />
          </section>
        ) : null}

        {active === 'practice' ? (
          <section className="practice-focus" aria-label="집중 연습">
            <FocusAnalyzer />
          </section>
        ) : null}

        {active === 'diagnostic' ? (
          <section className="practice-diagnostic" aria-label="고급 진단">
            <div className="practice-diagnostic-note">
              <strong>고급 진단</strong>
              <span>인식이 이상할 때만 사용합니다. JSON·세부 판정·로그는 이 탭에만 둡니다.</span>
            </div>
            <DebugCenter />
          </section>
        ) : null}
      </main>

      <nav className="practice-bottom-nav" aria-label="기타 코치 메뉴">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={active === tab.id ? 'active' : ''}
            onClick={() => setActive(tab.id)}
          >
            <span aria-hidden="true">{tab.icon}</span>
            <strong>{tab.label}</strong>
          </button>
        ))}
      </nav>
    </div>
  );
}
