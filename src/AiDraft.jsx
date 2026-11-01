import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase, ORDER, ITEM_TYPES } from './supabase.js'
import { useApp, useWidth, WIDE } from './ctx.jsx'
import { callDraft, confHit, newSession, tkey } from './ai.js'

// 대화방 메모의 AI 표시 (이름 옆 작은 알약)
export function AiTag({ kind }) {
  if (!kind) return null
  return kind === 'ai_edit'
    ? <span className="ai-tag" title="AI가 작성하고 사람이 고친 메모">✦ AI · 수정</span>
    : <span className="ai-tag" title="AI가 작성한 메모">✦ AI</span>
}
// 제품·묶음 화면의 AI 초안 표시
export function AiDraftBadge({ turns, long }) {
  if (!turns) return null
  return long
    ? <span className="ai-badge" title="변경 등록 [AI로 작성] 탭에서 만든 초안으로 등록했습니다">AI 초안으로 작성 · 대화 {turns}회</span>
    : <span className="ai-badge" title={'AI 초안으로 작성 · 대화 ' + turns + '회 (등록은 사람이 확인하고 누름)'}>AI 초안</span>
}

// 글자 수만큼 자동으로 늘어나는 한 줄 칸 (긴 제목도 다 보이게). Enter로 줄 바꾸지 않음
export function Grow({ value, className, onKeyDown, ...rest }) {
  const ref = useRef(null)
  const fit = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px' } }
  useLayoutEffect(fit, [value])
  useEffect(() => { window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit) }, [])
  return <textarea ref={ref} rows={1} value={value} className={(className || '') + ' grow'} {...rest}
    onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); if (onKeyDown) onKeyDown(e) }} />
}

// 미리보기·양식 위에 한 번만: 어느 배정 목록에서 가져왔는지
export function srcOf(d) {
  if (!d) return null
  if (d.base) return { id: d.base.id, title: d.base.title, n: d.base.n, saved: true, more: 0, all: [d.base.title] }
  const rs = d.refs || []
  return rs.length ? { id: null, title: rs[0].title, saved: rs[0].kind === 'saved', more: rs.length - 1, all: rs.map(x => x.title) } : null
}

export function emptyAi() {
  return { session: newSession(), msgs: [], draft: null, locked: {}, taskEdits: {}, changed: [], cost: 0, turns: 0, info: null }
}

const FIELDS = ['title', 'description', 'reason', 'target_date', 'mode', 'items']
const EXAMPLE = '풀무원 내수용 만두 3종(메밀김치지짐속, 탱글물만두속, 육즙듬뿍만두속) 원료를 조미1에서 조미2로 바꿔요. 풀무원이 원료 공급처를 바꾸면서 요청한 거고, 12월 15일부터 생산분이에요.'

// 새 초안 + 지금 미리보기 → 직접 고친 칸·사람이 켜고 끈 할 일은 그대로 두고 합침. 바뀐 칸 목록도 같이
export function mergeDraft(prev, next, locked, edits) {
  const d = { ...next, items: (next.items || []).map(i => ({ ...i })), questions: next.questions || [], refs: next.refs || [] }
  if (prev) FIELDS.forEach(f => { if (locked && locked[f]) d[f] = prev[f] })
  if (d.mode === 'items' && d.items.length < 2) d.mode = 'one'
  let tasks = (next.tasks || []).map(t => ({ ...t, on: true }))
  Object.entries(edits || {}).forEach(([k, e]) => {
    const i = tasks.findIndex(t => tkey(t) === k)
    if (i >= 0) tasks[i] = { ...tasks[i], on: e.on }
    else if (e.on) tasks.push({ ...e.t, on: true, mine: true })
  })
  tasks = [...ORDER.flatMap(dp => tasks.filter(t => t.department === dp)), ...tasks.filter(t => !ORDER.includes(t.department))]
  d.tasks = tasks
  d.skipped = skippedOf(tasks, next.skipped)
  const ch = []
  if (prev) {
    ['title', 'description', 'reason', 'target_date', 'mode'].forEach(f => { if ((prev[f] || '') !== (d[f] || '')) ch.push(f) })
    d.items.forEach((it, i) => {
      const p = prev.items[i]
      if (!p || p.name !== it.name || p.type !== it.type) ch.push('item:' + i)
      if (!p || (p.target || '') !== (it.target || '')) ch.push('itarget:' + i)
    })
    const pk = new Set((prev.tasks || []).filter(t => t.on).map(tkey))
    d.tasks.forEach(t => { if (t.on && !pk.has(tkey(t))) ch.push('task:' + tkey(t)) })
    d.questions.forEach((q, i) => { const p = (prev.questions || []).find(x => x.q === q.q); if (!p || p.status !== q.status || (p.answer || '') !== (q.answer || '')) ch.push('q:' + i) })
  }
  return { draft: d, changed: ch }
}
function skippedOf(tasks, given) {
  const has = new Set(tasks.filter(t => t.on).map(t => t.department))
  const why = Object.fromEntries((given || []).map(s => [s.department, s.reason]))
  return ORDER.filter(dp => !has.has(dp)).map(dp => ({
    department: dp,
    reason: tasks.some(t => t.department === dp) ? '할 일을 모두 뺐어요' : (why[dp] || '이번 대화 내용으로는 이 부서 할 일을 고르지 않았어요'),
  }))
}
const offTasks = ai => Object.values(ai.taskEdits || {}).filter(e => !e.on).map(e => ({ department: e.t.department, title: e.t.title }))

export function SrcLine({ s, form, now }) {
  if (!s) return null
  return (
    <div className="ai-srcline" title={s.all.join(', ')}>
      ✦ {form ? 'AI 초안이 가져온 배정 목록' : '가져온 배정 목록'} <b>「{s.title}」</b>
      {s.more > 0 && <span> 외 {s.more}건</span>}
      {s.n ? <span> · 저장한 목록 · {s.n}건</span> : null}
      {now && <span> · 지금 적용</span>}
    </div>
  )
}

// **굵게** 정도만
function Txt({ s }) {
  return String(s || '').split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p))
}

// [AI로 작성] 탭: 왼쪽 대화 · 오른쪽 미리보기
//  upd(fn): nf를 최신 값 기준으로 고침 · conf: { words, mode } 대외비 단어 · test: 관리자 시험해 보기 { dept, cfg }
export default function AiDraft({ nf, upd, conf, test, onFill }) {
  const { db, toast } = useApp()
  const wide = useWidth() >= WIDE
  const ai = nf.ai || emptyAi()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sec, setSec] = useState(0)                 // 기다린 초
  useEffect(() => { if (!busy) return setSec(0); const t0 = Date.now(); const id = setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 500); return () => clearInterval(id) }, [busy])
  const [warn, setWarn] = useState(null)           // { word, block }
  const [view, setView] = useState('chat')          // 휴대폰: 대화 / 미리보기
  const [reset, setReset] = useState(false)
  const boxRef = useRef(null)
  const inRef = useRef(null)
  const tpls = db.templates.filter(t => t.active)
  const setAi = fn => upd(n => ({ ...n, ai: fn(n.ai || ai) }))
  useEffect(() => { if (!nf.ai) upd(n => (n.ai ? n : { ...n, ai })) }, [])          // 처음 열면 대화 번호(session) 만들어 둠
  useEffect(() => { const b = boxRef.current; if (b) b.scrollTop = b.scrollHeight }, [ai.msgs.length, busy, view])

  const logConf = kind => { supabase.rpc('ai_conf', { p_session: ai.session, p_kind: kind, p_test: !!test }).then(() => {}) }

  async function send(force, again) {
    const q = (again ?? text).trim()
    if (!q || busy) return
    if (q.length > 1500) return toast('한 번에 1500자까지 보낼 수 있습니다')
    const hit = confHit(q, conf && conf.words)
    if (hit && !force) { setWarn({ word: hit, block: conf.mode === 'block' }); logConf('warn'); return }
    if (hit && force) logConf('send')
    setWarn(null)
    const hist = ai.msgs.filter(m => !m.err && !m.failed).map(({ role, content }) => ({ role, content }))
    const msgs = [...hist, { role: 'user', content: q }]
    setAi(a => ({ ...a, msgs: [...a.msgs.filter(m => !(again && m.failed && m.content === q)), { role: 'user', content: q }] }))
    if (!again) setText('')
    setBusy(true)
    try {
      const r = await callDraft({
        session: ai.session, messages: msgs, draft: ai.draft, locked: ai.locked, off_tasks: offTasks(ai),
        ...(test ? { test: true, dept: test.dept, cfg: test.cfg || null } : {}),
      })
      setAi(a => {
        const { draft, changed } = mergeDraft(a.draft, r.draft, a.locked, a.taskEdits)
        return { ...a, msgs: [...a.msgs, { role: 'assistant', content: r.reply }], draft, changed,
          cost: r.session_cost ?? (a.cost + (r.cost || 0)), turns: r.turn ?? (a.turns + 1), info: r.info || a.info, dropped: r.dropped || 0 }
      })
    } catch (e) {
      setAi(a => {
        const ms = a.msgs.slice()
        for (let i = ms.length - 1; i >= 0; i--) if (ms[i].role === 'user') { ms[i] = { ...ms[i], failed: true }; break }
        return { ...a, msgs: [...ms, { role: 'assistant', content: String((e && e.message) || e), err: true }] }
      })
    }
    setBusy(false)
    setTimeout(() => inRef.current && inRef.current.focus(), 30)
  }

  // 미리보기 칸 직접 고치기 → 그 칸은 AI가 다시 바꾸지 않음
  const editField = (f, v) => setAi(a => ({ ...a, draft: { ...a.draft, [f]: v }, locked: { ...a.locked, [f]: true }, changed: a.changed.filter(x => x !== f) }))
  const editItem = (i, patch) => setAi(a => ({
    ...a, draft: { ...a.draft, items: a.draft.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) },
    locked: { ...a.locked, items: true }, changed: a.changed.filter(x => x !== 'item:' + i && x !== 'itarget:' + i),
  }))
  const addItem = () => setAi(a => {
    const its = a.draft.items
    return { ...a, draft: { ...a.draft, items: [...its, { type: its.length ? its[its.length - 1].type : '단품', name: '', target: '' }] }, locked: { ...a.locked, items: true } }
  })
  const removeItem = i => setAi(a => ({
    ...a, draft: { ...a.draft, items: a.draft.items.filter((_, j) => j !== i) }, locked: { ...a.locked, items: true },
    changed: a.changed.filter(x => !/^i(tem|target):/.test(x)),
  }))
  const toggleTask = (t, on) => setAi(a => {
    const taskEdits = { ...a.taskEdits, [tkey(t)]: { on, t: { department: t.department, title: t.title, source: t.source, ref: t.ref } } }
    const tasks = a.draft.tasks.map(x => (tkey(x) === tkey(t) ? { ...x, on } : x))
    return { ...a, taskEdits, draft: { ...a.draft, tasks, skipped: skippedOf(tasks, a.draft.skipped) } }
  })
  const addDept = d => setAi(a => {
    const add = tpls.filter(x => x.department === d).map(x => ({ department: d, title: x.title, source: 'template' }))
    if (!add.length) { toast(d + ' 기본 할 일이 없습니다. 양식에 채운 뒤 직접 추가해주세요'); return a }
    const taskEdits = { ...a.taskEdits }
    add.forEach(t => { taskEdits[tkey(t)] = { on: true, t } })
    const tasks = [...a.draft.tasks.filter(x => x.department !== d), ...add.map(t => ({ ...t, on: true, mine: true }))]
    const sorted = [...ORDER.flatMap(dp => tasks.filter(t => t.department === dp)), ...tasks.filter(t => !ORDER.includes(t.department))]
    return { ...a, taskEdits, draft: { ...a.draft, tasks: sorted, skipped: skippedOf(sorted, a.draft.skipped) } }
  })
  const restart = () => { upd(n => ({ ...n, ai: emptyAi() })); setReset(false); setWarn(null); setText('') }

  const d = ai.draft
  const ch = new Set(ai.changed || [])
  const lk = ai.locked || {}
  const cls = (f, base = '') => base + (ch.has(f) ? ' chg' : '') + (lk[f] ? ' mine' : '')
  const Lbl = ({ f, children }) => <label className="ai-l">{children}{lk[f] && <span className="ai-mine" title="직접 고친 칸은 AI가 다시 바꾸지 않습니다">직접 고침</span>}</label>
  const byItem = d && d.mode === 'items' && d.items.length >= 2

  const chat = (
    <div className="card ai-chat">
      <div className="ai-ch-h">
        <b>AI와 대화</b>
        {ai.msgs.length > 0 && !test && <button type="button" className="ai-rsb" onClick={() => setReset(true)}>↺ 새로 시작</button>}
        {reset && (
          <div className="ai-rspop" role="dialog" aria-label="새로 시작">
            <b>대화와 미리보기를 모두 지울까요?</b>
            <p>양식([직접 작성])에 이미 채운 내용은 그대로 남습니다.</p>
            <div><button type="button" className="btn sm ghost" onClick={() => setReset(false)}>취소</button><button type="button" className="btn sm ai-rsgo" onClick={restart}>지우고 새로 시작</button></div>
          </div>
        )}
      </div>
      <div className="ai-msgs" ref={boxRef} aria-live="polite">
        {ai.msgs.length === 0 && (
          <div className="ai-hello">
            <p><b>어떤 변경인지 편하게 말로 적어주세요.</b> 업체·제품·무엇이 어떻게 바뀌는지·<b>왜 바뀌는지(사유)</b>·언제부터인지 정도면 충분합니다. 모르는 건 비워 두셔도 돼요.</p>
            <button type="button" className="ai-ex" onClick={() => { setText(EXAMPLE); setTimeout(() => inRef.current && inRef.current.focus(), 20) }}>예: {EXAMPLE}</button>
            <p className="ai-hello-s">할 일은 기본 할 일·과거 변경·저장한 배정 목록에서만 골라요. 등록은 양식에 채운 뒤 직접 눌러야 저장됩니다.</p>
          </div>
        )}
        {ai.msgs.map((m, i) => (
          <div key={i} className={'ai-m ' + m.role + (m.err ? ' err' : '') + (m.failed ? ' failed' : '')}>
            <Txt s={m.content} />
            {m.failed && !busy && i === ai.msgs.map(x => x.failed).lastIndexOf(true) && <button type="button" className="link ai-again" onClick={() => send(true, m.content)}>다시 보내기</button>}
          </div>
        ))}
        {busy && <div className="ai-m assistant typing"><i /><i /><i /><span>{sec < 4 ? '참고 목록을 고르는 중…' : '초안을 쓰는 중…'} {sec > 0 && <em className="ai-sec">{sec}초</em>}</span></div>}
      </div>
      {warn && (
        <div className={'ai-warn' + (warn.block ? ' block' : '')} role="alert">
          {warn.block
            ? <>입력에 <b>"{warn.word}"</b>가 있어 보낼 수 없습니다. 대외비는 지우고 다시 보내주세요.</>
            : <>입력에 <b>"{warn.word}"</b>가 있습니다. 대외비가 AI 서비스로 전송될 수 있어요.</>}
          <span className="ai-warn-b">
            <button type="button" className="btn sm" onClick={() => { logConf('fix'); setWarn(null); inRef.current && inRef.current.focus() }}>고쳐서 보내기</button>
            {!warn.block && <button type="button" className="btn sm ghost" onClick={() => send(true)}>그래도 보내기</button>}
          </span>
        </div>
      )}
      <p className="ai-note">배합비 같은 대외비는 적지 마세요. 입력 내용은 AI 서비스로 전송됩니다.</p>
      <div className="ai-in">
        <textarea ref={inRef} rows={3} value={text} disabled={busy} aria-label="AI에게 보낼 내용"
          placeholder={ai.msgs.length ? '고칠 내용을 말로 적어주세요 (예: 생산 할 일에 재고 확인도 넣어줘)' : '어떤 변경인지 적어주세요'}
          onChange={e => { setText(e.target.value); if (warn) setWarn(null) }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(false) } }} />
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => send(false)}>보내기</button>
      </div>
    </div>
  )

  const fieldsCol = d && (
    <div className="ai-col">
      <Lbl f="title">제목</Lbl>
      <Grow className={cls('title', 'ai-f')} value={d.title} aria-label="제목 (미리보기)" onChange={e => editField('title', e.target.value)} />
      <div className="ai-two">
        <div><Lbl f="description">변경 내용</Lbl><textarea rows={3} className={cls('description', 'ai-f')} value={d.description} aria-label="변경 내용 (미리보기)" onChange={e => editField('description', e.target.value)} /></div>
        <div><Lbl f="reason">변경 사유</Lbl><textarea rows={3} className={cls('reason', 'ai-f')} value={d.reason} placeholder="(비어 있음)" aria-label="변경 사유 (미리보기)" onChange={e => editField('reason', e.target.value)} /></div>
      </div>
      <Lbl f="items">대상 품목</Lbl>
      {d.items.length === 0 ? <p className="ai-empty-s">아직 품목이 없어요. 대화로 알려주거나 아래에서 추가하세요.</p> : (
        <table className={'ai-items' + (byItem ? ' by' : '')}>
          <thead><tr><th>#</th><th>종류</th><th>품목</th>{byItem && <th>전환일</th>}<th aria-label="빼기" /></tr></thead>
          <tbody>
            {d.items.map((it, i) => (
              <tr key={i}>
                <td className="n">{i + 1}</td>
                <td><select className={'ai-f sm' + (ch.has('item:' + i) ? ' chg' : '')} value={it.type} aria-label={(i + 1) + '번 품목 종류'} onChange={e => editItem(i, { type: e.target.value })}>{ITEM_TYPES.map(t => <option key={t}>{t}</option>)}</select></td>
                <td><input className={'ai-f sm' + (ch.has('item:' + i) ? ' chg' : '')} value={it.name} aria-label={(i + 1) + '번 품목 이름'} onChange={e => editItem(i, { name: e.target.value })} /></td>
                {byItem && <td className="dc"><input type="date" className={'ai-f sm mono' + (ch.has('itarget:' + i) ? ' chg' : '') + (it.target ? ' own' : '')} value={it.target || d.target_date || ''} aria-label={(i + 1) + '번 품목 전환일'}
                  onChange={e => editItem(i, { target: e.target.value === d.target_date ? '' : e.target.value })} /></td>}
                <td className="ixc"><button type="button" className="ai-ix" aria-label={(i + 1) + '번 품목 빼기'} onClick={() => removeItem(i)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="ai-itf">
        <button type="button" className="link" onClick={addItem}>+ 품목 추가</button>
        {d.items.length >= 2 && (
          <div className="ai-seg2" role="radiogroup" aria-label="관리 방식 (미리보기)">
            <button type="button" role="radio" aria-checked={!byItem} className={!byItem ? 'on' : ''} onClick={() => editField('mode', 'one')}>하나로 관리</button>
            <button type="button" role="radio" aria-checked={byItem} className={byItem ? 'on' : ''} onClick={() => editField('mode', 'items')}>품목별로 관리</button>
          </div>
        )}
        {lk.mode && <span className="ai-mine">직접 고침</span>}
      </div>
      <Lbl f="target_date">{byItem ? '공통 전환일' : '전환일'}</Lbl>
      <input type="date" className={cls('target_date', 'ai-f mono ai-date') + (d.target_date ? '' : ' empty')} value={d.target_date || ''} aria-label="전환일 (미리보기)" onChange={e => editField('target_date', e.target.value)} />
      {!d.target_date && <span className="ai-need">전환일 미정 · 양식에서 꼭 골라야 등록됩니다</span>}

      <div className="ai-l">확인 필요 · <span className="ai-sub">등록하는 분께만 여쭙니다 · 미확인이어도 등록할 수 있어요</span></div>
      {d.questions.length === 0 ? <p className="ai-empty-s">확인할 질문이 없어요.</p> : (
        <ul className="ai-qs">
          {d.questions.map((q, i) => (
            <li key={i} className={(q.status === 'answered' ? 'ok' : 'open') + (ch.has('q:' + i) ? ' chg' : '')}>
              {q.status === 'answered'
                ? <><b className="ai-qi">✓</b>{q.q} → <b>{q.answer || '답함'}</b></>
                : <><b className="ai-qi">?</b>{q.q} → <b className="ai-qo">미확인</b></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const shownDepts = d ? ORDER.filter(dp => d.tasks.some(t => t.department === dp)) : []
  const tasksCol = d && (
    <div className="ai-col">
      <div className="ai-l">부서별 할 일</div>
      <SrcLine s={srcOf(d)} />
      {shownDepts.map(dp => (
        <section key={dp} className="ai-dept">
          <b className="ai-dn">{dp}</b>
          {d.tasks.filter(t => t.department === dp).map(t => (
            <label key={tkey(t)} className={'ai-t' + (t.on ? '' : ' off') + (ch.has('task:' + tkey(t)) ? ' chg' : '')}>
              <input type="checkbox" checked={t.on} onChange={e => toggleTask(t, e.target.checked)} />
              <span className="ai-tt">{t.title}</span>
            </label>
          ))}
        </section>
      ))}
      {d.skipped.length > 0 && (
        <div className="ai-skips">
          {d.skipped.map(s => (
            <div key={s.department} className="ai-skip"><b>{s.department}:</b> {s.reason} <button type="button" className="link" onClick={() => addDept(s.department)}>+ 넣기</button></div>
          ))}
        </div>
      )}
    </div>
  )

  const preview = (
    <div className="card ai-pv">
      <div className="ai-pv-h">
        <b>미리보기</b><span className="ai-badge">AI 초안</span>
        <span className="ai-pv-hint">고친 곳은 노랗게 · 칸을 눌러 직접 고쳐도 됩니다</span>
        <button type="button" className="btn ai-fill" disabled={!d || busy} onClick={onFill}>이대로 양식에 채우기</button>
      </div>
      {!d ? (
        <div className="ai-pv-empty">
          <p>왼쪽에 변경 내용을 말로 적어 보내면 여기에 초안이 만들어집니다.</p>
          <ul><li>제목·변경 내용·사유·대상 품목·전환일</li><li>부서별 할 일</li><li>확인이 필요한 것 (등록하는 분께만 질문)</li></ul>
        </div>
      ) : (
        <>
          <div className="ai-pv-g">{fieldsCol}{tasksCol}</div>
        </>
      )}
    </div>
  )

  if (wide) return <div className="ai-wrap">{chat}{preview}</div>
  return (
    <div className="ai-wrap ai-ph">
      <div className="seg ai-vseg" role="tablist" aria-label="보기">
        <button type="button" role="tab" className={view === 'chat' ? 'on' : ''} onClick={() => setView('chat')}>대화</button>
        <button type="button" role="tab" className={view === 'pv' ? 'on' : ''} onClick={() => setView('pv')}>미리보기{d && ai.changed.length > 0 && view !== 'pv' ? ' •' : ''}</button>
      </div>
      {view === 'chat' ? chat : preview}
      {view === 'chat' && d && <button type="button" className="btn ghost ai-tov" onClick={() => setView('pv')}>미리보기 보기 ›</button>}
    </div>
  )
}
