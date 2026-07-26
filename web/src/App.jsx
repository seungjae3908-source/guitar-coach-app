import { useState } from 'react';

const menuItems = [
  ['홈', '⌂'],
  ['카메라 연습', '◉'],
  ['악보', '♬'],
  ['집중 연습', '◎'],
  ['톤메이킹', '≋'],
  ['공부하기', '▤'],
  ['연습 기록', '▥'],
  ['촬영 영상', '▶'],
  ['웹 연결', '⌁'],
  ['설정', '⚙'],
];

const timeline = [
  { time: '00:12', title: '좋은 시작', detail: '엄지 음량이 일정합니다.', type: 'good' },
  { time: '00:28', title: '검지 복귀 지연', detail: 'P-I-P에서 평균 0.18초 늦었습니다.', type: 'warn' },
  { time: '00:42', title: '업스트로크 걸림', detail: '피크 깊이를 조금 줄여보세요.', type: 'warn' },
  { time: '01:03', title: '리듬 안정', detail: '두 마디 연속 타이밍이 정확했습니다.', type: 'good' },
];

const genericPanels = {
  '카메라 연습': ['휴대폰 카메라 미연결', '마이크 분석 미연결', '실시간 점수 데이터 대기'],
  악보: ['곡 검색 UI', 'AI 초안·검증 상태', '현재 마디 자동 이동 예정'],
  '집중 연습': ['코드', '핑거링', '아르페지오', '스트럼', '피킹'],
  톤메이킹: ['Yamaha THR30', 'BOSS GT-1', '일반 앰프·사용자 장비'],
  공부하기: ['코드·리듬·타브', '아르페지오·피킹', '스케일·톤메이킹'],
  '연습 기록': ['연습 시간', '점수 변화', '틀린 구간 원인'],
  '촬영 영상': ['휴대폰 원본 보관', '1분 자동 분할 예정', '틀린 부분 클립 예정'],
  '웹 연결': ['QR 연결 예정', '영상 스트리밍 사용 안 함', '점수·악보 데이터만 전송'],
  설정: ['음성 출력 위치', '사용 장비 등록', '로컬 저장 공간'],
};

function Sidebar({ active, onSelect }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">GC</div>
        <div>
          <strong>Guitar Coach AI</strong>
          <span>Personal Studio</span>
        </div>
      </div>
      <nav>
        {menuItems.map(([label, icon]) => (
          <button
            type="button"
            key={label}
            className={active === label ? 'nav-item active' : 'nav-item'}
            onClick={() => onSelect(label)}
          >
            <span className="nav-icon">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="connection-card">
        <div className="connection-line">
          <span className="status-dot" />
          휴대폰 미연결
        </div>
        <p>QR 연결 기능은 다음 단계에서 구현합니다.</p>
        <button type="button" disabled>연결 준비 중</button>
      </div>
    </aside>
  );
}

function ScoreCard() {
  return (
    <section className="card score-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">LIVE SCORE</span>
          <h3>현재 연주 점수</h3>
        </div>
        <span className="demo-badge">데모 데이터</span>
      </div>
      <div className="score-layout">
        <div className="score-gauge">
          <strong>74</strong>
          <span>/ 100</span>
        </div>
        <div className="metric-list">
          <div><span>타이밍</span><strong>81</strong></div>
          <div><span>음량 균형</span><strong>76</strong></div>
          <div><span>손가락 복귀</span><strong className="warning-text">62</strong></div>
        </div>
      </div>
    </section>
  );
}

function FeedbackCard() {
  return (
    <section className="card feedback-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">COACH FEEDBACK</span>
          <h3>지금 고칠 것</h3>
        </div>
        <span className="priority-badge">1순위</span>
      </div>
      <div className="feedback-main">
        <span className="feedback-number">01</span>
        <div>
          <h4>검지를 앞으로 멀리 보내지 마세요</h4>
          <p>P-I-P에서 검지가 줄을 튕긴 뒤 손바닥 쪽으로 바로 돌아오게 해보세요.</p>
        </div>
      </div>
      <div className="feedback-sub">
        <span>다음 안내</span>
        <strong>한 마디가 끝난 뒤 음성으로 안내</strong>
      </div>
    </section>
  );
}

function SheetPanel() {
  return (
    <section className="sheet-panel">
      <div className="sheet-toolbar">
        <div>
          <span className="eyebrow dark">SCORE FOLLOW</span>
          <h2>Photograph</h2>
          <p>Ed Sheeran · AI 초안 · 검증 중</p>
        </div>
        <div className="play-controls">
          <button type="button">◀</button>
          <button type="button" className="play-button">▶</button>
          <button type="button">▶|</button>
          <span>00:28 / 04:18</span>
        </div>
      </div>
      <div className="chord-strip">
        {[
          ['G', '320033'],
          ['Em', '022000'],
          ['C', 'x32010'],
          ['D', 'xx0232'],
        ].map(([name, fingering]) => (
          <div className="chord" key={name}>
            <strong>{name}</strong>
            <span>{fingering}</span>
            <div className="chord-grid">● ○ ● ○ ● ○</div>
          </div>
        ))}
      </div>
      <div className="measure current">
        <span className="measure-no">01</span>
        <div className="notation">
          <div className="chords">G　　　　　　　　　　 Em</div>
          <div className="rhythm">↓　↓↑　↑↓↑　　　↓　↓↑　↑↓↑</div>
          <div className="lyrics">Loving can hurt, loving can hurt sometimes</div>
          <pre>e|---3-----3-----0-----0---|</pre>
          <pre>B|-----3-----3-----0-----0-|</pre>
        </div>
        <span className="current-label">현재 마디</span>
      </div>
      <div className="measure">
        <span className="measure-no">02</span>
        <div className="notation">
          <div className="chords">C　　　　　　　　　　 D</div>
          <div className="rhythm">↓　↓↑　↑↓↑　　　↓　↓↑　↑↓↑</div>
          <div className="lyrics">But it's the only thing that I know</div>
        </div>
      </div>
      <div className="sheet-warning">
        재생 동기화와 자동 마디 이동은 아직 연결하지 않았습니다. 화면 확인용 데모입니다.
      </div>
    </section>
  );
}

function Timeline() {
  return (
    <section className="card timeline-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">SESSION TIMELINE</span>
          <h3>연습 타임라인</h3>
        </div>
        <button type="button" className="text-button">전체 기록</button>
      </div>
      <div className="timeline-list">
        {timeline.map((item) => (
          <div className="timeline-item" key={`${item.time}-${item.title}`}>
            <time>{item.time}</time>
            <span className={`timeline-dot ${item.type}`} />
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Dashboard() {
  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">PRACTICE SESSION</span>
          <h1>큰 화면 코칭</h1>
          <p>휴대폰은 촬영 장치, 이 화면은 악보와 피드백 확인용입니다.</p>
        </div>
        <div className="top-actions">
          <span className="prototype-pill">UI PROTOTYPE</span>
          <button type="button" disabled>연습 시작 대기</button>
        </div>
      </header>
      <div className="dashboard-grid">
        <div className="left-column">
          <SheetPanel />
        </div>
        <div className="right-column">
          <ScoreCard />
          <FeedbackCard />
          <Timeline />
        </div>
      </div>
    </>
  );
}

function GenericPage({ title }) {
  const panels = genericPanels[title] ?? [];
  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">GUITAR COACH AI</span>
          <h1>{title}</h1>
          <p>현재는 화면 구조를 확인하는 UI 초안입니다.</p>
        </div>
        <span className="prototype-pill">NOT CONNECTED</span>
      </header>
      <div className="generic-grid">
        {panels.map((panel, index) => (
          <section className="card feature-card" key={panel}>
            <span className="feature-index">{String(index + 1).padStart(2, '0')}</span>
            <h3>{panel}</h3>
            <p>기능 구현과 실제 장치 테스트 전에는 정상 작동으로 표시하지 않습니다.</p>
            <button type="button" disabled>준비 중</button>
          </section>
        ))}
      </div>
    </>
  );
}

export default function App() {
  const [active, setActive] = useState('홈');

  return (
    <div className="app-shell">
      <Sidebar active={active} onSelect={setActive} />
      <main className="main-content">
        {active === '홈' ? <Dashboard /> : <GenericPage title={active} />}
      </main>
    </div>
  );
}
