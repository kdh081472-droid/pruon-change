import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, ORDER } from './supabase.js'
import { useApp } from './ctx.jsx'
import { errText, stampFull, iso, add, todayMid, hasAll } from './util.js'
import NewChange, { emptyForm } from './NewChange.jsx'
import { resetAiPublic, md2 } from './ai.js'

// 관리자 모드 › AI 초안 설정: 켜기·기준 / 참고·경고 / 시험해 보기 / 사용 현황
const SUBS = [['on', '켜기·기준'], ['ref', '참고·경고'], ['test', '시험해 보기'], ['use', '사용 현황']]
const SUBT = {
  on: '켜기·한도·확인 필요 기준',
  ref: '참고할 과거 변경·변경 종류별 배정 목록·대외비 경고',
  test: '실제 변경 등록과 똑같이 동작, 저장 안 됨',
  use: '이름 없이 숫자만',
}
const KEYS = ['enabled', 'monthly_limit', 'max_questions', 'rules', 'past_months', 'closed_only', 'skip_stopped', 'excluded', 'type_links', 'conf_words', 'conf_mode', 'model', 'price_in', 'price_out', 'price_cache_read', 'price_cache_write', 'usd_krw']
const pick = c => Object.fromEntries(KEYS.map(k => [k, c[k]]))
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
        <summary>비용 계산 기준 (고급) · 모델 {f.model} · 환율 {won(f.usd_krw)}원</summary>
        <p className="ai-p">추정 금액 = 쓴 토큰 수 × 단가(미국 달러, 100만 토큰당) × 환율. AI 회사 가격이나 환율이 바뀌면 여기 숫자만 고치면 됩니다. 실제 청구 금액은 AI 회사 사이트에서 확인하세요.</p>
        <div className="ai-adv-g">
          <label>모델<input value={f.model} onChange={e => set({ model: e.target.value })} /></label>
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

/* ---------- 참고·경고 ---------- */
function usePast(f) {
  const [past, setPast] = useState(null)
  const k = JSON.stringify([f.past_months, f.closed_only, f.skip_stopped, f.excluded])
  useEffect(() => {
    let alive = true
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('admin_ai_past', { p_months: parseInt(f.past_months, 10) || 12, p_closed_only: !!f.closed_only, p_skip_stopped: !!f.skip_stopped, p_excluded: f.excluded || [] })
      if (alive) setPast(error ? { err: errText(error) } : data)
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [k])
  return past
}

function RefTab({ f, set }) {
  const { db } = useApp()
  const past = usePast(f)
  const [q, setQ] = useState('')
  const [word, setWord] = useState('')
  const ex = f.excluded || []
  const exIds = new Set(ex.map(x => x.id))
  const titleOf = id => (db.groupMap[id] ? db.groupMap[id].title + ' (묶음)' : db.changeMap[id] ? db.changeMap[id].title : '(삭제된 변경)')
  const cands = useMemo(() => {
    if (!q.trim()) return []
    const xs = [...db.changes.filter(c => !c.group_id).map(c => ({ id: c.id, title: c.title, at: c.created_at, g: false })), ...db.groups.map(g => ({ id: g.id, title: g.title, at: g.created_at, g: true }))]
    return xs.filter(x => !exIds.has(x.id) && hasAll(x.title, q)).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8)
  }, [q, db, f.excluded])
  const links = f.type_links || []
  const setLinks = l => set({ type_links: l })
  const words = f.conf_words || []
  const addWord = () => { const w = word.trim(); if (!w) return; if (!words.includes(w)) set({ conf_words: [...words, w] }); setWord('') }
  const sampleW = words[0] || '배합비'
  return (
    <>
      <div className="adm-two ai-two-c">
        <div className="card adm-card">
          <h2>참고할 과거 변경 <small className="us-sm">'과거 변경에서' 할 일 제안의 유일한 출처</small></h2>
          <p className="ai-p">AI는 여기서 정한 과거 변경에 실제로 배정됐던 할 일과 기본 할 일에서만 고릅니다. 잘못 등록된 건은 '참고 제외'로 빼주세요.</p>
          <div className="ai-pf">
            <label>기간 <select value={f.past_months} onChange={e => set({ past_months: parseInt(e.target.value, 10) })}>
              {[3, 6, 12, 24, 36].map(m => <option key={m} value={m}>최근 {m}개월</option>)}
            </select></label>
            <label className="ck"><input type="checkbox" checked={!!f.closed_only} onChange={e => set({ closed_only: e.target.checked })} /> 종결된 건만</label>
            <label className="ck"><input type="checkbox" checked={!!f.skip_stopped} onChange={e => set({ skip_stopped: e.target.checked })} /> 중단 종결 제외</label>
            <span className="ai-cnt">{!past ? '세는 중…' : past.err ? past.err : <>지금 참고 대상 <b>{past.total}건</b></>}</span>
          </div>
          {past && !past.err && past.total > 40 && <p className="ai-p muted">AI에게는 이 중 최근 40건만 보냅니다 (비용·정확도).</p>}
          <h3 className="ai-h3">참고 제외 {ex.length}건</h3>
          {ex.length > 0 && (
            <table className="ai-exl">
              <thead><tr><th>변경</th><th>제외 사유</th><th aria-label="되돌리기" /></tr></thead>
              <tbody>
                {ex.map((x, i) => (
                  <tr key={x.id}>
                    <td>{titleOf(x.id)}</td>
                    <td><input value={x.reason || ''} placeholder="예: 테스트로 등록한 건" aria-label="제외 사유" onChange={e => set({ excluded: ex.map((y, j) => (j === i ? { ...y, reason: e.target.value } : y)) })} /></td>
                    <td><button type="button" className="link" onClick={() => set({ excluded: ex.filter((_, j) => j !== i) })}>되돌리기</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <input className="ai-search" value={q} placeholder="제외할 변경 찾기 (제목 검색)" aria-label="제외할 변경 찾기" onChange={e => setQ(e.target.value)} />
          {cands.length > 0 && (
            <ul className="ai-cands">
              {cands.map(c => (
                <li key={c.id}><span>{c.title}{c.g && <em> 묶음</em>} <small>{md2(stampFull(c.at).slice(0, 10))}</small></span>
                  <button type="button" className="btn sm ghost" onClick={() => { set({ excluded: [...ex, { id: c.id, reason: '' }] }); setQ('') }}>제외</button></li>
              ))}
            </ul>
          )}
          {q.trim() && !cands.length && <p className="ai-p muted">찾는 변경이 없습니다.</p>}
        </div>

        <div className="card adm-card">
          <h2>변경 종류와 배정 목록 연결 <small className="us-sm">어떤 할 일을 먼저 켤지 참고</small></h2>
          <p className="ai-p">이 종류의 변경이면 연결한 배정 목록을 먼저 참고합니다. 단, 목록에 있어도 <b>기본 할 일·과거 변경에 없는 할 일은 제안하지 않습니다.</b></p>
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
          {!links.length && <p className="ai-p muted">아직 연결한 종류가 없습니다. 없어도 AI는 대화와 과거 변경을 보고 고릅니다.</p>}
          <button type="button" className="link ai-addl" onClick={() => setLinks([...links, { kind: '', preset: null }])}>+ 종류 추가</button>
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
        <span className="ai-tcost">이번 시험 약 {ai ? won(ai.cost) : 0}원</span>
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
              <div className="ai-ts-k">참고한 과거 변경</div>
              <p>{d.refs.length}건{info ? ` · 조건에 맞는 ${info.past_total}건 중 최근 ${info.past_sent}건을 AI에게 보냄` : ''}{info && info.excluded_n ? ` · 제외 ${info.excluded_n}건은 안 봄` : ''}</p>
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
