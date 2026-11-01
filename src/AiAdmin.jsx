import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, ORDER, SHORT } from './supabase.js'
import { useApp } from './ctx.jsx'
import { errText, stampFull, iso, add, todayMid, hasAll } from './util.js'
import NewChange, { emptyForm } from './NewChange.jsx'
import { resetAiPublic, md2, MODELS, estCost } from './ai.js'

// 관리자 모드 › AI 초안 설정: 켜기·기준 / 참고·경고 / 시험해 보기 / 사용 현황
const SUBS = [['on', '켜기·기준'], ['ref', '참고·경고'], ['test', '시험해 보기'], ['use', '사용 현황']]
const SUBT = {
  on: '켜기·한도·확인 필요 기준',
  ref: '참고할 과거 변경·변경 종류별 배정 목록·대외비 경고',
  test: '실제 변경 등록과 똑같이 동작, 저장 안 됨',
  use: '이름 없이 숫자만',
}
const KEYS = ['enabled', 'monthly_limit', 'max_questions', 'rules', 'past_months', 'closed_only', 'skip_stopped', 'excluded', 'pinned', 'send_n', 'type_links', 'conf_words', 'conf_mode', 'model', 'price_in', 'price_out', 'price_cache_read', 'price_cache_write', 'usd_krw']
const pick = c => Object.fromEntries(KEYS.map(k => [k, k === 'pinned' ? (c[k] || []) : k === 'send_n' ? (c[k] || 15) : c[k]]))
const won = n => Math.round(Number(n) || 0).toLocaleString()

function Sw({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={'ai-sw' + (on ? ' on' : '')} onClick={() => onChange(!on)}><i /></button>
}

export default function AiAdmin() {
  const { toast } = useApp()
  const [sub, setSub] = useState('on')
  const [cfg, setCfg] = useState(null)
  const [f, setF] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [testNf, setTestNf] = useState(() => emptyForm())
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_ai_get')
    if (error) return setErr(errText(error) + ' (upgrade12.sql을 실행했는지 확인해주세요)')
    setErr(''); setCfg(data); setF(pick(data))
  }, [])
  useEffect(() => { load() }, [load])
  const dirty = !!(cfg && f && JSON.stringify(pick(f)) !== JSON.stringify(pick(cfg)))
  const set = patch => setF(x => ({ ...x, ...patch }))

  async function save() {
    if (busy) return
    const bad = f.rules.findIndex(r => !String(r.when || '').trim())
    if (bad >= 0) { setSub('on'); return setErr(`${bad + 1}번째 확인 필요 기준의 "어떤 경우에 묻나요"를 적어주세요.`) }
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('admin_ai_save', { p: f })
    setBusy(false)
    if (error) return setErr(errText(error))
    resetAiPublic()
    toast('AI 초안 설정을 저장했습니다 · 다음 대화부터 반영됩니다')
    load()
  }

  return (
    <>
      <div className="adm-h ai-ah">
        <div><h1>AI 초안 설정</h1><p>변경 등록 [AI로 작성] 탭이 따르는 기준과 사용 한도 · {SUBT[sub]}</p></div>
        <div className="ai-subs">
          {SUBS.map(([k, l]) => <button key={k} type="button" className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{l}</button>)}
          <button type="button" className="btn" disabled={!dirty || busy} onClick={save}>{busy ? '저장 중…' : dirty ? '저장' : '저장됨'}</button>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      {!f ? (!err && <p className="muted">불러오는 중…</p>) : (
        <>
          {dirty && sub !== 'use' && <div className="ai-dirty">저장 안 한 설정이 있습니다 · [저장]을 눌러야 사용자에게 반영됩니다{sub !== 'test' && <> · <button type="button" className="link" onClick={() => setSub('test')}>시험해 보기</button>로 먼저 확인할 수 있어요</>}</div>}
          {sub === 'on' && <OnTab cfg={cfg} f={f} set={set} />}
          {sub === 'ref' && <RefTab f={f} set={set} />}
          {sub === 'test' && <TestTab cfg={cfg} f={f} dirty={dirty} nf={testNf} setNf={setTestNf} />}
          {sub === 'use' && <UseTab />}
        </>
      )}
    </>
  )
}

/* ---------- 켜기·기준 ---------- */
function OnTab({ cfg, f, set }) {
  const [drag, setDrag] = useState(null)
  const lim = parseInt(f.monthly_limit, 10) || 0
  const pct = lim ? Math.min(100, (cfg.month_cost / lim) * 100) : 100
  const rules = f.rules || []
  const setRules = r => set({ rules: r })
  const move = (from, to) => { if (to < 0 || to >= rules.length || from === to) return; const r = rules.slice(); const [m] = r.splice(from, 1); r.splice(to, 0, m); setRules(r) }
  const editR = (i, patch) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const regRate = cfg.month_drafts ? Math.round((cfg.month_registered / cfg.month_drafts) * 100) : null
  return (
    <>
      <div className="stats four ai-cards">
        <div className="stat"><div className="k">AI로 작성</div><div className="v ai-onv"><Sw on={f.enabled} label="AI로 작성 켜기" onChange={v => set({ enabled: v })} /><b className={f.enabled ? 'on' : ''}>{f.enabled ? '켜짐' : '꺼짐'}</b></div><div className="s">끄면 모든 사람에게 [직접 작성]만 보임</div></div>
        <div className="stat"><div className="k">이번 달 추정 사용 금액</div>
          <div className="v">약 {won(cfg.month_cost)}<small>원 / 한도 </small><input className="hb-num ai-lim" type="number" min="0" step="1000" value={f.monthly_limit} onChange={e => set({ monthly_limit: e.target.value })} aria-label="월 사용 한도 (원)" /><small>원</small></div>
          <div className={'meter ai-meter' + (pct >= 100 ? ' over' : pct >= 80 ? ' near' : '')}><i style={{ width: Math.max(1.5, pct) + '%' }} /></div>
          <div className="s">{pct >= 100 ? '한도를 넘어 이번 달은 AI 탭이 멈췄습니다 · 한도를 올리면 다시 켜짐' : '한도를 넘으면 그달은 AI 탭 자동 멈춤 · 추정치'}</div></div>
        <div className="stat"><div className="k">이번 달 초안</div><div className="v">{cfg.month_drafts}<small>건</small></div><div className="s">등록까지 이어짐 {cfg.month_registered}건{regRate != null ? ` (${regRate}%)` : ''}</div></div>
        <div className="stat"><div className="k">확인 필요 최대 개수</div><div className="v"><input className="hb-num" type="number" min="0" max="10" value={f.max_questions} onChange={e => set({ max_questions: e.target.value })} aria-label="확인 필요 질문 최대 개수" /><small> 개 / 초안 1건</small></div><div className="s">많으면 아무도 안 읽음 · 3~5개 권장 · 0이면 묻지 않음</div></div>
      </div>

      <ModelCard f={f} set={set} />

      <div className="card adm-card">
        <h2>확인 필요 기준 <small className="us-sm">AI는 아래 경우에만 질문을 남깁니다 · 위에 있을수록 먼저 묻습니다(끌어서 순서 변경)</small></h2>
        <p className="ai-p"><b>모든 질문은 등록하는 사람에게만</b> AI 대화에서 묻습니다(다른 부서를 부르지 않음). AI가 <b>대화 내용으로 어떤 변경인지 판단해서 해당되는 기준만</b> 묻습니다(예: 박스 얘기가 없으면 박스 질문은 안 함). '경우'는 구체적으로 적어주세요.</p>
        <div className="us-tw">
          <table className="ai-rules">
            <thead><tr><th aria-label="끌기" /><th>순서</th><th>켜기</th><th>어떤 경우에 묻나요</th><th>예시 질문</th><th aria-label="삭제" /></tr></thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={r.id + i} className={(r.on ? '' : 'off') + (drag && drag.over === i && drag.from !== i ? ' over' : '')}
                  draggable onDragStart={e => { try { e.dataTransfer.setData('text/plain', String(i)) } catch (_) {} setDrag({ from: i, over: i }) }}
                  onDragOver={e => { e.preventDefault(); if (drag && drag.over !== i) setDrag({ ...drag, over: i }) }}
                  onDrop={e => { e.preventDefault(); if (drag) move(drag.from, i); setDrag(null) }} onDragEnd={() => setDrag(null)}>
                  <td className="g"><span className="grip" aria-hidden="true">⋮⋮</span>
                    <span className="ai-ud"><button type="button" aria-label="위로" disabled={i === 0} onClick={() => move(i, i - 1)}>▲</button><button type="button" aria-label="아래로" disabled={i === rules.length - 1} onClick={() => move(i, i + 1)}>▼</button></span></td>
                  <td className="n">{i + 1}</td>
                  <td><Sw on={r.on} label={(i + 1) + '번 기준 켜기'} onChange={v => editR(i, { on: v })} /></td>
                  <td><input value={r.when} aria-label={(i + 1) + '번 기준: 어떤 경우에 묻나요'} placeholder="예: 박스 인쇄·적재 규격도 바뀌는지 불분명할 때" onChange={e => editR(i, { when: e.target.value })} />{!r.base && <span className="ai-own">관리자 추가</span>}</td>
                  <td><input value={r.ex} aria-label={(i + 1) + '번 기준: 예시 질문'} placeholder="예: 적재 규격(박스 크기)도 바뀌나요?" onChange={e => editR(i, { ex: e.target.value })} /></td>
                  <td><button type="button" className="ai-x" aria-label={(i + 1) + '번 기준 삭제'} onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ai-rf">
          <button type="button" className="link" onClick={() => setRules([...rules, { id: 'u' + Date.now().toString(36), on: true, base: false, when: '', ex: '' }])}>+ 기준 추가</button>
          <button type="button" className="link" onClick={() => setRules(cfg.default_rules.map(r => ({ ...r })))}>기본값으로 되돌리기</button>
          <span className="muted">처음 7개는 기본값 · 지워도 '기본값으로 되돌리기'로 복구 (관리자가 추가한 기준은 지워짐)</span>
        </div>
      </div>

      <details className="card adm-card ai-adv">
        <summary>단가·환율 (고급) · 모델을 고르면 자동으로 채워짐 · 환율 {won(f.usd_krw)}원</summary>
        <p className="ai-p">추정 금액 = 쓴 토큰 수 × 단가(미국 달러, 100만 토큰당) × 환율. 위에서 모델을 고르면 단가가 자동으로 바뀝니다. AI 회사 가격이나 환율이 바뀌면 여기 숫자만 고치면 됩니다. 실제 청구 금액은 AI 회사 사이트에서 확인하세요.</p>
        <div className="ai-adv-g">
          <label>모델 이름 (직접 입력)<input value={f.model} onChange={e => set({ model: e.target.value })} /></label>
          <label>입력 단가 ($)<input type="number" step="0.01" min="0" value={f.price_in} onChange={e => set({ price_in: e.target.value })} /></label>
          <label>출력 단가 ($)<input type="number" step="0.01" min="0" value={f.price_out} onChange={e => set({ price_out: e.target.value })} /></label>
          <label>캐시 읽기 ($)<input type="number" step="0.001" min="0" value={f.price_cache_read} onChange={e => set({ price_cache_read: e.target.value })} /></label>
          <label>캐시 쓰기 ($)<input type="number" step="0.001" min="0" value={f.price_cache_write} onChange={e => set({ price_cache_write: e.target.value })} /></label>
          <label>환율 (원/$)<input type="number" step="10" min="0" value={f.usd_krw} onChange={e => set({ usd_krw: e.target.value })} /></label>
        </div>
      </details>
    </>
  )
}

function ModelCard({ f, set }) {
  const cur = MODELS.find(m => m.id === f.model)
  const pick = id => {
    const m = MODELS.find(x => x.id === id)
    if (m) set({ model: m.id, price_in: m.p.in, price_out: m.p.out, price_cache_read: m.p.cr, price_cache_write: m.p.cw })
  }
  const e = estCost(f)
  const lim = parseInt(f.monthly_limit, 10) || 0
  const priceOk = cur && Number(f.price_in) === cur.p.in && Number(f.price_out) === cur.p.out && Number(f.price_cache_read) === cur.p.cr && Number(f.price_cache_write) === cur.p.cw
  return (
    <div className="card adm-card ai-model">
      <h2>사용 모델 <small className="us-sm">고르면 단가가 자동으로 채워지고 예상 금액이 바뀝니다</small></h2>
      <div className="ai-mrow">
        <select value={cur ? cur.id : ''} aria-label="사용 모델" onChange={ev => pick(ev.target.value)}>
          {!cur && <option value="">직접 입력: {f.model}</option>}
          {MODELS.map(m => <option key={m.id} value={m.id}>{m.name} — {m.tag}</option>)}
        </select>
        <div className="ai-mest">
          <span>대화 1번 약 <b>{e.next < 10 ? e.next.toFixed(1) : won(e.next)}원</b>{e.first > e.next * 1.3 && <small> (첫 번째는 약 {e.first < 10 ? e.first.toFixed(1) : won(e.first)}원)</small>}</span>
          <span>초안 1건(대화 4번) 약 <b>{e.draft < 10 ? e.draft.toFixed(1) : won(e.draft)}원</b></span>
          {lim > 0 && e.draft > 0 && <span>월 한도 {won(lim)}원이면 약 <b>{won(Math.floor(lim / e.draft))}건</b></span>}
        </div>
      </div>
      <div className="ai-mcmp">
        {MODELS.map(m => {
          const x = estCost({ ...f, price_in: m.p.in, price_out: m.p.out, price_cache_read: m.p.cr, price_cache_write: m.p.cw })
          return <button key={m.id} type="button" className={m.id === f.model ? 'on' : ''} onClick={() => pick(m.id)}><b>{m.name}</b><span>{m.tag}</span><em>초안 1건 약 {x.draft < 10 ? x.draft.toFixed(1) : won(x.draft)}원</em></button>
        })}
      </div>
      <p className="ai-p muted">예상 금액은 규칙·참고 자료 약 9천 토큰, 한 번에 답 약 1.5천 토큰으로 가정한 어림값입니다(과거 변경이 많거나 대화가 길면 늘어남). 단가는 2026년 11월 공개 자료 기준이라 바뀔 수 있습니다{cur && !priceOk ? ' · 지금 단가를 직접 고쳐 둔 상태입니다' : ''}. 정확한 금액은 '시험해 보기'와 '사용 현황'에서 확인하세요. 저장해야 사용자에게 반영됩니다.</p>
    </div>
  )
}

/* ---------- 참고·경고 ---------- */
function RefTab({ f, set }) {
  const { db } = useApp()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})
  const [word, setWord] = useState('')
  const ex = f.excluded || []
  const exSet = new Set(ex.map(x => x.id))
  const pinned = new Set(f.pinned || [])
  const months = parseInt(f.past_months, 10) || 12
  const from = Date.now() - months * 30.44 * 86400000
  // 참고 후보: 종결된 변경에서 자동 추가된 목록(기간·중단 조건) + 저장한 목록(항상)
  const rows = db.presets.map(p => {
    const c = p.source_change_id ? db.changeMap[p.source_change_id] : null
    const g = c && c.group ? c.group : null
    const kind = p.source_change_id ? 'past' : 'saved'
    const at = p.closed_at || p.updated_at || p.created_at
    return { p, c, g, kind, at, title: kind === 'past' ? (g ? g.title : c ? c.title : p.name) : p.name,
      off: exSet.has(p.id) || (c && exSet.has(c.id)) || (g && exSet.has(g.id)) }
  }).filter(r => r.kind === 'saved' || ((!r.at || new Date(r.at).getTime() >= from) && !(f.skip_stopped && r.c && r.c.close_type === '중단')))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const shown = rows.filter(r => !q.trim() || hasAll(r.title + ' ' + r.p.name, q))
  const onN = rows.filter(r => !r.off).length
  const setOn = (r, on) => {
    const ids = [r.p.id, r.c && r.c.id, r.g && r.g.id].filter(Boolean)
    const rest = ex.filter(x => !ids.includes(x.id))
    set({ excluded: on ? rest : [...rest, { id: r.p.id, reason: '' }], ...(on ? {} : { pinned: (f.pinned || []).filter(x => x !== r.p.id) }) })
  }
  const setAll = on => {
    const ids = new Set(shown.flatMap(r => [r.p.id, r.c && r.c.id, r.g && r.g.id].filter(Boolean)))
    const rest = ex.filter(x => !ids.has(x.id))
    set({ excluded: on ? rest : [...rest, ...shown.map(r => ({ id: r.p.id, reason: '' }))] })
  }
  const togglePin = r => set({ pinned: pinned.has(r.p.id) ? (f.pinned || []).filter(x => x !== r.p.id) : [...(f.pinned || []), r.p.id] })
  const deptsOf = r => ORDER.filter(d => r.p.items.some(i => i.department === d)).map(d => SHORT[d] || d).join('·')
  const Row = r => (
    <div key={r.p.id}>
      <div className={'ai-rr' + (r.off ? ' off' : '')}>
        <input type="checkbox" checked={!r.off} aria-label={r.title + ' 참고'} onChange={e => setOn(r, e.target.checked)} />
        <button type="button" className={'ai-star' + (pinned.has(r.p.id) ? ' on' : '')} disabled={r.off} title="꼭 참고: 대화와 덜 비슷해도 항상 AI에게 보냄" aria-label={r.title + ' 꼭 참고'} onClick={() => togglePin(r)}>{pinned.has(r.p.id) ? '★' : '☆'}</button>
        <b className="ai-rt" title={r.title}>{r.title}</b>
        <small>{r.kind === 'past' ? `${md2(stampFull(r.at).slice(0, 10))} ${r.c && r.c.close_type === '중단' ? '중단 종결' : '종결'}` : (r.p.created_by && db.people[r.p.created_by] ? db.people[r.p.created_by].name : '저장')} · 할 일 {r.p.items.length}건</small>
        <span className="ai-rd">{deptsOf(r)}</span>
        <button type="button" className="ai-rx" aria-expanded={!!open[r.p.id]} aria-label={r.title + ' 할 일 보기'} onClick={() => setOpen(o => ({ ...o, [r.p.id]: !o[r.p.id] }))}>{open[r.p.id] ? '▴' : '▾'}</button>
      </div>
      {open[r.p.id] && (
        <div className="ai-rexp">
          {ORDER.filter(d => r.p.items.some(i => i.department === d)).map(d => <div key={d}><b>{d}</b> {r.p.items.filter(i => i.department === d).map(i => i.title).join(' · ')}</div>)}
        </div>
      )}
    </div>
  )
  const past = shown.filter(r => r.kind === 'past'), saved = shown.filter(r => r.kind === 'saved')
  const links = f.type_links || []
  const setLinks = l => set({ type_links: l })
  const words = f.conf_words || []
  const addWord = () => { const w = word.trim(); if (!w) return; if (!words.includes(w)) set({ conf_words: [...words, w] }); setWord('') }
  const sampleW = words[0] || '배합비'
  return (
    <>
      <div className="ai-ref2">
        <div className="card adm-card ai-refl">
          <h2>참고할 배정 목록 <small className="us-sm">체크된 목록만 AI가 참고 · 새로 생긴 목록은 자동 체크</small></h2>
          <div className="ai-pf">
            <label>기간 <select value={f.past_months} onChange={e => set({ past_months: parseInt(e.target.value, 10) })}>
              {[3, 6, 12, 24, 36].map(m => <option key={m} value={m}>최근 {m}개월</option>)}
            </select></label>
            <label className="ck"><input type="checkbox" checked={!!f.skip_stopped} onChange={e => set({ skip_stopped: e.target.checked })} /> 중단 종결 제외</label>
            <input className="ai-search sm" value={q} placeholder="목록 찾기" aria-label="참고 목록 찾기" onChange={e => setQ(e.target.value)} />
            <button type="button" className="link" onClick={() => setAll(true)}>모두 체크</button>
            <button type="button" className="link muted-l" onClick={() => setAll(false)}>모두 해제</button>
          </div>
          <div className="ai-rl">
            <div className="ai-gh">종결된 변경에서 자동 추가 <span>· {past.length}건 중 {past.filter(r => !r.off).length}건 체크</span></div>
            {past.length ? past.map(Row) : <p className="ai-p muted ai-rnone">{q ? '찾는 목록이 없습니다' : '이 기간에 종결된 변경이 없습니다'}</p>}
            <div className="ai-gh">저장한 배정 목록 <span>· {saved.length}건 중 {saved.filter(r => !r.off).length}건 체크</span></div>
            {saved.length ? saved.map(Row) : <p className="ai-p muted ai-rnone">{q ? '찾는 목록이 없습니다' : '저장한 목록이 없습니다 (변경 등록 › 배정 목록에서 저장)'}</p>}
          </div>
          <p className="ai-p muted">★ 꼭 참고: 대화와 덜 비슷해도 항상 AI에게 보냄 · 체크를 끄면 참고 안 함 · ▾ 누르면 할 일 보기 · 지금 체크 {onN}건 · ★ {[...pinned].filter(id => rows.some(r => r.p.id === id && !r.off)).length}건</p>
        </div>

        <div className="ai-refr">
          <div className="card adm-card">
            <h2>자동 최적화 <small className="us-sm">다 고르지 않아도 됩니다</small></h2>
            <div className="ai-auto">
              <b>대화마다 서버가 알아서 고릅니다</b>
              <ol>
                <li>체크된 목록 중 대화(업체·제품·원료·포장지·띠지·박스 등)와 <b>가장 비슷한 목록</b> + ★ 목록만 AI에게 보냄</li>
                <li>비슷한 변경 여러 건에 <b>자주 배정된 할 일</b>은 '자주 쓰임'으로 알려줘서 먼저 고르게 함</li>
                <li>보내는 양이 줄어 비용↓, 엉뚱한 과거 변경 참고↓</li>
              </ol>
            </div>
            <div className="ai-pf">
              <label>한 번에 보낼 목록 <select value={f.send_n} onChange={e => set({ send_n: parseInt(e.target.value, 10) })}>
                {[5, 10, 15, 20, 30].map(n => <option key={n} value={n}>{n}건{n === 15 ? ' (추천)' : ''}</option>)}
              </select></label>
              <span className="ai-cnt">체크 <b>{onN}건</b></span>
            </div>
          </div>
          <div className="card adm-card">
            <h2>AI가 넣을 수 있는 할 일 <small className="us-sm">출처 규칙</small></h2>
            <ul className="ai-srcs">
              <li><b>기본 할 일</b> (관리자 › 기본 할 일)</li>
              <li><b>과거 변경에 실제로 배정됐던 할 일</b> <span className="ai-src">과거 변경에서</span></li>
              <li><b>저장한 배정 목록의 할 일</b> <span className="ai-src sv">저장한 목록에서</span></li>
            </ul>
            <p className="ai-p muted">세 곳 어디에도 없는 할 일은 AI가 만들지 않고, 서버가 한 번 더 걸러 뺍니다.</p>
          </div>
          <details className="card adm-card ai-adv">
            <summary>고급 · 변경 종류 → 배정 목록 연결 <span className="us-sm">(자동 최적화가 대신함 · 연결하면 우선)</span></summary>
            <p className="ai-p">대화에 이 종류의 낱말(예: '원료')이 나오면 연결한 목록을 꼭 보내고 먼저 참고합니다.</p>
            <table className="ai-links">
              <thead><tr><th>변경 종류</th><th aria-label="연결" /><th>먼저 참고할 배정 목록</th><th aria-label="삭제" /></tr></thead>
              <tbody>
                {links.map((l, i) => (
                  <tr key={i}>
                    <td><input value={l.kind} placeholder="예: 원료 변경" aria-label="변경 종류" onChange={e => setLinks(links.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))} /></td>
                    <td className="ar">→</td>
                    <td><select value={l.preset || ''} aria-label={(l.kind || '변경 종류') + ' 배정 목록'} onChange={e => setLinks(links.map((x, j) => (j === i ? { ...x, preset: e.target.value || null } : x)))}>
                      <option value="">— (연결 안 함)</option>
                      {db.presets.map(p => <option key={p.id} value={p.id}>{p.name} · {p.items.length}건</option>)}
                    </select></td>
                    <td><button type="button" className="ai-x" aria-label="종류 삭제" onClick={() => setLinks(links.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="link ai-addl" onClick={() => setLinks([...links, { kind: '', preset: null }])}>+ 종류 추가</button>
          </details>
        </div>
      </div>

      <div className="card adm-card">
        <h2>대외비 경고 단어 <small className="us-sm">입력에 있으면 보내기 전에 한 번 더 확인</small></h2>
        <p className="ai-p">AI로 보내는 글에 아래 단어가 들어 있으면 경고합니다.</p>
        <div className="ai-chips">
          {words.map(w => <span key={w} className="ai-chip">{w}<button type="button" aria-label={w + ' 삭제'} onClick={() => set({ conf_words: words.filter(x => x !== w) })}>✕</button></span>)}
          <input className="ai-chip-in" value={word} placeholder="+ 단어 추가" aria-label="대외비 단어 추가" onChange={e => setWord(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addWord() } }} onBlur={addWord} />
        </div>
        <div className="ai-pf">
          <span>단어가 있으면</span>
          <label className="ck"><input type="radio" name="cm" checked={f.conf_mode === 'warn'} onChange={() => set({ conf_mode: 'warn' })} /> 경고 후 보낼지 묻기</label>
          <label className="ck"><input type="radio" name="cm" checked={f.conf_mode === 'block'} onChange={() => set({ conf_mode: 'block' })} /> 보내기 막기</label>
        </div>
        <div className="ai-warn-pv">
          <div className="ai-ask-l">미리보기 · 사용자에게 뜨는 경고</div>
          <div className={'ai-warn' + (f.conf_mode === 'block' ? ' block' : '')}>
            {f.conf_mode === 'block'
              ? <>입력에 <b>"{sampleW}"</b>가 있어 보낼 수 없습니다. 대외비는 지우고 다시 보내주세요.</>
              : <>입력에 <b>"{sampleW}"</b>가 있습니다. 대외비가 AI 서비스로 전송될 수 있어요.</>}
            <span className="ai-warn-b"><button type="button" className="btn sm" tabIndex={-1}>고쳐서 보내기</button>{f.conf_mode !== 'block' && <button type="button" className="btn sm ghost" tabIndex={-1}>그래도 보내기</button>}</span>
          </div>
        </div>
      </div>
    </>
  )
}

/* ---------- 시험해 보기 ---------- */
function TestTab({ cfg, f, dirty, nf, setNf }) {
  const [dept, setDept] = useState(ORDER.includes('영업') ? '영업' : ORDER[0])
  const [unsaved, setUnsaved] = useState(true)
  const use = unsaved && dirty ? f : cfg
  const test = { dept, cfg: unsaved && dirty ? f : null, conf: { words: use.conf_words || [], mode: use.conf_mode } }
  const ai = nf.ai
  const d = ai && ai.draft
  const rules = (use.rules || []).filter(r => r.on && String(r.when || '').trim())
  const noteOf = id => (d && d.rule_notes ? d.rule_notes.find(n => n.rule === id) : null)
  const used = rules.map((r, i) => ({ r, i, n: noteOf(r.id) })).filter(x => x.n && x.n.used)
  const unused = rules.map((r, i) => ({ r, i, n: noteOf(r.id) })).filter(x => !x.n || !x.n.used)
  const userText = ai ? ai.msgs.filter(m => m.role === 'user').map(m => m.content).join('\n') : ''
  const hits = (use.conf_words || []).filter(w => w && userText.toLowerCase().includes(String(w).toLowerCase()))
  const info = ai && ai.info
  const linkName = d && d.link ? ((info && info.links || []).find(l => l.kind === d.link) || {}).name : null
  return (
    <>
      <div className="ai-tband">
        <b>시험 모드</b><span>실제 변경 등록 화면과 똑같이 동작하지만 아무것도 저장되지 않습니다</span>
        <label>등록하는 사람 <select value={dept} onChange={e => setDept(e.target.value)}>{ORDER.map(x => <option key={x} value={x}>{x} · 가상 사용자</option>)}</select></label>
        <label className="ck" title={dirty ? '저장하기 전에 바꾼 설정으로 결과를 확인합니다' : '바꾼 설정이 없습니다'}><input type="checkbox" checked={unsaved} onChange={e => setUnsaved(e.target.checked)} /> 저장 안 한 설정도 반영{!dirty && <small> (바꾼 것 없음)</small>}</label>
        <button type="button" className="btn sm ghost" onClick={() => setNf(emptyForm())}>처음부터 다시</button>
        <span className="ai-tcost">모델 {(MODELS.find(m => m.id === use.model) || { name: use.model }).name} · 이번 시험 약 {ai ? (ai.cost < 10 ? Number(ai.cost).toFixed(1) : won(ai.cost)) : 0}원</span>
      </div>
      <div className="ai-tgrid">
        <div className="ai-tmain">
          <NewChange nf={nf} setNf={setNf} test={test} onDone={() => {}} />
        </div>
        <aside className="card ai-tside">
          <h3>이번 결과에 쓰인 설정</h3>
          {!d ? <p className="muted">[AI로 작성] 탭에서 변경 내용을 보내면 여기에 어떤 기준·과거 변경·목록이 쓰였는지 표시됩니다.</p> : (
            <>
              <div className="ai-ts-k">확인 기준 (쓴 것)</div>
              {used.length ? <ul>{used.map(x => <li key={x.r.id}><b>{x.i + 1}</b> {x.r.when}{x.n.why && <small> — {x.n.why}</small>}</li>)}</ul> : <p className="muted">없음</p>}
              <div className="ai-ts-k">안 물은 기준</div>
              {unused.length ? <ul className="dim">{unused.map(x => <li key={x.r.id}><b>{x.i + 1}</b> {x.r.when}{x.n && x.n.why ? <small> — {x.n.why}</small> : <small> — 대화와 관계없음</small>}</li>)}</ul> : <p className="muted">없음</p>}
              <div className="ai-ts-k">자동으로 고른 목록 {info && info.picked ? `${info.picked.length}건` : ''}{info && info.refs_total ? <small> (체크 {info.refs_total}건 중)</small> : null}</div>
              {info && info.picked && info.picked.length ? (
                <ul>{info.picked.slice(0, 8).map(x => <li key={x.id}>{x.why.startsWith('꼭') ? '★ ' : '· '}{x.title}{x.kind === 'saved' ? ' (저장)' : ''} <small>— {x.why}</small>{d.refs.some(r => r.id === x.id) ? <small className="ai-used"> · 할 일 가져옴</small> : null}</li>)}
                  {info.picked.length > 8 && <li className="muted">· …{info.picked.length - 8}건</li>}</ul>
              ) : <p className="muted">없음 · 기본 할 일에서만 골랐어요</p>}
              {info && info.refs_total > (info.picked || []).length && <p className="muted">안 보냄 {info.refs_total - info.picked.length}건 (대화와 관계 적음)</p>}
              {info && info.freq && info.freq.length > 0 && <><div className="ai-ts-k">자주 쓰인 할 일</div><ul>{info.freq.map((x, i) => <li key={i}>{x.d} · {x.t} <small>({x.n}건)</small></li>)}</ul></>}
              <div className="ai-ts-k">변경 종류 → 배정 목록</div>
              <p>{d.link ? <>'{d.link}'{linkName ? <> → 「{linkName}」</> : ' (연결된 목록 없음)'}</> : '연결 없음'}</p>
              <div className="ai-ts-k">대외비 단어</div>
              <p>{hits.length ? hits.map(w => '"' + w + '"').join(', ') + ' (입력에 있었음)' : '없음'}</p>
            </>
          )}
          <div className="ai-ts-k">끝까지 해보기</div>
          <p className="muted">'이대로 양식에 채우기' → [직접 작성]에서 '등록'을 누르면, 실제처럼 미확인 확인창과 대화방 메모(AI 표시)까지 미리 보여주고 저장 없이 끝납니다.</p>
        </aside>
      </div>
    </>
  )
}

/* ---------- 사용 현황 ---------- */
const PER = [['month', '이번 달'], ['last', '지난달'], ['90', '최근 90일']]
function range(k) {
  const t = todayMid()
  if (k === 'month') return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)]
  if (k === 'last') return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))]
  return [iso(add(t, -89)), iso(t)]
}
function HBars({ rows, cls, unit = '' }) {
  const mx = Math.max(1, ...rows.map(r => r.n))
  return (
    <div className="ai-hb">
      {rows.map(r => (
        <div key={r.k} className="ai-hbr"><span className="l">{r.k}</span><span className="t"><i className={r.c || cls} style={{ width: (r.n ? Math.max(2, (r.n / mx) * 100) : 0) + '%' }} /></span><b className="n">{r.n.toLocaleString()}{unit}</b></div>
      ))}
    </div>
  )
}
const EDIT_ORDER = ['부서별 할 일', '제목', '대상 품목', '전환일', '변경 사유', '변경 내용', '관리 방식']
function UseTab() {
  const { toast } = useApp()
  const [per, setPer] = useState('month')
  const [u, setU] = useState(null)
  const [err, setErr] = useState('')
  const [from, to] = range(per)
  useEffect(() => {
    let alive = true
    setU(null)
    supabase.rpc('admin_ai_usage', { p_from: from, p_to: to }).then(({ data, error }) => {
      if (!alive) return
      if (error) setErr(errText(error)); else { setErr(''); setU(data) }
    })
    return () => { alive = false }
  }, [from, to])
  const rate = u && u.drafts ? Math.round((u.registered / u.drafts) * 100) : null
  const edited = u ? EDIT_ORDER.map(k => ({ k, n: u.edited[k] || 0 })).sort((a, b) => b.n - a.n) : []
  const weeks = u ? u.weeks || [] : []
  const wmax = Math.max(1, ...weeks.map(w => Number(w.cost)))
  const lim = u ? u.limit || 0 : 0

  async function excel() {
    if (!u) return
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const sh = (rows, name) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ 내용: '자료 없음' }]), name)
      sh([
        { 항목: '기간', 값: `${from} ~ ${to}` },
        { 항목: '초안 (AI로 작성 탭에서 만든 초안)', 값: u.drafts },
        { 항목: '등록까지 이어짐', 값: u.registered },
        { 항목: '등록까지 이어진 비율(%)', 값: rate ?? '' },
        { 항목: '평균 대화 (회)', 값: u.avg_turns ?? '' },
        { 항목: '추정 금액 (원, 시험 포함)', 값: Math.round(u.cost) },
        { 항목: '그중 시험해 보기 금액 (원)', 값: Math.round(u.cost_test) },
        { 항목: '시험해 보기 (회, 위 숫자에는 안 넣음)', 값: u.tests },
        { 항목: '이번 달 추정 금액 / 월 한도 (원)', 값: `${Math.round(u.month_cost)} / ${lim}` },
        { 항목: '참고', 값: '사람 이름은 저장하지 않습니다. 금액은 토큰 수로 계산한 추정치입니다.' },
      ], '요약')
      sh(weeks.map(w => ({ 주_시작: w.w, 추정금액_원: Math.round(w.cost) })), '주별 금액')
      sh(edited.map(r => ({ 칸: r.k, 고친_초안수: r.n })), '사람이 고친 칸')
      sh((u.by_dept || []).map(r => ({ 부서: r.dept, 초안수: r.n })), '부서별 초안')
      sh([{ 구분: '등록 전에 답함', 질문수: u.q_answered }, { 구분: '미확인으로 등록', 질문수: u.q_open }, { 구분: '그중 AI 메모로 남김', 질문수: u.q_open_memo }], '확인 질문')
      sh([{ 구분: '경고 뜸', 횟수: u.conf_warn }, { 구분: '고쳐서 보냄', 횟수: u.conf_fix }, { 구분: '그래도 보냄', 횟수: u.conf_send }], '대외비 경고')
      XLSX.writeFile(wb, `푸르온_AI초안_사용현황_${from}_${to}.xlsx`)
      toast('엑셀 파일을 내려받았습니다')
    } catch (e) { toast('내려받기에 실패했습니다: ' + errText(e)) }
  }

  return (
    <>
      <div className="us-period ai-per">
        <div className="seg" role="tablist" aria-label="기간">
          {PER.map(([k, l]) => <button key={k} type="button" role="tab" className={per === k ? 'on' : ''} onClick={() => setPer(k)}>{l}</button>)}
        </div>
        <span className="us-r mono">{from} ~ {to}</span>
        <span className="ai-per-r">사람 이름은 저장하지 않습니다 · 금액은 추정치<button type="button" className="btn sm ghost" disabled={!u} onClick={excel}>보고용 엑셀 받기</button></span>
      </div>
      {err && <p className="err">{err}</p>}
      {!u ? (!err && <p className="muted">불러오는 중…</p>) : (
        <>
          <div className="us-kpis">
            <div className="stat us-k"><div className="k">초안</div><div className="v">{u.drafts}<small> 건</small></div><div className="s">AI로 작성 탭에서 만든 초안</div></div>
            <div className="stat us-k"><div className="k">등록까지 이어짐</div><div className="v">{u.registered}{rate != null && <small className="ai-rate"> {rate}%</small>}</div><div className="s">나머지는 중간에 그만둠·직접 작성</div></div>
            <div className="stat us-k"><div className="k">평균 대화</div><div className="v">{u.avg_turns ?? '-'}<small> 회</small></div><div className="s">초안 1건당 보낸 횟수</div></div>
            <div className="stat us-k"><div className="k">추정 금액</div><div className="v">{won(u.cost)}<small> 원</small></div>
              {per === 'month' && <div className={'meter ai-meter' + (lim && u.cost >= lim ? ' over' : '')}><i style={{ width: (lim ? Math.min(100, Math.max(1.5, (u.cost / lim) * 100)) : 0) + '%' }} /></div>}
              <div className="s">{per === 'month' ? `한도 ${won(lim)}원 · ` : ''}시험 {won(u.cost_test)}원 포함</div></div>
            <div className="stat us-k"><div className="k">시험해 보기</div><div className="v">{u.tests}<small> 회</small></div><div className="s">위 숫자에는 안 넣고 금액만 포함</div></div>
          </div>
          <div className="ai-use3">
            <div className="card adm-card">
              <h2>주별 추정 금액 <small className="us-sm">최근 8주</small></h2>
              <div className="us-bars" role="img" aria-label={weeks.map(w => md2(w.w) + ' 주 ' + won(w.cost) + '원').join(', ')}>
                {weeks.map((w, i) => (
                  <div key={w.w} className={'us-b' + (i === weeks.length - 1 ? ' last' : '')}>
                    <span className="n">{Number(w.cost) ? won(w.cost) : ''}</span>
                    <i style={{ height: (Number(w.cost) ? Math.max(3, (Number(w.cost) / wmax) * 100) : 1.5) + '%' }} />
                    <span className="l">{md2(w.w)}</span>
                  </div>
                ))}
              </div>
              {u.first && <p className="note">사용 기록은 {u.first}부터 쌓였습니다. 금액은 원 단위 반올림.</p>}
            </div>
            <div className="card adm-card">
              <h2>사람이 자주 고친 칸 <small className="us-sm">AI가 어디서 자주 틀리는지</small></h2>
              <HBars rows={edited} cls="pu" />
              <p className="note">'부서별 할 일'을 자주 고치면 → 참고 제외할 과거 변경이 있는지, 배정 목록 연결이 맞는지 확인하세요.</p>
              <h3 className="us-h3">부서별 초안 수</h3>
              {(u.by_dept || []).length ? <HBars rows={u.by_dept.map(r => ({ k: r.dept, n: r.n }))} cls="bl" /> : <p className="muted">없음</p>}
            </div>
            <div className="card adm-card">
              <h2>확인 질문 처리</h2>
              <HBars rows={[{ k: '등록 전에 답함', n: u.q_answered, c: 'tq' }, { k: '미확인으로 등록', n: u.q_open, c: 'or' }]} />
              <p className="note">미확인 {u.q_open}개 중 {u.q_open_memo}개는 AI 메모로 대화방에 남김</p>
              <h3 className="us-h3">대외비 경고</h3>
              <HBars rows={[{ k: '경고 뜸', n: u.conf_warn, c: 'rd' }, { k: '고쳐서 보냄', n: u.conf_fix, c: 'tq' }, { k: '그래도 보냄', n: u.conf_send, c: 'gy' }]} />
              <p className="note">'그래도 보냄'이 많으면 경고 단어나 안내 문구를 손보세요.</p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
