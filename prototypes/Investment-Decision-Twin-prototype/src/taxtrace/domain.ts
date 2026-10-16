export type EvidenceState = 'official' | 'reviewed' | 'ai-suggested' | 'uncertain'

export type ReceiptAllocation = {
  id: string
  label: string
  share: number
  amount: number
  color: string
  description: string
}

export type Evidence = {
  id: string
  title: string
  source: string
  date: string
  excerpt: string
  state: EvidenceState
  url: string
  counter?: boolean
}

export type TraceStage = {
  id: 'promise' | 'budget' | 'execution' | 'outcome'
  step: string
  title: string
  status: string
  statusTone: 'positive' | 'neutral' | 'caution'
  summary: string
  metric: string
  metricLabel: string
  evidence: Evidence[]
}

const categoryBlueprint = fiscalSnapshot.fields.map((field) => ({
  ...field,
  share: field.executionEok / fiscalSnapshot.totalExecutionEok * 100,
}))

export function estimateAnnualTax(income: number): number {
  if (!Number.isFinite(income) || income <= 0) return 0
  const rate = income <= 40_000_000 ? 0.041 : income <= 70_000_000 ? 0.066 : 0.084
  return Math.round(income * rate)
}

export function allocateReceipt(total: number): ReceiptAllocation[] {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.round(total) : 0
  const raw = categoryBlueprint.map((category) => safeTotal * category.share / 100)
  const amounts = raw.map(Math.floor)
  let remainder = safeTotal - amounts.reduce((sum, amount) => sum + amount, 0)
  const priority = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let cursor = 0; remainder > 0; cursor += 1, remainder -= 1) {
    amounts[priority[cursor % priority.length].index] += 1
  }
  return categoryBlueprint.map((category, index) => ({ ...category, amount: amounts[index] }))
}

export function calculateProjectAttribution(taxPaid: number): number {
  if (!Number.isFinite(taxPaid) || taxPaid <= 0) return 0
  const totalExecutionWon = fiscalSnapshot.totalExecutionEok * 100_000_000
  return Math.round(taxPaid * fiscalSnapshot.project.executionWon / totalExecutionWon)
}

export function getStageInterpretation(stageId: TraceStage['id']): string {
  const interpretations: Record<TraceStage['id'], string> = {
    promise: '지원 대상과 수단, 목표 인원이 공식 계획에 명시됐습니다. 이것만으로 정책 효과가 발생했다는 뜻은 아닙니다.',
    budget: '정책 방향이 사업코드 1034-311의 실제 예산으로 편성되고 회계연도 중 증액 조정됐습니다.',
    execution: '중앙정부 집행률은 100%입니다. 다만 지자체의 최종 지급 금액과 실제 수혜 인원은 별도 데이터로 확인해야 합니다.',
    outcome: '공개자료만으로 최종 지급 완료와 주거비 부담 감소를 검증할 수 없어 결과 판단을 보류합니다.',
  }
  return interpretations[stageId]
}

export const traceStages: TraceStage[] = [
  {
    id: 'promise', step: '01', title: '정책은 무엇을 약속했나', status: '공식 계획 확인', statusTone: 'positive',
    summary: '경제적 어려움을 겪는 무주택 청년의 월세 부담을 낮추기 위해 월 최대 20만 원을 지원하는 정책으로 설계됐습니다.',
    metric: '15만 명', metricLabel: '2024 누적 수혜 목표',
    evidence: [
      { id: 'p1', title: '2024년 청년정책 시행계획', source: '국무조정실', date: '2024', excerpt: '사업 목적, 지원 대상 약 13만 명, 누적 수혜 목표 15만 명과 국비·지방비 분담 구조를 명시합니다.', state: 'official', url: fiscalSnapshot.sources.youthPolicyPlan },
      { id: 'p2', title: '2차 청년월세 특별지원 발표', source: '국토교통부', date: '2024.02.21', excerpt: '만 19~34세 무주택 청년을 대상으로 월 최대 20만 원을 지원하는 신청 조건을 발표했습니다.', state: 'official', url: fiscalSnapshot.sources.molitAnnouncement },
    ],
  },
  {
    id: 'budget', step: '02', title: '예산에 얼마가 반영됐나', status: '증액 조정', statusTone: 'positive',
    summary: '2024년 본예산 793억 5,100만 원에서 신청 증가에 대응해 5억 1,160만 원이 추가 조정됐습니다.',
    metric: '798.63억', metricLabel: '2024 예산현액',
    evidence: [
      { id: 'b1', title: '2024년 국토교통부 예산서', source: '국토교통부', date: '2024.01', excerpt: '청년월세 한시 특별지원의 최초 편성액 793억 5,100만 원을 확인할 수 있습니다.', state: 'official', url: fiscalSnapshot.sources.molitBudget },
      { id: 'b2', title: '사업별 결산 세출·지출 현황', source: '열린재정 API', date: '2024 회계연도', excerpt: '본예산, 조정액, 예산현액을 세부사업 단위의 원자료로 제공합니다.', state: 'official', url: fiscalSnapshot.sources.projectSettlement },
    ],
  },
  {
    id: 'execution', step: '03', title: '중앙정부는 집행했나', status: '전액 집행', statusTone: 'positive',
    summary: '열린재정과 국회예산정책처 결산에서 예산현액 798억 6,260만 원이 전액 집행되고 이월·불용은 0원으로 확인됩니다.',
    metric: '100%', metricLabel: '중앙정부 집행률',
    evidence: [
      { id: 'e1', title: '2024회계연도 결산 분석', source: '국회예산정책처', date: '2025.07', excerpt: '사업코드 1034-311의 예산현액, 집행액, 이월액과 불용액을 분석한 공식 결산 자료입니다.', state: 'official', url: fiscalSnapshot.sources.naboAccounts },
      { id: 'e2', title: '지자체 최종 지급은 별도 확인 필요', source: 'TaxTrace 데이터 검증', date: fiscalSnapshot.collectedAt, excerpt: '중앙정부 전액 집행은 지자체 교부 이후 최종 수혜자 지급이 모두 완료됐다는 의미가 아닙니다.', state: 'uncertain', url: 'https://www.lofin365.go.kr/' },
    ],
  },
  {
    id: 'outcome', step: '04', title: '최종 수혜자에게 도달했나', status: '공개자료 부족', statusTone: 'caution',
    summary: '2024년 실제 수혜자 수와 지자체별 최종 지급액의 통합 원자료는 행복e음에 있으나 공개 데이터만으로는 완결된 검증이 어렵습니다.',
    metric: '확인 불가', metricLabel: '2024 최종 실집행',
    evidence: [
      { id: 'o1', title: '성과 측정 데이터 출처', source: '국무조정실 청년정책 시행계획', date: '2024', excerpt: '1개월 이상 월세 지원을 받은 누적 청년 수를 행복e음에서 추출하도록 정의합니다.', state: 'official', url: fiscalSnapshot.sources.youthPolicyPlan },
      { id: 'o2', title: '결과 판정을 유보하는 이유', source: 'TaxTrace 데이터 검증', date: fiscalSnapshot.collectedAt, excerpt: '예산 집행과 신청 건수만으로 실제 수혜 완료나 주거비 부담 감소를 증명할 수 없습니다.', state: 'reviewed', counter: true, url: fiscalSnapshot.sources.naboAccounts },
    ],
  },
]

import { fiscalSnapshot } from './fiscalData'

