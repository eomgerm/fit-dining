import { describe, expect, it } from 'vitest'
import { getPrototypeRoute, resetPrototypeScroll } from './prototypeRoute'

describe('getPrototypeRoute', () => {
  it('keeps Thesis as the default and selects TaxTrace only for its hash', () => {
    expect(getPrototypeRoute('')).toBe('thesis')
    expect(getPrototypeRoute('#/thesis')).toBe('thesis')
    expect(getPrototypeRoute('#/taxtrace')).toBe('taxtrace')
  })
})

describe('resetPrototypeScroll', () => {
  it('returns a reused product scroll container to the top after a phase change', () => {
    const target = { scrollTop: 150 }
    resetPrototypeScroll(target)
    expect(target.scrollTop).toBe(0)
  })
})
