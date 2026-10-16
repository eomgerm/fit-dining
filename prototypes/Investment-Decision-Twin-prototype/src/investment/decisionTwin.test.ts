import { describe, expect, it } from 'vitest'
import {
  buildTwinProfile,
  createNvidiaDecision,
  detectValuationConflict,
  historicalDecisions,
} from './decisionTwin'

describe('Decision Twin model', () => {
  it('builds a traceable baseline from seven simulated decisions', () => {
    const profile = buildTwinProfile(historicalDecisions)

    expect(profile.decisionCount).toBe(7)
    expect(profile.candidateExclusionCount).toBe(18)
    expect(profile.factors).toHaveLength(5)
    expect(profile.factors.map((factor) => factor.value)).toEqual([68, 72, 58, 64, 42])
    expect(profile.factors.every((factor) => factor.observationCount === 7)).toBe(true)
    expect(profile.factors.every((factor) => factor.evidenceDecisionIds.length > 0)).toBe(true)
    expect(profile.rules.every((rule) => rule.evidenceDecisionIds.length > 0)).toBe(true)
  })

  it('detects a valuation exception using the historical ceiling and evidence', () => {
    const conflict = detectValuationConflict(historicalDecisions, 29.6)

    expect(conflict).toMatchObject({ threshold: 25, actual: 29.6, breached: true })
    expect(conflict.evidenceDecisionIds).toHaveLength(7)
  })

  it('treats one NVIDIA exception as weak evidence instead of rewriting the profile', () => {
    const before = buildTwinProfile(historicalDecisions)
    const decision = createNvidiaDecision('기술 우위가 가격 부담보다 중요하다', {
      confidence: 72,
      horizon: '12개월',
      invalidationRule: 'AI 반도체 매출 성장률이 20% 아래로 하락',
    })
    const after = buildTwinProfile([...historicalDecisions, decision])

    expect(after.decisionCount).toBe(8)
    expect(after.factors.find((factor) => factor.id === 'technology')!.value).toBeGreaterThan(
      before.factors.find((factor) => factor.id === 'technology')!.value,
    )
    expect(after.factors.find((factor) => factor.id === 'technology')!.value - before.factors.find((factor) => factor.id === 'technology')!.value).toBeLessThanOrEqual(5)
    expect(after.factors.find((factor) => factor.id === 'valuation')!.value).toBeLessThan(
      before.factors.find((factor) => factor.id === 'valuation')!.value,
    )

    const learnedRule = after.rules.find((rule) => rule.status === 'candidate')
    expect(learnedRule).toMatchObject({ confidence: 43, evidenceDecisionIds: ['decision-nvda-demo'] })
  })
})
