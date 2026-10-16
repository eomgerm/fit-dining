export const SAMPLES = [
  { name: '신중한 탐험가', text: '체력이 40% 이하면 물약을 쓴다. 체력이 25% 이하면 후퇴한다. 상인에게 물약을 산다. 함정은 피한다. 몬스터는 방어한다.' },
  { name: '무모한 전사', text: '몬스터를 만나면 공격한다. 보스도 공격한다. 상인은 무시한다. 함정은 돌파한다. 체력이 20% 이하면 물약을 쓴다.' },
  { name: '보물 사냥꾼', text: '상인에게 물약을 산다. 보물은 연다. 몬스터는 공격한다. 함정은 피한다. 체력이 50% 이하면 물약을 쓴다.' },
]
export const MODIFIERS = {
  none: { name: '기본 던전', description: '기본 규칙으로 탐험합니다.' },
  trap: { name: '함정 2배', description: '함정 피해가 두 배입니다.' },
  merchant: { name: '상인 불신 금지', description: '상인에게서 산 물약 하나가 가짜일 수 있습니다.' },
}
export const ROOM_NAMES = { monster: '몬스터', trap: '함정', merchant: '상인', treasure: '보물', boss: '보스' }
const DEFAULTS = { monster: 'DEFEND', boss: 'DEFEND', trap: 'AVOID', merchant: 'IGNORE', treasure: 'OPEN' }
const ACTIONS = ['ATTACK', 'DEFEND', 'AVOID', 'DISARM', 'BUY', 'IGNORE', 'OPEN', 'RETREAT', 'USE_POTION']
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }

// Supported Korean phrases are intentionally narrow. Unknown sentences are reported, never silently invented.
export function parsePrinciple(input) {
  const source = String(input ?? '').trim().slice(0, 200)
  const clauses = source.split(/[.。\n;]+/).map(x => x.trim()).filter(Boolean)
  const rules = [], ignored = []
  for (const clause of clauses) {
    const hp = clause.match(/(?:체력|HP)\s*(?:이|가)?\s*(\d{1,3})\s*%?\s*(?:이하|미만|밑|아래)/i)
    const isPotion = /물약/.test(clause) && /(쓴다|사용|마신다|먹는다)/.test(clause)
    const isRetreat = /(후퇴|도망|탈출)/.test(clause)
    if (hp && (isPotion || isRetreat)) {
      const threshold = Math.max(1, Math.min(100, Number(hp[1])))
      rules.push({ id: `R${rules.length + 1}`, condition: { type: 'HP_BELOW', value: threshold }, action: isRetreat ? 'RETREAT' : 'USE_POTION', priority: 100 + (100 - threshold), source: clause })
      continue
    }
    let room = /보스/.test(clause) ? 'boss' : /몬스터|적/.test(clause) ? 'monster' : /함정/.test(clause) ? 'trap' : /상인/.test(clause) ? 'merchant' : /보물|상자/.test(clause) ? 'treasure' : null
    let action = null
    if (room === 'monster' || room === 'boss') action = /(공격|싸운다|돌격)/.test(clause) ? 'ATTACK' : /(방어|막는다)/.test(clause) ? 'DEFEND' : /(후퇴|도망)/.test(clause) ? 'RETREAT' : null
    if (room === 'trap') action = /(해제)/.test(clause) ? 'DISARM' : /(피한다|회피|우회)/.test(clause) ? 'AVOID' : /(돌파|무시)/.test(clause) ? 'IGNORE' : null
    if (room === 'merchant') action = /(무시|사지|거절)/.test(clause) ? 'IGNORE' : /(산다|구매)/.test(clause) && /물약/.test(clause) ? 'BUY' : null
    if (room === 'treasure') action = /(무시|열지)/.test(clause) ? 'IGNORE' : /(연다|열어|챙긴다)/.test(clause) ? 'OPEN' : null
    if (room && action) rules.push({ id: `R${rules.length + 1}`, condition: { type: 'ROOM', value: room }, action, priority: 50, source: clause })
    else ignored.push(clause)
  }
  return freeze({ version: 1, source, rules, ignored, supportedActions: ACTIONS })
}

function rng(seed) {
  let n = Number(seed) >>> 0
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296 }
}
export function generateDungeon(seed, floors = 16) {
  const random = rng(seed)
  return freeze(Array.from({ length: floors }, (_, i) => {
    const roll = random()
    const type = (i + 1) % 8 === 0 ? 'boss' : roll < .37 ? 'monster' : roll < .62 ? 'trap' : roll < .8 ? 'merchant' : 'treasure'
    return { floor: i + 1, type, strength: 1 + Math.floor(random() * 3), chance: random() }
  }))
}
export function simulate({ seed = 312, modifier = 'none', parsed, floors = 16 }) {
  if (!MODIFIERS[modifier]) throw Error('Unknown modifier')
  if (!parsed || !Array.isArray(parsed.rules)) throw Error('Parsed rules required')
  const dungeon = generateDungeon(seed, floors), events = []
  const state = { hp: 100, gold: 18, potions: 1, floor: 0, score: 0, status: 'exploring', fakePotion: false }
  for (const room of dungeon) {
    if (state.status !== 'exploring') break
    const before = { ...state }
    state.floor = room.floor
    const hpRule = parsed.rules.find(r => r.condition.type === 'HP_BELOW' && state.hp <= r.condition.value && (r.action !== 'USE_POTION' || state.potions > 0))
    const roomRule = parsed.rules.find(r => r.condition.type === 'ROOM' && r.condition.value === room.type)
    const chosen = hpRule ?? roomRule
    const action = chosen?.action ?? DEFAULTS[room.type]
    let detail = '', damage = 0
    if (action === 'RETREAT') { state.status = 'retreated'; detail = '원칙에 따라 탐험을 멈췄습니다.' }
    else if (action === 'USE_POTION') {
      state.potions--
      if (state.fakePotion) { state.fakePotion = false; detail = '가짜 물약이어서 회복하지 못했습니다.' }
      else { state.hp = Math.min(100, state.hp + 34); detail = '물약으로 체력 34를 회복했습니다.' }
    } else if (room.type === 'monster' || room.type === 'boss') {
      const power = room.strength * (room.type === 'boss' ? 11 : 6)
      damage = action === 'ATTACK' ? power + 5 : Math.ceil(power * .55)
      state.score += action === 'ATTACK' ? (room.type === 'boss' ? 32 : 12) : 5
      detail = `${ROOM_NAMES[room.type]}와 ${action === 'ATTACK' ? '맞서 싸웠습니다' : '방어하며 지나갔습니다'}.`
    } else if (room.type === 'trap') {
      damage = action === 'AVOID' ? (room.chance < .7 ? 0 : 5) : action === 'DISARM' ? (room.chance < .5 ? 0 : 8) : 9 + room.strength * 3
      if (modifier === 'trap') damage *= 2
      detail = damage ? `함정으로 체력 ${damage}를 잃었습니다.` : '함정을 안전하게 통과했습니다.'
      state.score += damage ? 0 : 8
    } else if (room.type === 'merchant') {
      if (action === 'BUY' && state.gold >= 10) { state.gold -= 10; state.potions++; if (modifier === 'merchant' && room.chance < .65) state.fakePotion = true; detail = '물약을 10골드에 샀습니다.' + (state.fakePotion ? ' 수상한 기운이 느껴집니다.' : '') }
      else detail = action === 'BUY' ? '골드가 부족해 구매하지 못했습니다.' : '상인을 지나쳤습니다.'
    } else {
      if (action === 'OPEN') { const gain = 5 + room.strength * 4; state.gold += gain; state.score += gain; detail = `보물에서 ${gain}골드를 얻었습니다.` }
      else detail = '보물을 지나쳤습니다.'
    }
    state.hp = Math.max(0, state.hp - damage)
    if (state.hp === 0) state.status = 'dead'
    if (state.status === 'exploring' && room.floor === dungeon.length) state.status = 'cleared'
    events.push(freeze({ index: events.length, floor: room.floor, room: room.type, action, ruleId: chosen?.id ?? 'DEFAULT', ruleSource: chosen?.source ?? '기본 행동', before, after: { ...state }, detail }))
  }
  return freeze({ seed: Number(seed) >>> 0, modifier, rules: parsed.rules, dungeon, events, result: { ...state } })
}
