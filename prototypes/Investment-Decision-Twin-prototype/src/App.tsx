import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Bookmark, Bot, BrainCircuit, Check, ChevronDown, ChevronRight,
  CircleDot, Clock3, FileText, Globe2, LayoutGrid, LockKeyhole, MessageSquareText,
  MoreHorizontal, PanelLeftClose, Plus, RefreshCw, Send, ShieldCheck, SlidersHorizontal,
  Sparkles, TrendingUp, X, Zap,
} from 'lucide-react'
import {
  buildTwinProfile,
  createNvidiaDecision,
  detectValuationConflict,
  historicalDecisions,
  type DecisionRecord,
  type TwinProfile,
} from './investment/decisionTwin'

type Stage = 'idle' | 'researching' | 'results' | 'compare' | 'thesis' | 'complete'
type CandidateId = 'nvidia' | 'skhynix' | 'samsung'

type Candidate = {
  id: CandidateId
  name: string
  ticker: string
  country: string
  match: number
  price: string
  change: string
  pe: string
  debt: string
  growth: string
  signal: string
  accent: string
  reasons: string[]
  risk: string
}

const candidates: Candidate[] = [
  {
    id: 'nvidia', name: 'NVIDIA', ticker: 'NVDA', country: 'US', match: 91,
    price: '$233.95', change: '+1.34%', pe: '29.6x', debt: '12%', growth: '+65.5%',
    signal: 'AI 플랫폼', accent: '#76b900',
    reasons: ['GPU·CUDA 생태계 우위', '데이터센터 성장', '높은 현금창출력'],
    risk: '높은 AI 투자 기대가 가격에 반영',
  },
  {
    id: 'skhynix', name: 'SK하이닉스', ticker: '000660', country: 'KR', match: 88,
    price: '₩1,841,000', change: '+0.44%', pe: '8.1x', debt: '29%', growth: '+145%',
    signal: 'HBM 리더', accent: '#e62922',
    reasons: ['HBM 공급망 핵심', '2025 매출 46.8% 성장', 'AI 메모리 수요 수혜'],
    risk: '메모리 가격·설비투자 사이클',
  },
  {
    id: 'samsung', name: '삼성전자', ticker: '005930', country: 'KR', match: 82,
    price: '₩276,000', change: '0.00%', pe: '13.6x', debt: '8%', growth: '+23%',
    signal: '종합 반도체', accent: '#1976d2',
    reasons: ['메모리·파운드리 포트폴리오', '낮은 순부채', 'HBM 회복 가능성'],
    risk: '파운드리 수익성·HBM 점유율',
  },
]

const companyUniverse = {
  KR: [
    ['삼성전자','005930'],['SK하이닉스','000660'],['NAVER','035420'],['카카오','035720'],['LG에너지솔루션','373220'],
    ['삼성SDI','006400'],['삼성바이오로직스','207940'],['현대자동차','005380'],['기아','000270'],['셀트리온','068270'],
  ],
  US: [
    ['Apple','AAPL'],['Microsoft','MSFT'],['Alphabet','GOOGL'],['Amazon','AMZN'],['Meta','META'],
    ['NVIDIA','NVDA'],['Broadcom','AVGO'],['Oracle','ORCL'],['AMD','AMD'],['Tesla','TSLA'],
  ],
}

const comparisonMetrics = [
  { key: 'growth', label: '매출 성장률', help: '최근 보고기간 매출의 전년 동기 대비 변화', values: { nvidia: '+65.5%', skhynix: '+145%', samsung: '+23%' } },
  { key: 'pe', label: 'P/E (TTM)', help: '현재 주가를 최근 12개월 주당순이익으로 나눈 값', values: { nvidia: '29.6x', skhynix: '8.1x', samsung: '13.6x' } },
  { key: 'forwardPe', label: 'Forward P/E', help: '현재 주가를 향후 12개월 예상 주당순이익으로 나눈 값', values: { nvidia: '19.4x', skhynix: '4.5x', samsung: '4.5x' } },
  { key: 'debt', label: '부채비율', help: '자기자본 대비 부채 규모', values: { nvidia: '12%', skhynix: '29%', samsung: '8%' } },
  { key: 'fcf', label: '잉여현금흐름', help: '영업현금흐름에서 설비투자를 제외한 현금', values: { nvidia: '매우 높음', skhynix: '높음', samsung: '중간' } },
  { key: 'volatility', label: '1년 변동성', help: '최근 1년 주가 등락의 상대적 크기', values: { nvidia: '높음', skhynix: '매우 높음', samsung: '중간' } },
  { key: 'aiExposure', label: 'AI 매출 노출도', help: '전체 사업에서 AI 수요가 실적에 미치는 정도', values: { nvidia: '매우 높음', skhynix: '높음', samsung: '중간' } },
] as const

const activitySteps = [
  { label: '의도를 분석하고 조건 4개를 추출했습니다', meta: '성장성 · 저평가 · 낮은 부채 · 한국/미국' },
  { label: 'AI 반도체 관련 기업 28개를 탐색했습니다', meta: '기업 개요 · 사업 부문 · 공급망' },
  { label: '재무 조건과 밸류에이션을 교차 검증했습니다', meta: '11개 기업 제외' },
  { label: '최근 뉴스 184건과 공시 37건을 묶었습니다', meta: '중복 기사 63건 제거' },
  { label: '검토 후보 3개와 반대 근거를 구성했습니다', meta: '근거 추적 완료' },
]

const baselineTwinProfile = buildTwinProfile(historicalDecisions)
const baselineValuationConflict = detectValuationConflict(historicalDecisions, 29.6)

function TwinLens({ mode = 'profile', onOpen, profile = baselineTwinProfile }: { mode?: 'profile' | 'applied'; onOpen: () => void; profile?: TwinProfile }) {
  return <section className={`twin-lens ${mode}`}><div className="twin-lens-head"><div className="twin-lens-icon"><BrainCircuit size={19}/></div><div><span className="eyebrow">YOUR DECISION TWIN · SIMULATED HISTORY</span><h3>{mode === 'applied' ? '이번 탐색에 내 판단 모델이 적용됐습니다.' : '지금까지의 선택으로 만든 나의 투자 판단 모델'}</h3></div><div className="twin-confidence"><b>{profile.modelConfidence}%</b><small>MODEL CONFIDENCE</small></div></div><div className="twin-lens-body"><div className="twin-factor-list">{profile.factors.map((item) => <div key={item.id} title={`관찰 ${item.observationCount}회 · 근거 ${item.evidenceDecisionIds.join(', ')}`}><span>{item.label}</span><div><i style={{width:`${item.value}%`}}/></div><b>{item.value}</b></div>)}</div><div className="twin-insight"><span>{mode === 'applied' ? '이번 순위에 반영된 패턴' : '가장 강하게 관찰된 패턴'}</span><p>{mode === 'applied' ? '저평가와 재무 안정성을 먼저 적용하고, AI 기술 우위가 명확할 때만 가격 기준을 일부 완화했습니다.' : '7개의 모의 결정에서 저평가 기준이 가장 강했고, 재무 안정성이 확인되면 보유 기간을 길게 잡았습니다.'}</p><div><b>{profile.decisionCount}</b> 투자 결정 <b>{profile.candidateExclusionCount}</b> 후보 제외 <b>{profile.revisionCount}</b> 기준 수정</div></div></div><div className="twin-lens-foot"><span><ShieldCheck size={13}/> 데모용 모의 기록이며, 수치는 성과가 아닌 선택 영향도입니다.</span><button onClick={onOpen}>분석 근거 전체 보기 <ArrowRight size={14}/></button></div></section>
}

function Logo() {
  return <div className="logo-lockup"><span className="logo-mark"><CircleDot size={17}/></span><div><strong>thesis</strong><small>INVESTMENT BROWSER</small></div></div>
}

function Sidebar({ stage, onReset, onTwin }: { stage: Stage; onReset: () => void; onTwin: () => void }) {
  return (
    <aside className="sidebar">
      <div className="side-top"><Logo/><button className="collapse-button"><PanelLeftClose size={17}/></button></div>
      <button className="new-research" onClick={onReset}><Plus size={16}/> 새 투자 조사</button>
      <div className="side-section">
        <div className="side-label">조사 세션</div>
        <button className={stage !== 'idle' ? 'side-session active' : 'side-session'}><span className="session-glyph"><Sparkles size={15}/></span><span><b>AI 반도체 후보 탐색</b><small>방금 전</small></span><MoreHorizontal size={14}/></button>
        <button className="side-session muted"><span className="session-glyph"><TrendingUp size={15}/></span><span><b>현금흐름 좋은 배당주</b><small>어제</small></span></button>
        <button className="side-session muted"><span className="session-glyph"><Globe2 size={15}/></span><span><b>유럽 방산 공급망</b><small>10월 1일</small></span></button>
      </div>
      <div className="side-section utility-links">
        <button><Bookmark size={16}/> 저장한 후보 <span>7</span></button>
        <button><Clock3 size={16}/> 결정 기록</button>
        <button onClick={onTwin}><BrainCircuit size={16}/> Decision Twin <i>LIVE</i></button>
      </div>
      <div className="privacy-card"><LockKeyhole size={16}/><div><b>Private research</b><span>탐색 기록은 개인 모델 학습에만 사용됩니다.</span></div></div>
      <div className="account-row"><span>WH</span><div><b>Winter</b><small>Demo portfolio · ₩50M</small></div><ChevronDown size={14}/></div>
    </aside>
  )
}

function BrowserChrome({ activeTab, setActiveTab }: { activeTab: string; setActiveTab: (tab: string) => void }) {
  const tabs = ['Agent research', 'Sources · 221', 'Decision memory']
  return (
    <div className="browser-chrome">
      <div className="window-controls"><i/><i/><i/></div>
      <div className="browser-tabs">{tabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab === 'Agent research' && <Sparkles size={13}/>} {tab}<X size={11}/></button>)}<button className="tab-plus"><Plus size={14}/></button></div>
      <div className="address-row"><div className="browser-nav"><ArrowLeft size={15}/><ArrowRight size={15}/><RefreshCw size={14}/></div><div className="address-pill"><ShieldCheck size={13}/><span>thesis://research/ai-semiconductor</span><Sparkles size={13}/></div><button className="browser-more"><MoreHorizontal size={17}/></button></div>
    </div>
  )
}

function IdleView({ query, setQuery, onRun, onTwin }: { query: string; setQuery: (value: string) => void; onRun: () => void; onTwin: () => void }) {
  const examples = ['부채가 낮은 AI 반도체 기업 찾아줘','최근 급락했지만 투자 가설은 유지된 기업은?','내가 평소 외면하는 위험 요인만 보여줘']
  return (
    <section className="idle-view">
      <div className="idle-orbit"><Sparkles size={26}/><span/><span/></div>
      <div className="idle-kicker">YOUR INVESTMENT RESEARCH, WITH MEMORY</div>
      <h1>무엇을 찾고 있는지 말해주세요.<br/><em>판단의 기준</em>까지 함께 찾습니다.</h1>
      <p>여러 탭을 대신 탐색하고, 근거와 반대 근거를 비교합니다.<br/>당신의 수정과 선택은 다음 조사에 반영됩니다.</p>
      <div className="hero-prompt"><textarea value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onRun() } }}/><div className="prompt-tools"><button><SlidersHorizontal size={15}/> 조사 범위</button><button><Globe2 size={15}/> Web + 공시</button><button className="send-button" onClick={onRun}><ArrowRight size={18}/></button></div></div>
      <div className="prompt-examples">{examples.map((example) => <button key={example} onClick={() => setQuery(example)}>{example}<ChevronRight size={13}/></button>)}</div>
      <TwinLens onOpen={onTwin}/>
      <div className="idle-foot"><ShieldCheck size={14}/> 투자 추천이 아닌 의사결정 탐색 도구입니다 · 모든 주문은 사용자의 명시적 승인이 필요합니다.</div>
    </section>
  )
}

function ResearchView({ query, running, visibleSteps, selected, onToggle, onCompare, onTwin }: { query: string; running: boolean; visibleSteps: number; selected: CandidateId[]; onToggle: (id: CandidateId) => void; onCompare: () => void; onTwin: () => void }) {
  const completed = visibleSteps >= activitySteps.length
  return (
    <section className="research-view">
      <div className="research-heading"><div className="research-title"><span className={running ? 'agent-status running' : 'agent-status'}><Bot size={14}/>{running ? '에이전트 조사 중' : '조사 완료'}</span><h1>{query}</h1><p>{completed ? '28개 기업에서 조건에 맞는 후보 3개를 찾았습니다. 추천이 아니라 검토 우선순위입니다.' : '질문을 작업으로 나누고 신뢰할 수 있는 출처를 교차 확인하고 있습니다.'}</p></div><div className="research-actions"><button><Bookmark size={15}/> 저장</button><button><MoreHorizontal size={16}/></button></div></div>
      <div className="agent-trace"><div className="trace-head"><div><span className="pulse-dot"/> LIVE AGENT TRACE</div><span>{visibleSteps}/{activitySteps.length} STEPS</span></div><div className="trace-grid">{activitySteps.map((step, index) => <div key={step.label} className={`trace-step ${index < visibleSteps ? 'done' : index === visibleSteps ? 'current' : ''}`}><span className="trace-icon">{index < visibleSteps ? <Check size={13}/> : index === visibleSteps ? <RefreshCw size={13}/> : index + 1}</span><div><b>{step.label}</b><small>{step.meta}</small></div></div>)}</div></div>
      {completed ? <><div className="universe-panel"><div><span className="eyebrow">REAL COMPANY UNIVERSE · 20</span><b>국내외 상장 기업을 실제 종목으로 구성했습니다.</b><small>가격·P/E 기준일 2026.10.02 · 지연 데이터 · 나머지 신호는 프로토타입용 분석값</small></div><div className="universe-groups">{Object.entries(companyUniverse).map(([market,items]) => <div key={market}><span>{market === 'KR' ? '국내 10' : '해외 10'}</span><div>{items.map(([name,ticker]) => <i key={ticker}>{name}<small>{ticker}</small></i>)}</div></div>)}</div></div><TwinLens mode="applied" onOpen={onTwin}/><div className="result-title"><div><span className="eyebrow">SHORTLIST · RANKED BY YOUR TWIN</span><h2>내 판단 기준으로 먼저 검토할 기업</h2></div><span>마지막 업데이트 · 방금 전</span></div><div className="candidate-grid">{candidates.map((candidate, index) => <article className={`candidate-card ${selected.includes(candidate.id) ? 'selected' : ''}`} key={candidate.id}><div className="candidate-rank">0{index + 1}</div><div className="candidate-head"><div className="company-avatar" style={{background:candidate.accent}}>{candidate.name.slice(0,1)}</div><div><h3>{candidate.name}</h3><span>{candidate.ticker} · {candidate.country}</span></div><div className="match-score"><b>{candidate.match}</b><small>TWIN FIT</small></div></div><div className="price-row"><strong>{candidate.price}</strong><span>{candidate.change}</span><i>{candidate.signal}</i></div><div className="twin-fit-reason"><BrainCircuit size={13}/><span>{candidate.id === 'nvidia' ? '기술 우위 예외 규칙과 일치' : candidate.id === 'skhynix' ? '저평가·성장성 기준 모두 충족' : '재무 안정성 기준 최상위'}</span></div><div className="metric-row"><span><small>P/E (TTM)</small><b>{candidate.pe}</b></span><span><small>부채비율</small><b>{candidate.debt}</b></span><span><small>매출 성장</small><b>{candidate.growth}</b></span></div><div className="reason-list">{candidate.reasons.map((reason) => <span key={reason}><Check size={12}/>{reason}</span>)}</div><div className="risk-line"><Zap size={13}/><span>반대 근거</span><b>{candidate.risk}</b></div><button className="compare-toggle" onClick={() => onToggle(candidate.id)}>{selected.includes(candidate.id) ? <><Check size={15}/> 비교함에 추가됨</> : <><Plus size={15}/> 비교함에 추가</>}</button></article>)}</div><div className="floating-compare"><div><LayoutGrid size={17}/><span><b>{selected.length}개 기업 선택</b><small>같은 기준으로 근거와 위험을 비교합니다.</small></span></div><button disabled={selected.length < 2} onClick={onCompare}>비교 보드 열기 <ArrowRight size={15}/></button></div></> : <div className="research-skeleton"><div/><div/><div/></div>}
    </section>
  )
}

function CompareView({ selected, onBack, onThesis }: { selected: CandidateId[]; onBack: () => void; onThesis: () => void }) {
  const displayed = candidates.filter((candidate) => selected.includes(candidate.id))
  const [metricEditor,setMetricEditor] = useState(false)
  const [selectedMetrics,setSelectedMetrics] = useState<string[]>(['growth','pe','debt','aiExposure'])
  const visibleMetrics = comparisonMetrics.filter((metric) => selectedMetrics.includes(metric.key))
  const toggleMetric = (key: string) => setSelectedMetrics((current) => current.includes(key) ? current.length > 2 ? current.filter((item) => item !== key) : current : [...current,key])
  return (
    <section className="compare-view"><button className="inline-back" onClick={onBack}><ArrowLeft size={15}/> 조사 결과로</button><div className="compare-heading"><div><span className="eyebrow">DYNAMIC COMPARISON BOARD</span><h1>내가 중요하게 보는 기준으로 비교합니다.</h1><p>정답표가 아니라, 이번 판단에서 보고 싶은 지표를 직접 고릅니다.</p></div><button className="rule-chip" onClick={() => setMetricEditor((open) => !open)}><SlidersHorizontal size={15}/> 비교 기준 편집 · {selectedMetrics.length}</button></div>{metricEditor && <div className="metric-editor"><div><b>비교 기준을 선택하세요</b><span>최소 2개 · 선택은 다음 조사에서 개인 기준으로 제안됩니다.</span></div><div>{comparisonMetrics.map((metric) => <button className={selectedMetrics.includes(metric.key) ? 'active' : ''} onClick={() => toggleMetric(metric.key)} key={metric.key}><span>{selectedMetrics.includes(metric.key) && <Check size={12}/>}</span><b>{metric.label}</b><small>{metric.help}</small></button>)}</div><aside><b>Forward P/E란?</b><span>현재 주가 ÷ 향후 12개월 예상 주당순이익입니다. 미래 이익 추정치라 기관마다 값이 다르므로, 실제 확정 실적을 쓰는 P/E(TTM)와 함께 봐야 합니다.</span></aside></div>}<div className="comparison-table"><div className="comparison-header"><div>판단 기준</div>{displayed.map((item) => <div key={item.id}><span className="mini-avatar" style={{background:item.accent}}>{item.name[0]}</span><b>{item.name}</b><small>{item.match}% match</small></div>)}</div>{visibleMetrics.map((metric) => <div className="comparison-row" key={metric.key}><div><b>{metric.label}</b><small>{metric.help}</small></div>{displayed.map((item) => <div key={`${metric.key}-${item.id}`}><b>{metric.values[item.id]}</b></div>)}</div>)}<div className="comparison-row"><div><b>핵심 위험</b><small>가설이 틀릴 수 있는 가장 큰 요인</small></div>{displayed.map((item) => <div key={`risk-${item.id}`}><b>{item.risk}</b></div>)}</div></div><div className="agent-observation"><Sparkles size={20}/><div><span>AGENT OBSERVATION</span><p><b>NVIDIA는 AI 노출도와 성장성이 높지만</b>, SK하이닉스는 P/E 기준 가격 부담이 낮습니다. 어느 쪽이 더 낫다는 결론보다 사용자가 고른 기준의 충돌을 보여줍니다.</p></div></div><div className="compare-footer"><p><FileText size={16}/> 비교 수치에는 기준일과 출처가 붙고, 예상치는 별도로 표시됩니다.</p><button onClick={onThesis}>NVIDIA 투자 가설 만들기 <ArrowRight size={16}/></button></div></section>
  )
}

function ThesisView({ onBack, onComplete }: { onBack: () => void; onComplete: (decision: DecisionRecord) => void }) {
  const [confidence,setConfidence] = useState(72)
  const [horizon,setHorizon] = useState('12개월')
  const [invalidation,setInvalidation] = useState('AI 반도체 매출 성장률이 20% 아래로 하락')
  const [gateOpen,setGateOpen] = useState(false)
  const [rule,setRule] = useState('기술 우위가 가격 부담보다 중요하다')
  return (
    <section className="thesis-view"><button className="inline-back" onClick={onBack}><ArrowLeft size={15}/> 비교 보드로</button><div className="thesis-heading"><div><span className="eyebrow">DECISION WORKSPACE</span><h1>NVIDIA 투자 가설</h1><p>에이전트가 조사 경로와 선택한 근거를 초안으로 만들었습니다. 최종 판단은 사용자가 편집합니다.</p></div><div className="company-pill"><span style={{background:'#76b900'}}>N</span><div><b>NVIDIA</b><small>NVDA · $233.95</small></div></div></div><div className="thesis-layout"><div className="thesis-document"><div className="doc-top"><span><FileText size={15}/> INVESTMENT THESIS · DRAFT</span><button><Sparkles size={14}/> AI로 다듬기</button></div><h2>AI 플랫폼 우위가 현재의 가격 부담을 정당화할 수 있다.</h2><div className="thesis-block"><label>핵심 근거</label><div className="evidence-card positive"><Check size={15}/><div><b>데이터센터 중심의 높은 매출 성장</b><span>최근 실적 발표 · 원문 추적 가능</span></div></div><div className="evidence-card positive"><Check size={15}/><div><b>GPU 하드웨어와 CUDA 소프트웨어 생태계</b><span>10-K · Product documentation</span></div></div><button className="add-evidence"><Plus size={14}/> 근거 추가</button></div><div className="thesis-block"><label>반대 근거</label><div className="evidence-card negative"><Zap size={15}/><div><b>P/E(TTM) 29.4배에 성장 기대가 반영</b><span>AI 투자 둔화 시 멀티플 축소 위험</span></div></div></div><label className="invalidation-field"><span>내 투자 가설이 틀렸다고 인정할 조건</span><input value={invalidation} onChange={(event) => setInvalidation(event.target.value)}/><small>이 조건이 실제 데이터에서 충족되면 ‘주의’가 아니라 재검토 요청을 보냅니다.</small></label></div><aside className="order-panel"><div className="order-title"><span>PAPER ORDER</span><ShieldCheck size={16}/></div><div className="order-price"><small>예상 체결가</small><strong>$233.95</strong><span>DELAYED</span></div><label><span>투자 금액</span><div className="money-input"><input defaultValue="3,000,000"/><b>KRW</b></div></label><label><span>투자 기간</span><div className="select-like">{horizon}<ChevronDown size={14}/></div></label><div className="horizon-options">{['3개월','6개월','12개월'].map((item) => <button className={horizon === item ? 'active' : ''} onClick={() => setHorizon(item)} key={item}>{item}</button>)}</div><label><span>현재 확신도 <b>{confidence}%</b></span><input type="range" min="30" max="95" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))}/></label><div className="order-summary"><span>포트폴리오 비중 <b>6.0%</b></span><span>예상 수수료 <b>₩2,400</b></span><span>주문 방식 <b>모의 시장가</b></span></div><button className="order-button" onClick={() => setGateOpen(true)}>Decision Gate 검토 <ArrowRight size={16}/></button><p className="paper-note"><ShieldCheck size={13}/> 실제 자금이 사용되지 않는 시뮬레이션입니다.</p></aside></div>
      {gateOpen && <div className="modal-backdrop"><div className="gate-modal"><button className="modal-close" onClick={() => setGateOpen(false)}><X size={18}/></button><div className="gate-icon"><BrainCircuit size={25}/></div><span className="eyebrow">DECISION GATE · PATTERN CONFLICT</span><h2>이번 선택은 평소의<br/>투자 행동과 다릅니다.</h2><p>7개의 모의 결정에서 적용한 P/E 허용 상한은 {baselineValuationConflict.threshold}배였습니다. 이번에는 P/E(TTM) {baselineValuationConflict.actual}배인 NVIDIA를 매수하려 합니다.</p><div className="conflict-viz"><div><small>과거 허용 상한</small><b>{baselineValuationConflict.threshold.toFixed(1)}x</b></div><ArrowRight size={18}/><div className="conflict-now"><small>이번 선택</small><b>{baselineValuationConflict.actual.toFixed(1)}x</b></div></div><small className="conflict-evidence">근거 결정 {baselineValuationConflict.evidenceDecisionIds.length}건 · 모두 데모용 모의 기록</small><label>이번에는 무엇이 달랐나요?</label><div className="rule-options">{['기술 우위가 가격 부담보다 중요하다','장기 성장률이 밸류에이션을 정당화한다','최근 가격 상승에 영향을 받았다','아직 판단하지 못했다'].map((item) => <button className={rule === item ? 'active' : ''} onClick={() => setRule(item)} key={item}><span>{rule === item && <Check size={13}/>}</span>{item}</button>)}</div><div className="gate-actions"><button onClick={() => setGateOpen(false)}>다시 검토</button><button onClick={() => onComplete(createNvidiaDecision(rule, { confidence, horizon, invalidationRule: invalidation }))}>새 규칙을 저장하고 모의 주문 <ArrowRight size={15}/></button></div></div></div>}
    </section>
  )
}

function CompleteView({ decision, before, after, onTwin }: { decision: DecisionRecord; before: TwinProfile; after: TwinProfile; onTwin: () => void }) {
  const [eventOpen,setEventOpen] = useState(false)
  return (
    <section className="complete-view"><div className="complete-check"><Check size={29}/></div><span className="eyebrow">DECISION RECORDED · PAPER ORDER FILLED</span><h1>하나의 주문이 아니라,<br/>하나의 <em>판단</em>이 기록됐습니다.</h1><p>NVIDIA 모의 주문과 당시의 정보·근거·반대 근거·예외 판단을 하나의 결정 스냅샷으로 저장했습니다.</p><div className="receipt-card"><div className="receipt-company"><span>N</span><div><b>NVIDIA</b><small>NVDA · BUY · PAPER</small></div><strong>₩3,000,000</strong></div><div className="receipt-grid"><span><small>확신도</small><b>{decision.confidence}%</b></span><span><small>투자 기간</small><b>{decision.horizon}</b></span><span><small>정보 스냅샷</small><b>221 sources</b></span><span><small>가설 감시 규칙</small><b>1 active</b></span></div></div><div className="learned-rule"><BrainCircuit size={21}/><div><span>DECISION TWIN의 신규 후보 규칙 · 신뢰도 43%</span><p>“{decision.rationale}”</p><small>한 번의 예외는 성향을 확정하지 않습니다. 다음 조사부터 약하게 반영하고, 같은 선택이 반복될 때만 신뢰도를 높입니다.</small></div></div><div className="twin-delta">{after.factors.map((item) => { const previous = before.factors.find((factor) => factor.id === item.id)?.value ?? item.value; const delta = item.value - previous; return <div key={item.id}><span>{item.label}</span><b>{previous} <ArrowRight size={13}/> {item.value}</b><small className={delta > 0 ? 'up' : delta < 0 ? 'down' : ''}>{delta > 0 ? '+' : ''}{delta}</small></div> })}</div><div className="complete-actions"><button onClick={onTwin}><BrainCircuit size={16}/> Decision Twin 전체 보기</button><button onClick={() => setEventOpen(true)}>투자 후 가설 모니터링 보기 <ArrowRight size={16}/></button></div>{eventOpen && <div className="modal-backdrop"><div className="event-modal" role="dialog" aria-modal="true" aria-label="투자 가설 점검 알림"><button className="modal-close" onClick={() => setEventOpen(false)} aria-label="닫기"><X size={18}/></button><span className="event-date">THESIS MONITOR · RULE TRIGGERED</span><div className="event-icon"><Zap size={22}/></div><h2>투자 당시 정한 기준이<br/>실제 데이터에서 깨졌습니다.</h2><p>사용자가 저장한 규칙은 <b>“{decision.invalidationRule}”</b>였습니다. 새 분기 실적에서 성장률이 18%로 확인되어 재검토가 필요합니다.</p><div className="event-progress"><div><span>최신 분기 성장률</span><b>18%</b></div><div className="event-track triggered"><i/></div><small>사용자가 정한 재검토 기준 · 20% 미만</small></div><div className="why-alert"><b>왜 지금 알렸나요?</b><span>투자 당시 저장한 조건</span><ArrowRight size={13}/><span>새 실적 데이터 18%</span><ArrowRight size={13}/><strong>조건 충족</strong></div><div className="event-evidence"><span><FileText size={14}/> 변경 근거 3건</span><span>분기 실적 · 회사 가이던스 · 컨퍼런스콜</span></div><div className="event-actions"><button onClick={() => setEventOpen(false)}>나중에 검토</button><button onClick={() => setEventOpen(false)}>가설 재검토 시작 <ArrowRight size={15}/></button></div></div></div>}</section>
  )
}

function TwinDrawer({ open, onClose, profile, baseline }: { open: boolean; onClose: () => void; profile: TwinProfile; baseline: TwinProfile }) {
  return <div className={`drawer-backdrop ${open ? 'open' : ''}`} onClick={onClose}><aside className="twin-drawer" onClick={(event) => event.stopPropagation()}><button className="drawer-close" onClick={onClose}><X size={18}/></button><div className="drawer-icon"><BrainCircuit size={22}/></div><span className="eyebrow">YOUR DECISION TWIN · SIMULATED HISTORY</span><h2>말보다 선택으로<br/>학습한 투자 기준</h2><p>{profile.decisionCount}개의 모의 결정에서 선택·제외·수정 행동을 집계했습니다. 수치는 수익률이 아니라 각 기준이 선택에 미친 영향입니다.</p><div className="twin-bars">{profile.factors.map((item) => { const previous = baseline.factors.find((factor) => factor.id === item.id)?.value ?? item.value; const delta = item.value - previous; return <div className="twin-bar" key={item.id}><div><span>{item.label}<small>관찰 {item.observationCount}회</small></span><b>{item.value}{delta !== 0 && <em className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? '+' : ''}{delta}</em>}</b></div><div className="bar-track"><i style={{width:`${item.value}%`}}/></div><small className="factor-evidence" title={item.evidenceDecisionIds.join(', ')}>영향이 컸던 결정 {item.evidenceDecisionIds.length}건 · 근거 보기</small></div> })}</div><div className="rule-stack"><span className="eyebrow">DISCOVERED RULES</span>{profile.rules.map((rule, index) => <article className={rule.status === 'candidate' ? 'new-rule' : ''} key={rule.id}><b>{rule.status === 'candidate' ? 'NEW' : String(index + 1).padStart(2, '0')}</b><p>{rule.text}</p><em>신뢰도 {rule.confidence}% · 근거 결정 {rule.evidenceDecisionIds.length}건{rule.status === 'candidate' ? ' · 더 많은 관찰 필요' : ''}</em></article>)}</div><div className="drawer-note"><ShieldCheck size={15}/> 각 수치와 규칙은 해당 모의 결정 ID로 역추적할 수 있습니다.</div></aside></div>
}

function App() {
  const [stage,setStage] = useState<Stage>('idle')
  const [query,setQuery] = useState('AI 반도체 성장성은 믿지만 이미 너무 오른 종목은 싫어. 한국과 미국에서 부채가 낮고 상대적으로 저평가된 후보를 찾아줘.')
  const [visibleSteps,setVisibleSteps] = useState(0)
  const [selected,setSelected] = useState<CandidateId[]>(['nvidia','skhynix'])
  const [activeTab,setActiveTab] = useState('Agent research')
  const [twinOpen,setTwinOpen] = useState(false)
  const [completedDecision,setCompletedDecision] = useState<DecisionRecord | null>(null)
  const currentTwinProfile = useMemo(() => buildTwinProfile(completedDecision ? [...historicalDecisions, completedDecision] : historicalDecisions), [completedDecision])
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(window.clearTimeout),[])
  const runResearch = () => { timers.current.forEach(window.clearTimeout); timers.current=[]; setVisibleSteps(0); setStage('researching'); activitySteps.forEach((_,index) => { const timer=window.setTimeout(() => { setVisibleSteps(index+1); if(index === activitySteps.length-1) setStage('results') },650*(index+1)); timers.current.push(timer) }) }
  const reset = () => { timers.current.forEach(window.clearTimeout); setStage('idle'); setVisibleSteps(0); setSelected(['nvidia','skhynix']); setCompletedDecision(null) }
  const toggleSelected = (id: CandidateId) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current,id])
  return <main className="app-shell"><Sidebar stage={stage} onReset={reset} onTwin={() => setTwinOpen(true)}/><section className="browser-shell"><BrowserChrome activeTab={activeTab} setActiveTab={setActiveTab}/><div className="browser-content">{stage === 'idle' && <IdleView query={query} setQuery={setQuery} onRun={runResearch} onTwin={() => setTwinOpen(true)}/>} {(stage === 'researching' || stage === 'results') && <ResearchView query={query} running={stage === 'researching'} visibleSteps={visibleSteps} selected={selected} onToggle={toggleSelected} onCompare={() => setStage('compare')} onTwin={() => setTwinOpen(true)}/>} {stage === 'compare' && <CompareView selected={selected} onBack={() => setStage('results')} onThesis={() => setStage('thesis')}/>} {stage === 'thesis' && <ThesisView onBack={() => setStage('compare')} onComplete={(decision) => { setCompletedDecision(decision); setStage('complete') }}/>} {stage === 'complete' && completedDecision && <CompleteView decision={completedDecision} before={baselineTwinProfile} after={currentTwinProfile} onTwin={() => setTwinOpen(true)}/>}</div>{stage !== 'idle' && stage !== 'complete' && <div className="bottom-command"><MessageSquareText size={16}/><input placeholder="에이전트에게 현재 조사에 대해 지시하세요..."/><button><Send size={15}/></button></div>}</section><TwinDrawer open={twinOpen} onClose={() => setTwinOpen(false)} profile={currentTwinProfile} baseline={baselineTwinProfile}/></main>
}

export default App
