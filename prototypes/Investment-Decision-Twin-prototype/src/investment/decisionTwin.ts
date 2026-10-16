export type CriterionId = 'growth' | 'valuation' | 'technology' | 'stability' | 'momentum'

export type DecisionRecord = {
  id: string
  date: string
  selectedName: string
  selectedTicker: string
  criteria: Record<CriterionId, number>
  excludedCandidates: number
  revisionCount: number
  horizon: string
  confidence: number
  invalidationRule: string
  valuationCeiling?: number
  rationale?: string
  ruleTags: Array<'stability-horizon' | 'disciplined-exit'>
  isSimulated: true
}

export type TwinFactor = {
  id: CriterionId
  label: string
  value: number
  observationCount: number
  evidenceDecisionIds: string[]
}

export type DiscoveredRule = {
  id: string
  text: string
  confidence: number
  evidenceDecisionIds: string[]
  status: 'established' | 'candidate'
}

export type TwinProfile = {
  factors: TwinFactor[]
  rules: DiscoveredRule[]
  modelConfidence: number
  decisionCount: number
  candidateExclusionCount: number
  revisionCount: number
}

const factorLabels: Record<CriterionId, string> = {
  growth: '성장성',
  valuation: '저평가',
  technology: '기술 우위',
  stability: '재무 안정성',
  momentum: '모멘텀',
}

const criteria = (growth: number, valuation: number, technology: number, stability: number, momentum: number) => ({
  growth, valuation, technology, stability, momentum,
})

export const historicalDecisions: DecisionRecord[] = [
  { id: 'decision-01', date: '2025-02-14', selectedName: 'Microsoft', selectedTicker: 'MSFT', criteria: criteria(72, 80, 55, 70, 35), excludedCandidates: 3, revisionCount: 2, horizon: '18개월', confidence: 78, invalidationRule: '클라우드 성장률 15% 미만', valuationCeiling: 25, ruleTags: ['stability-horizon'], isSimulated: true },
  { id: 'decision-02', date: '2025-04-03', selectedName: '삼성전자', selectedTicker: '005930', criteria: criteria(65, 75, 60, 65, 45), excludedCandidates: 2, revisionCount: 1, horizon: '12개월', confidence: 70, invalidationRule: '메모리 영업이익 적자 전환', valuationCeiling: 25, ruleTags: ['stability-horizon'], isSimulated: true },
  { id: 'decision-03', date: '2025-06-21', selectedName: 'Alphabet', selectedTicker: 'GOOGL', criteria: criteria(80, 70, 65, 60, 50), excludedCandidates: 4, revisionCount: 2, horizon: '12개월', confidence: 76, invalidationRule: '광고 매출 성장률 5% 미만', valuationCeiling: 25, ruleTags: ['stability-horizon', 'disciplined-exit'], isSimulated: true },
  { id: 'decision-04', date: '2025-08-09', selectedName: '현대자동차', selectedTicker: '005380', criteria: criteria(55, 65, 45, 55, 30), excludedCandidates: 1, revisionCount: 1, horizon: '6개월', confidence: 62, invalidationRule: '영업이익률 6% 미만', valuationCeiling: 25, ruleTags: ['disciplined-exit'], isSimulated: true },
  { id: 'decision-05', date: '2025-10-17', selectedName: 'Meta', selectedTicker: 'META', criteria: criteria(68, 85, 70, 75, 55), excludedCandidates: 3, revisionCount: 2, horizon: '18개월', confidence: 82, invalidationRule: '광고 단가 두 분기 연속 하락', valuationCeiling: 25, ruleTags: ['stability-horizon'], isSimulated: true },
  { id: 'decision-06', date: '2025-12-12', selectedName: 'SK하이닉스', selectedTicker: '000660', criteria: criteria(74, 60, 58, 58, 40), excludedCandidates: 2, revisionCount: 2, horizon: '12개월', confidence: 73, invalidationRule: 'HBM 점유율 2분기 연속 하락', valuationCeiling: 25, ruleTags: ['stability-horizon', 'disciplined-exit'], isSimulated: true },
  { id: 'decision-07', date: '2026-03-27', selectedName: 'Amazon', selectedTicker: 'AMZN', criteria: criteria(61, 72, 52, 62, 38), excludedCandidates: 3, revisionCount: 2, horizon: '12개월', confidence: 69, invalidationRule: 'AWS 성장률 12% 미만', valuationCeiling: 25, ruleTags: ['stability-horizon'], isSimulated: true },
]

const criterionOrder: CriterionId[] = ['growth', 'valuation', 'technology', 'stability', 'momentum']

const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)

export function buildTwinProfile(decisions: DecisionRecord[]): TwinProfile {
  if (decisions.length === 0) {
    return { factors: [], rules: [], modelConfidence: 0, decisionCount: 0, candidateExclusionCount: 0, revisionCount: 0 }
  }

  const factors = criterionOrder.map((id): TwinFactor => {
    const values = decisions.map((decision) => decision.criteria[id])
    const value = average(values)
    const strongest = [...decisions]
      .sort((a, b) => b.criteria[id] - a.criteria[id])
      .slice(0, Math.min(3, decisions.length))
      .map((decision) => decision.id)
    return { id, label: factorLabels[id], value, observationCount: values.length, evidenceDecisionIds: strongest }
  })

  const ruleDefinitions = [
    {
      id: 'stability-horizon',
      text: '재무 안정성이 확보된 성장주에서는 투자 기간을 길게 설정합니다.',
      decisions: decisions.filter((decision) => decision.ruleTags.includes('stability-horizon')),
    },
    {
      id: 'disciplined-exit',
      text: '매수 전에 수치형 무효화 조건을 정한 결정을 반복하고 있습니다.',
      decisions: decisions.filter((decision) => decision.ruleTags.includes('disciplined-exit')),
    },
  ]

  const rules: DiscoveredRule[] = ruleDefinitions
    .filter((rule) => rule.decisions.length > 0)
    .map((rule) => ({
      id: rule.id,
      text: rule.text,
      confidence: Math.min(88, 45 + rule.decisions.length * 7),
      evidenceDecisionIds: rule.decisions.map((decision) => decision.id),
      status: 'established',
    }))

  const latestException = [...decisions].reverse().find((decision) => decision.rationale)
  if (latestException) {
    rules.splice(1, 0, {
      id: 'valuation-exception-candidate',
      text: latestException.rationale!,
      confidence: 43,
      evidenceDecisionIds: [latestException.id],
      status: 'candidate',
    })
  }

  return {
    factors,
    rules,
    modelConfidence: Math.min(86, 40 + decisions.length * 4),
    decisionCount: decisions.length,
    candidateExclusionCount: decisions.reduce((sum, decision) => sum + decision.excludedCandidates, 0),
    revisionCount: decisions.reduce((sum, decision) => sum + decision.revisionCount, 0),
  }
}

export function detectValuationConflict(decisions: DecisionRecord[], actual: number) {
  const evidence = decisions.filter((decision) => decision.valuationCeiling !== undefined)
  const thresholds = evidence.map((decision) => decision.valuationCeiling!)
  const threshold = thresholds.length ? average(thresholds) : 0
  return {
    threshold,
    actual,
    breached: thresholds.length > 0 && actual > threshold,
    evidenceDecisionIds: evidence.map((decision) => decision.id),
  }
}

const rationaleCriteria: Record<string, Record<CriterionId, number>> = {
  '기술 우위가 가격 부담보다 중요하다': criteria(76, 32, 92, 60, 45),
  '장기 성장률이 밸류에이션을 정당화한다': criteria(92, 38, 82, 60, 40),
  '최근 가격 상승에 영향을 받았다': criteria(68, 30, 70, 55, 92),
  '아직 판단하지 못했다': criteria(60, 38, 65, 55, 55),
}

export function createNvidiaDecision(
  rationale: string,
  details: { confidence: number; horizon: string; invalidationRule: string },
): DecisionRecord {
  return {
    id: 'decision-nvda-demo',
    date: '2026-10-05',
    selectedName: 'NVIDIA',
    selectedTicker: 'NVDA',
    criteria: rationaleCriteria[rationale] ?? rationaleCriteria['아직 판단하지 못했다'],
    excludedCandidates: 0,
    revisionCount: 1,
    horizon: details.horizon,
    confidence: details.confidence,
    invalidationRule: details.invalidationRule,
    valuationCeiling: 25,
    rationale,
    ruleTags: [],
    isSimulated: true,
  }
}
