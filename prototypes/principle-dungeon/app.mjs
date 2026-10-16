import { SAMPLES, MODIFIERS, ROOM_NAMES, parsePrinciple, simulate } from './engine.mjs'
const $ = id => document.getElementById(id)
const names = { ATTACK:'공격', DEFEND:'방어', AVOID:'회피', DISARM:'해제', BUY:'구매', IGNORE:'무시', OPEN:'열기', RETREAT:'후퇴', USE_POTION:'물약 사용' }
let run = null, current = 0
function updateParser() {
  const parsed = parsePrinciple($('principle').value)
  $('count').textContent = `${$('principle').value.length} / 200`
  $('rules').textContent = JSON.stringify({ version: parsed.version, rules: parsed.rules }, null, 2)
  $('notice').textContent = parsed.ignored.length ? `해석하지 못한 문장: ${parsed.ignored.join(' / ')}` : `${parsed.rules.length}개 규칙을 해석했습니다. 규칙이 없는 상황에는 기본 행동을 사용합니다.`
  return parsed
}
function renderStep() {
  if (!run) return
  const ev = run.events[current]
  $('step').value = current
  $('step-label').textContent = `${current + 1} / ${run.events.length}`
  $('prev').disabled = current === 0
  $('next').disabled = current === run.events.length - 1
  $('event').innerHTML = `<div class="event-title"><span>${ev.floor}F · ${ROOM_NAMES[ev.room]}</span><b>${names[ev.action]}</b></div><p>${ev.detail}</p><div class="event-rule">발동 규칙 <strong>${ev.ruleId}</strong> · ${escapeHtml(ev.ruleSource)}</div><div class="event-state">HP ${ev.before.hp} → ${ev.after.hp}<span>물약 ${ev.before.potions} → ${ev.after.potions}</span><span>골드 ${ev.before.gold} → ${ev.after.gold}</span></div>`
  document.querySelectorAll('.route-room').forEach((el, i) => el.classList.toggle('selected', i === current))
  document.querySelectorAll('.log-row').forEach((el, i) => el.classList.toggle('selected', i === current))
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }
function renderRun() {
  $('empty').hidden = true; $('output').hidden = false
  $('floor').textContent = `${run.result.floor} / ${run.dungeon.length}`
  $('hp').textContent = `${run.result.hp}%`
  $('score').textContent = run.result.score
  $('status').textContent = { dead:'사망', retreated:'후퇴', cleared:'돌파' }[run.result.status]
  $('seed-label').textContent = `SEED ${run.seed} · ${MODIFIERS[run.modifier].name}`
  $('route').replaceChildren(...run.dungeon.map((room, i) => { const b=document.createElement('button'); b.className='route-room'+(i>=run.events.length?' unvisited':''); b.innerHTML=`<small>${room.floor}F</small><strong>${ROOM_NAMES[room.type]}</strong>`; b.disabled=i>=run.events.length; b.addEventListener('click',()=>{current=i;renderStep()}); return b }))
  $('timeline').replaceChildren(...run.events.map((ev,i) => { const b=document.createElement('button'); b.className='log-row'; b.innerHTML=`<span>${ev.floor}F</span><strong>${ROOM_NAMES[ev.room]} · ${names[ev.action]}</strong><small>${ev.ruleId}</small>`; b.addEventListener('click',()=>{current=i;renderStep()}); return b }))
  current=0; $('step').max=run.events.length-1; renderStep()
}
$('samples').replaceChildren(...SAMPLES.map((sample,i)=>{const b=document.createElement('button');b.textContent=sample.name;b.addEventListener('click',()=>{$('principle').value=sample.text;document.querySelectorAll('.samples button').forEach((x,j)=>x.classList.toggle('active',j===i));updateParser()});return b}))
$('samples').firstChild.click()
$('principle').addEventListener('input',()=>{document.querySelectorAll('.samples button').forEach(x=>x.classList.remove('active'));updateParser()})
$('modifier').addEventListener('change',()=>{$('mod-desc').textContent=MODIFIERS[$('modifier').value].description})
$('modifier').dispatchEvent(new Event('change'))
$('run').addEventListener('click',()=>{const parsed=updateParser();const seed=Number($('seed').value);if(!Number.isInteger(seed)||seed<0||seed>4294967295){$('notice').textContent='시드는 0부터 4294967295까지 정수로 입력하세요.';return}run=simulate({seed,modifier:$('modifier').value,parsed});renderRun()})
$('prev').addEventListener('click',()=>{current=Math.max(0,current-1);renderStep()})
$('next').addEventListener('click',()=>{current=Math.min(run.events.length-1,current+1);renderStep()})
$('step').addEventListener('input',e=>{current=Number(e.target.value);renderStep()})
$('download').addEventListener('click',()=>{if(!run)return;const blob=new Blob([JSON.stringify(run,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`principle-dungeon-${run.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})
