import test from 'node:test'
import assert from 'node:assert/strict'
import { SAMPLES, parsePrinciple, simulate } from './engine.mjs'

test('same input produces identical immutable run', () => {
  const parsed = parsePrinciple(SAMPLES[0].text)
  const first = simulate({ seed: 312, modifier: 'trap', parsed })
  const second = simulate({ seed: 312, modifier: 'trap', parsed })
  assert.deepEqual(first, second)
  assert.ok(Object.isFrozen(first.events) && first.events.every(Object.isFrozen))
  assert.ok(first.events.every(e => e.ruleId && e.ruleSource))
})

test('seed changes dungeon; unsupported clauses are visible', () => {
  const parsed = parsePrinciple('달을 바라본다. 함정은 피한다.')
  assert.deepEqual(parsed.ignored, ['달을 바라본다'])
  assert.notDeepEqual(simulate({ seed: 1, parsed }).dungeon, simulate({ seed: 2, parsed }).dungeon)
})
