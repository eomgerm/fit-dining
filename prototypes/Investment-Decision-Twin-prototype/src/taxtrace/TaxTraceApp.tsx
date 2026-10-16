import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, BadgeCheck, BarChart3, BookOpen, Building2, Check,
  ChevronDown, CircleHelp, Database, ExternalLink, FileSearch, Fingerprint,
  Home, Landmark, Link2, MapPin, Menu, ReceiptText, Search, ShieldCheck,
  Sparkles, TrendingUp, UserRound, WalletCards, X,
} from 'lucide-react'
import { allocateReceipt, calculateProjectAttribution, getStageInterpretation, traceStages, type Evidence, type EvidenceState } from './domain'
import { fiscalSnapshot } from './fiscalData'
import { resetPrototypeScroll } from '../prototypeRoute'
import './taxtrace.css'

type Phase = 'input' | 'receipt' | 'trace'

const money = new Intl.NumberFormat('ko-KR')
const stateLabel: Record<EvidenceState, string> = {
  official: '공식 출처 연결',
  reviewed: '검토 흐름 예시',
  'ai-suggested': 'AI 연결 예시',
  uncertain: '확인 필요',
}

type UserProfile = { taxPaid: number }

function Mark() {
  return <div className="tt-mark"><span><ReceiptText size={19}/></span><div><b>TaxTrace</b><small>국민 영수증</small></div></div>
}

function StepRail({ phase }: { phase: Phase }) {
  const active = phase === 'input' ? 1 : phase === 'receipt' ? 2 : 3
  return <div className="tt-step-rail">
    {['내 조건 입력', '세금 영수증', '정책까지 추적'].map((label, index) => <div className={active >= index + 1 ? 'active' : ''} key={label}>
      <i>{active > index + 1 ? <Check size={12}/> : index + 1}</i><span>{label}</span>
    </div>)}
  </div>
}

function TaxInput({ initialProfile, onGenerate }: { initialProfile: UserProfile; onGenerate: (profile: UserProfile) => void }) {
  const [taxPaid, setTaxPaid] = useState(String(initialProfile.taxPaid))
  const parsedTax = Number(taxPaid)
  const validTax = Number.isFinite(parsedTax) && parsedTax >= 0 && parsedTax <= 1_000_000_000
  return <section className="tt-input-page">
    <div className="tt-hero-copy">
      <span className="tt-kicker"><Fingerprint size={14}/> MONEY, MADE TRACEABLE</span>
      <h1>내가 낸 세금은<br/><em>어떤 약속</em>으로 흘러갔을까?</h1>
      <p>막연한 총액 대신 내 몫의 영수증부터 시작해,<br/>예산·집행·결과를 하나의 증거선으로 이어봅니다.</p>
      <div className="tt-trust-line"><span><Database size={15}/> 열린재정 2024 결산</span><span><ShieldCheck size={15}/> 공식 원문 연결</span><span><FileSearch size={15}/> 계산식 공개</span></div>
    </div>
    <div className="tt-input-card">
      <div className="tt-card-number">01</div><span className="tt-overline">START WITH YOUR RECEIPT</span>
      <h2>결정세액 하나로<br/>내 세금 영수증을 만듭니다.</h2>
      <label><span>2024년 소득세 결정세액</span><div className="tt-money-input"><input aria-label="2024년 소득세 결정세액" type="number" min="0" max="1000000000" value={taxPaid} onChange={(event) => setTaxPaid(event.target.value)}/><b>원</b></div><small>{validTax ? `현재 입력 · ${money.format(parsedTax)}원` : '0원 이상 10억원 이하로 입력해 주세요.'}</small></label>
      <button className="tt-primary" disabled={!validTax} onClick={() => onGenerate({ taxPaid: parsedTax })}>2024 결산으로 추적하기 <ArrowRight size={17}/></button>
      <p className="tt-form-note"><CircleHelp size={14}/> 원천징수영수증의 결정세액을 입력하세요. 문서 자체는 업로드하거나 저장하지 않습니다.</p>
    </div>
    <div className="tt-preview-receipt" aria-hidden="true"><span>2024 PUBLIC RECEIPT</span><b>₩1,200,000</b><div/><div/><div/><small>사회복지 · 행정 · 교육 · 국방</small></div>
  </section>
}

function ReceiptView({ taxPaid, onTrace, onReset }: { taxPaid: number; onTrace: () => void; onReset: () => void }) {
  const allocations = useMemo(() => allocateReceipt(taxPaid), [taxPaid])
  const welfare = allocations.find((item) => item.id === 'social-welfare')!
  const projectAttribution = calculateProjectAttribution(taxPaid)
  return <section className="tt-receipt-page">
    <button className="tt-back" onClick={onReset}><ArrowLeft size={15}/> 조건 다시 입력</button>
    <div className="tt-page-heading"><div><span className="tt-overline">2024 PUBLIC RECEIPT · OFFICIAL DATA</span><h1>내 결정세액<br/>공공 지출 영수증</h1><p>2024년 중앙정부 분야별 실제 집행 비중을 결정세액에 적용했습니다. 개인 세금의 실제 계좌 이동이 아닌 <b>비례 귀속 추정</b>입니다.</p></div><div className="tt-total"><small>입력한 소득세 결정세액</small><strong>₩{money.format(taxPaid)}</strong><span>사용자 입력 · 세액 추정 아님</span></div></div>
    <div className="tt-allocation-strip">{allocations.map((item) => <i key={item.id} style={{ width: `${item.share}%`, background: item.color }} title={`${item.label} ${item.share}%`}/>)}</div>
    <div className="tt-receipt-layout">
      <div className="tt-category-list">
        <div className="tt-list-head"><span>분야별 추정 영수증</span><small>비중이 큰 순서 · 합계 100%</small></div>
        {allocations.map((item, index) => <button className={item.id === 'social-welfare' ? 'focus' : ''} key={item.id} onClick={item.id === 'social-welfare' ? onTrace : undefined}>
          <span className="tt-cat-rank">{String(index + 1).padStart(2, '0')}</span><i style={{ background: item.color }}/><div><b>{item.label}</b><small>{item.description}</small></div><span className="tt-cat-share">{item.share.toFixed(2)}%</span><strong>₩{money.format(item.amount)}</strong>{item.id === 'social-welfare' && <em>주택 사업 추적 <ArrowRight size={13}/></em>}
        </button>)}
      </div>
      <aside className="tt-feature-card"><div className="tt-feature-icon"><Home size={24}/></div><span className="tt-overline">REAL DATA TRACE</span><h2>사회복지 귀속 추정액<br/><b>₩{money.format(welfare.amount)}</b></h2><p>그 안의 ‘주택’ 부문에 속한 청년월세 사업까지 같은 2024년 결산 기준으로 좁혀봅니다.</p><div className="tt-mini-flow"><span>전체</span><i/><span>사회복지</span><i/><span>주택</span><i/><span>청년월세</span></div><button className="tt-primary" onClick={onTrace}>약 {money.format(projectAttribution)}원의 근거 추적 <ArrowRight size={17}/></button><small><Database size={13}/> 열린재정 분야별 집행 및 사업별 결산 원자료를 사용했습니다.</small></aside>
    </div>
  </section>
}

function EvidenceDrawer({ evidence, onClose }: { evidence: Evidence | null; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!evidence) return
    previousFocus.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !drawerRef.current) return
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus.current?.focus() }
  }, [evidence, onClose])
  if (!evidence) return null
  const external = evidence.url.startsWith('http')
  return <div className="tt-drawer-layer open" onClick={onClose}>
    <aside ref={drawerRef} className="tt-evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="tt-evidence-title" onClick={(event) => event.stopPropagation()}>
      <button ref={closeRef} className="tt-drawer-close" aria-label="근거 상세 닫기" onClick={onClose}><X size={18}/></button>
      <div className="tt-label-row"><span className={`tt-state ${evidence.state}`}>{stateLabel[evidence.state]}</span><span className="tt-demo-tag">2024 근거</span></div><h2 id="tt-evidence-title">{evidence.title}</h2><div className="tt-source-meta"><span><Building2 size={14}/>{evidence.source}</span><span>{evidence.date}</span></div><div className="tt-excerpt"><small>근거 요약</small>{evidence.excerpt}</div><div className="tt-drawer-explain"><b>이 증거를 어떻게 읽어야 하나요?</b><p>{evidence.state === 'official' ? '기관이 공개한 원자료 또는 공식 문서에서 확인한 값입니다. 링크를 열어 원문까지 역추적할 수 있습니다.' : evidence.state === 'ai-suggested' ? 'AI가 문장의 의미 유사성을 바탕으로 제안한 연결이며 공식 사실과 분리됩니다.' : evidence.state === 'uncertain' ? '필요한 원자료가 공개되지 않았거나 중앙·지방 집행의 범위가 달라 결론을 보류합니다.' : '공식 자료 사이의 범위와 의미를 사람이 검토해 붙인 설명입니다.'}</p></div>{external ? <a href={evidence.url} target="_blank" rel="noreferrer">원본 자료 열기 <ExternalLink size={15}/></a> : <button className="tt-source-disabled" disabled>연결된 원본 없음</button>}<div className="tt-drawer-foot"><ShieldCheck size={15}/> 수집일 {fiscalSnapshot.collectedAt} · 금액 단위와 기준연도를 함께 보관합니다.</div>
    </aside>
  </div>
}

function TraceView({ taxPaid, onBack }: { taxPaid: number; onBack: () => void }) {
  const [active, setActive] = useState(2)
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const welfare = allocateReceipt(taxPaid).find((item) => item.id === 'social-welfare')!
  const projectAttribution = calculateProjectAttribution(taxPaid)
  const stage = traceStages[active]
  return <section className="tt-trace-page">
    <div className="tt-trace-top"><button className="tt-back" onClick={onBack}><ArrowLeft size={15}/> 영수증으로</button><div className="tt-trace-title"><span className="tt-overline">PUBLIC MONEY TRACE · 2024 ACCOUNTS</span><h1>사회복지 <em>₩{money.format(welfare.amount)}</em> 중<br/>청년월세 사업 귀속액은 약 ₩{money.format(projectAttribution)}</h1><p>사업 집행액 ÷ 2024년 중앙정부 총집행액을 결정세액에 곱한 비례 추정입니다.</p></div><div className="tt-trace-badge"><MapPin size={17}/><span>전국 · 중앙정부</span><b>2024 결산</b></div></div>
    <div className="tt-trace-summary"><div><WalletCards size={20}/><span>내 세금 중 사회복지</span><b>₩{money.format(welfare.amount)}</b><small>{welfare.share.toFixed(2)}% 비례 추정</small></div><div><Link2 size={20}/><span>청년월세 귀속 추정</span><b>₩{money.format(projectAttribution)}</b><small>총집행액 대비 0.012526%</small></div><div><BookOpen size={20}/><span>사업 집행액</span><b>798.63억</b><small>중앙정부 집행 기준</small></div><div><TrendingUp size={20}/><span>데이터 기준</span><b>2024</b><small>수집 {fiscalSnapshot.collectedAt}</small></div></div>
    <div className="tt-trace-workspace">
      <nav className="tt-stage-nav">{traceStages.map((item, index) => <button className={active === index ? 'active' : ''} key={item.id} onClick={() => setActive(index)}><span>{item.step}</span><div><small>{item.title}</small><b className={item.statusTone}>{item.status}</b></div><i>{index < traceStages.length - 1 && <ArrowRight size={14}/>}</i></button>)}</nav>
      <article className="tt-stage-detail">
        <div className="tt-stage-head"><div><span className="tt-overline">STAGE {stage.step} · {stage.id.toUpperCase()}</span><h2>{stage.title}</h2><p>{stage.summary}</p></div><div className={`tt-stage-metric ${stage.statusTone}`}><strong>{stage.metric}</strong><small>{stage.metricLabel}</small></div></div>
        <div className="tt-logic-line"><span><Sparkles size={14}/> TaxTrace 해석</span><p>{getStageInterpretation(stage.id)}</p></div>
        <div className="tt-evidence-header"><div><b>근거와 반대 근거</b><span>카드를 열어 원문·검토 상태를 확인하세요.</span></div><button><Search size={14}/> 근거 안에서 검색</button></div>
        <div className="tt-evidence-grid">{stage.evidence.map((item) => <button className={item.counter ? 'counter' : ''} key={item.id} onClick={() => setEvidence(item)}><div><span className={`tt-state ${item.state}`}>{stateLabel[item.state]}</span><span className="tt-demo-tag">실제 근거</span><small>{item.date}</small></div><h3>{item.title}</h3><p>{item.excerpt}</p><footer><span>{item.source}</span><ArrowRight size={15}/></footer></button>)}</div>
        {stage.id === 'outcome' && <div className="tt-honesty-card"><CircleHelp size={20}/><div><b>왜 ‘판단 보류’인가요?</b><p>지원 가구가 늘었다는 산출(output)과 실제 주거비 부담이 낮아졌다는 결과(outcome)는 다릅니다. 후자의 최신 공시가 없으므로 성공·실패로 단정하지 않습니다.</p></div></div>}
      </article>
      <aside className="tt-method-panel"><span className="tt-overline">HOW TO READ</span><h3>하나의 점수 대신<br/>네 질문을 분리합니다.</h3>{traceStages.map((item, index) => <button className={active === index ? 'active' : ''} onClick={() => setActive(index)} key={item.id}><i>{index + 1}</i><span>{item.title}</span><b>{item.status}</b></button>)}<div className="tt-method-note"><BadgeCheck size={17}/><p><b>정치적 판정은 AI가 하지 않습니다.</b><br/>AI는 연결을 제안하고, 결론의 근거와 반대 근거를 함께 보여줍니다.</p></div></aside>
    </div>
    <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(null)}/>
  </section>
}

export default function TaxTraceApp() {
  const [phase, setPhase] = useState<Phase>('input')
  const [profile, setProfile] = useState<UserProfile>({ taxPaid: 1_200_000 })
  useEffect(() => {
    const container = document.querySelector<HTMLElement>('.taxtrace')
    if (container) resetPrototypeScroll(container)
  }, [phase])
  return <main className="taxtrace">
    <header className="tt-header"><Mark/><nav><button className={phase !== 'trace' ? 'active' : ''} onClick={() => setPhase(phase === 'input' ? 'input' : 'receipt')}>내 영수증</button><button className={phase === 'trace' ? 'active' : ''} onClick={() => setPhase('trace')}>데이터 출처</button><button className={phase === 'trace' ? 'active' : ''} onClick={() => setPhase('trace')}>판정 원칙</button></nav><div className="tt-header-actions"><button className="tt-profile"><UserRound size={15}/> DEMO</button></div></header>
    <StepRail phase={phase}/>
    {phase === 'input' && <TaxInput initialProfile={profile} onGenerate={(value) => { setProfile(value); setPhase('receipt') }}/>} 
    {phase === 'receipt' && <ReceiptView taxPaid={profile.taxPaid} onReset={() => setPhase('input')} onTrace={() => setPhase('trace')}/>} 
    {phase === 'trace' && <TraceView taxPaid={profile.taxPaid} onBack={() => setPhase('receipt')}/>} 
    <footer className="tt-footer"><Mark/><span>개인의 세금을 특정 사업에 직접 귀속하지 않습니다. 모든 개인 금액은 2024년 실제 집행 비중에 따른 비례 추정입니다.</span><b>2024 DATA · {fiscalSnapshot.collectedAt}</b></footer>
  </main>
}
