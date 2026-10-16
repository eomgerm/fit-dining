import { describe, expect, it } from 'vitest'
import { allocateReceipt, calculateProjectAttribution, estimateAnnualTax, getStageInterpretation, traceStages } from './domain'
import { fiscalSnapshot } from './fiscalData'

describe('estimateAnnualTax', () => {
  it('returns zero instead of an invalid or negative estimate', () => {
    expect(estimateAnnualTax(Number.NaN)).toBe(0)
    expect(estimateAnnualTax(-12_000_000)).toBe(0)
  })

  it('applies the demo income band at the boundary', () => {
    expect(estimateAnnualTax(40_000_000)).toBe(1_640_000)
    expect(estimateAnnualTax(48_000_000)).toBe(3_168_000)
  })
})

describe('allocateReceipt', () => {
  it('keeps rounded category allocations equal to the estimated total', () => {
    const allocations = allocateReceipt(3_168_001)
    expect(allocations.reduce((sum, item) => sum + item.amount, 0)).toBe(3_168_001)
    expect(allocations.find((item) => item.id === 'social-welfare')?.share).toBeCloseTo(34.565, 3)
  })

  it('never creates a negative category when the total is smaller than the category count', () => {
    const allocations = allocateReceipt(7)
    expect(allocations.reduce((sum, item) => sum + item.amount, 0)).toBe(7)
    expect(allocations.every((item) => item.amount >= 0)).toBe(true)
  })
})

describe('2024 official fiscal snapshot', () => {
  it('keeps the 16 official field executions equal to the published total', () => {
    expect(fiscalSnapshot.fields).toHaveLength(16)
    expect(fiscalSnapshot.fields.reduce((sum, field) => sum + field.executionEok, 0))
      .toBe(fiscalSnapshot.totalExecutionEok)
  })

  it('attributes the youth rent project against the same national execution denominator', () => {
    expect(calculateProjectAttribution(1_200_000)).toBe(150)
    expect(calculateProjectAttribution(Number.NaN)).toBe(0)
    expect(calculateProjectAttribution(-1)).toBe(0)
  })
})

describe('trace evidence', () => {
  it('uses only the four disclosed review states', () => {
    const allowed = new Set(['official', 'reviewed', 'ai-suggested', 'uncertain'])
    expect(traceStages.flatMap((stage) => stage.evidence).every((item) => allowed.has(item.state))).toBe(true)
  })

  it('distinguishes central execution from final beneficiary delivery', () => {
    expect(getStageInterpretation('execution')).toContain('중앙정부 집행률은 100%')
    expect(getStageInterpretation('execution')).toContain('최종 지급')
  })
})
