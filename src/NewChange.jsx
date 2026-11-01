import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase, ORDER, SHORT, ITEM_TYPES } from './supabase.js'
import { useApp, Person, useWidth, WIDE } from './ctx.jsx'
import { errText, stampFull } from './util.js'
import AiDraft, { AiTag } from './AiDraft.jsx'
import { useAiPublic, memoFlag, defaultMemo, FIELD_LABEL, PV2F, md2 } from './ai.js'

// 품목 종류별 이름 예시
const NAME_HINT = {
  단품: '예: 교자만두 1kg',
  '번들/기획상품': '예: 교자만두 1kg×2 번들',
  띠지: '예: 교자만두 번들 띠지',
  박스: '예: 교자만두 6입 박스',
  원료: '예: 돼지고기 (국내산 → 스페인산)',
  기타: '품목 이름',
}

export function emptyForm() {
  return {
    title: '', desc: '', reason: '', target: '',
    items: [{ type: '단품', name: '' }],
    list: null,                 // 할 일 목록 (부서별 순서 그대로) — null이면 기본 목록
    mode: 'one',                // 'one' 하나로 관리 | 'items' 품목별로 관리 (묶음)
    presetSel: 'base', presetUsed: 'base', presetMode: null, presetErr: '',
    addDept: null, err: '',
    tab: 'manual',              // 'manual' 직접 작성 | 'ai' AI로 작성 (둘 사이를 오가도 내용 그대로)
    ai: null,                   // AI 대화·미리보기
    aiFill: null,               // 마지막으로 AI 초안을 양식에 채운 값 (직접 고친 칸을 알아보는 데 씀)
  }
}

// 칸 값 비교용
function sig(f, v) {
  if (f === 'items') return JSON.stringify((v || []).map(i => [i.type, String(i.name || '').trim(), i.target || '']).filter(x => x[1]))
  if (f === 'list') return JSON.stringify((v || []).filter(x => x.on).map(x => [x.dept, x.title]))
  return String(v || '').trim()
}

// 변경 등록. test = 관리자 '시험해 보기' { dept, cfg, conf } → 똑같이 동작하지만 저장하지 않음
export default function NewChange({ nf, setNf, onDone, test }) {
  const { db, uid, me, C, reload, toast } = useApp()
  const [ask, setAsk] = useState(null)          // 미확인 질문 확인창 { open, memoOn, memo, aiMemo }
  const [testDone, setTestDone] = useState(null) // 시험 등록 결과
  const pub = useAiPublic()
  const aiOn = test ? true : !!(pub && pub.enabled)
  const aiOver = !test && !!(pub && pub.over)
  const conf = test ? test.conf : { words: (pub && pub.conf_words) || [], mode: (pub && pub.conf_mode) || 'warn' }
  const tab = aiOn && !aiOver && nf.tab === 'ai' ? 'ai' : 'manual'
  const upd = fn => setNf(prev => fn(prev || nf))
  useEffect(() => {
    if (!ask && !testDone) return
    const k = e => { if (e.key === 'Escape') { setAsk(null); setTestDone(null) } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [ask, testDone])
  const [busy, setBusy] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [pName, setPName] = useState('')
  const [pRename, setPRename] = useState('')
  const [edit, setEdit] = useState(null)        // { k, text } 할 일 내용 고치는 중
  const [drag, setDrag] = useState(null)        // { d, from, over }
  const wide = useWidth() >= WIDE
  const set = patch => setNf({ ...nf, ...patch })
  const tpls = db.templates.filter(t => t.active)

  // 할 일 한 줄: { k, dept, title, on, tpl(기본 할 일 id 또는 null), orig(고치기 전 문구), plain(불러온 목록의 할 일 = 표시 없음), hidden(목록에 없어 숨긴 기본 할 일) }
  const fromTpl = (t, on = true, title) => ({ k: 't' + t.id, dept: t.department, title: title ?? t.title, on, tpl: t.id, orig: t.title })
  let seq = 0
  const newK = () => 'x' + Date.now().toString(36) + (seq++)
  const list = nf.list || [
    ...tpls.map(t => fromTpl(t, nf.picks && nf.picks[t.id] !== undefined ? nf.picks[t.id] : true)),
    ...(nf.extras || []).map(x => ({ k: newK(), dept: x.dept, title: x.title, on: true, tpl: null })),
  ]
  const setList = (l, extra) => set({ list: l, presetUsed: null, err: '', ...(extra || {}) })
  const pickedN = list.filter(x => x.on).length
  const onRows = d => list.filter(x => x.dept === d && x.on)
  // 부서 d 의 체크된 할 일 순서를 ids 순서로 바꿈 (체크 끈 줄은 그 자리에)
  const reorder = (d, keys) => {
    const q = keys.slice()
    const byK = Object.fromEntries(list.map(y => [y.k, y]))
    return list.map(x => (x.dept === d && x.on ? byK[q.shift()] : x))
  }
  const moveRow = (d, from, to) => {
    const ks = onRows(d).map(x => x.k)
    if (to < 0 || to >= ks.length || from === to) return
    const [m] = ks.splice(from, 1); ks.splice(to, 0, m)
    setList(reorder(d, ks))
  }
  // 체크 켜기·끄기: 켜면 그 부서 체크된 줄의 맨 끝으로
  const toggle = (x, on) => {
    let l = list.filter(y => y.k !== x.k)
    const nx = { ...x, on, hidden: false }
    if (on) {
      const last = l.map((y, i) => (y.dept === x.dept && y.on ? i : -1)).filter(i => i >= 0).pop()
      const at = last !== undefined ? last + 1 : l.findIndex(y => y.dept === x.dept)
      l.splice(at < 0 ? l.length : at, 0, nx)
    } else l = list.map(y => (y.k === x.k ? nx : y))
    setList(l)
  }
  const addRow = (d, title) => {
    const l = list.slice()
    const last = l.map((y, i) => (y.dept === d && y.on ? i : -1)).filter(i => i >= 0).pop()
    l.splice(last !== undefined ? last + 1 : l.length, 0, { k: newK(), dept: d, title, on: true, tpl: null })
    setList(l, { addDept: null })
  }
  const saveEdit = () => {
    const tx = edit.text.trim()
    if (!tx) return toast('할 일 내용을 입력해주세요')
    setList(list.map(y => (y.k === edit.k ? { ...y, title: tx } : y)))
    setEdit(null)
  }

  const base = { id: 'base', name: `기본 목록 (${tpls.length}건)`, fixed: true, items: tpls.map(t => ({ department: t.department, title: t.title })) }
  const presets = [base, ...db.presets]
  const curP = presets.find(p => p.id === nf.presetSel) || base
  const usedP = presets.find(p => p.id === nf.presetUsed)
  const gSaved = db.presets.filter(p => !p.source_change_id)
  const gClosed = db.presets.filter(p => p.source_change_id)

  // 지금 화면의 배정 → 목록 항목 (부서 순서 · 부서 안 순서 · 고친 문구 그대로)
  const currentItems = () => ORDER.flatMap(d => onRows(d).map(x => (x.tpl ? { department: d, title: x.title, tpl: x.tpl } : { department: d, title: x.title })))

  function loadPreset() {
    const P = curP
    const used = new Set(), out = []
    // 목록의 할 일은 모두 '보통 할 일'로 (추가·수정·해제 흔적 없이), 목록에 없는 기본 할 일은 숨김 → '기본 할 일 다시 넣기'로 꺼냄
    P.items.filter(i => ORDER.includes(i.department)).forEach(i => {     // 지금은 없는 부서의 할 일은 빼고
      let t = i.tpl && tpls.find(x => x.id === i.tpl && x.department === i.department && !used.has(x.id))
      if (!t) t = tpls.find(x => x.department === i.department && x.title === i.title && !used.has(x.id))
      if (t) used.add(t.id)
      out.push({ k: t ? 't' + t.id : newK(), dept: i.department, title: i.title, on: true, tpl: t ? t.id : null, orig: i.title, plain: true })
    })
    tpls.filter(t => !used.has(t.id)).forEach(t => out.push({ ...fromTpl(t, false), hidden: !P.fixed }))
    setEdit(null)
    setNf({ ...nf, list: out, picks: undefined, extras: undefined, presetUsed: P.id, presetMode: null, presetErr: '' })
    toast(`"${P.name.length > 24 ? P.name.slice(0, 24) + '…' : P.name}" 목록을 불러왔습니다`)
  }

  async function presetAction(kind) {
    const P = curP
    let res
    if (kind === 'save') {
      const nm = pName.trim(), items = currentItems()
      if (!nm) return set({ presetErr: '목록 이름을 입력해주세요.' })
      if (presets.some(x => x.name === nm)) return set({ presetErr: '같은 이름의 목록이 이미 있습니다.' })
      if (!items.length) return set({ presetErr: '저장할 할 일이 없습니다.' })
      res = await supabase.from('assign_presets').insert({ name: nm, items, created_by: uid }).select('id').single()
      if (res.error) return set({ presetErr: errText(res.error) })
      await reload()
      setNf({ ...nf, presetSel: res.data.id, presetUsed: res.data.id, presetMode: null, presetErr: '' })
      setPName('')
      return toast(`"${nm}" 배정 목록을 저장했습니다`)
    }
    if (kind === 'rename') {
      const nm = pRename.trim()
      if (!nm) return set({ presetErr: '이름을 입력해주세요.' })
      if (presets.some(x => x.name === nm && x.id !== P.id)) return set({ presetErr: '같은 이름의 목록이 이미 있습니다.' })
      res = await supabase.from('assign_presets').update({ name: nm, renamed: true, updated_at: new Date().toISOString() }).eq('id', P.id).select('id')
      if (res.error || !res.data.length) return set({ presetErr: res.error ? errText(res.error) : '권한이 없습니다.' })
      await reload()
      set({ presetMode: null, presetErr: '' })
      return toast('목록 이름을 수정했습니다')
    }
    if (kind === 'over') {
      const items = currentItems()
      if (!items.length) return set({ presetErr: '저장할 할 일이 없습니다.' })
      res = await supabase.from('assign_presets').update({ items, updated_at: new Date().toISOString() }).eq('id', P.id).select('id')
      if (res.error || !res.data.length) return set({ presetErr: res.error ? errText(res.error) : '권한이 없습니다.' })
      await reload()
      set({ presetUsed: P.id, presetMode: null, presetErr: '' })
      return toast(`목록을 ${items.length}건으로 수정했습니다`)
    }
    if (kind === 'del') {
      res = await supabase.from('assign_presets').delete().eq('id', P.id).select('id')
      if (res.error || !res.data.length) return set({ presetErr: res.error ? errText(res.error) : '권한이 없습니다.' })
      await reload()
      set({ presetSel: 'base', presetUsed: nf.presetUsed === P.id ? null : nf.presetUsed, presetMode: null, presetErr: '' })
      return toast(`"${P.name.length > 24 ? P.name.slice(0, 24) + '…' : P.name}" 목록을 삭제했습니다`)
    }
  }

  // AI 미리보기 → 양식 채우기 (사람이 직접 고친 칸은 그대로 둠)
  function fillFromAi() {
    const d = nf.ai && nf.ai.draft
    if (!d) return
    const used = new Set(), list = []
    ORDER.forEach(dp => {
      d.tasks.filter(t => t.department === dp && t.on).forEach(t => {
        const tp = t.source === 'template' && tpls.find(x => x.department === dp && x.title === t.title && !used.has(x.id))
        if (tp) { used.add(tp.id); list.push(fromTpl(tp, true)) }
        else list.push({ k: newK(), dept: dp, title: t.title, on: true, tpl: null, src: t.ref ? { title: t.ref.title, date: t.ref.date, saved: t.source === 'saved' } : null })
      })
      tpls.filter(x => x.department === dp && !used.has(x.id)).forEach(x => list.push(fromTpl(x, false)))
    })
    const byI = d.mode === 'items' && d.items.length >= 2
    const vals = {
      title: d.title || '', desc: d.description || '', reason: d.reason || '', target: d.target_date || '',
      mode: byI ? 'items' : 'one',
      items: d.items.length ? d.items.map(i => ({ type: i.type, name: i.name, target: byI ? (i.target || '') : '' })) : [{ type: '단품', name: '' }],
      list,
    }
    const aiVals = { ...vals }                   // AI가 낸 값 그대로 (사람이 고친 칸 통계용)
    const cur = { title: nf.title, desc: nf.desc, reason: nf.reason, target: nf.target, mode: nf.mode, items: nf.items, list: nf.list }
    const snap = nf.aiFill && nf.aiFill.snap
    const empty = { title: !nf.title.trim(), desc: !nf.desc.trim(), reason: !nf.reason.trim(), target: !nf.target, mode: !snap && nf.mode === 'one', items: nf.items.every(i => !i.name.trim()), list: !nf.list }
    const kept = []
    Object.keys(vals).forEach(f => {
      if (empty[f]) return
      const mine = snap ? sig(f, cur[f]) !== sig(f, snap[f]) : true
      if (mine && sig(f, cur[f]) !== sig(f, vals[f])) { kept.push(f); vals[f] = cur[f] }
    })
    setEdit(null)
    setNf({ ...nf, ...vals, tab: 'manual', err: '', presetUsed: null, picks: undefined, extras: undefined, addDept: null,
      aiFill: { snap: { ...vals }, ai: aiVals, session: nf.ai.session, turns: nf.ai.turns, questions: d.questions, memo: d.memo || '' } })
    window.scrollTo(0, 0)
    toast(kept.length ? `양식에 채웠어요 · 직접 고친 칸(${kept.map(f => FIELD_LABEL[f]).join(', ')})은 그대로 두었어요` : '양식에 채웠어요 · 내용을 확인한 뒤 등록해주세요')
  }
  // AI 초안 정보 (지금 대화가 채운 그 대화면 최신 질문 상태)
  const aiQ = () => {
    if (!nf.aiFill) return { questions: [], memo: '' }
    const live = nf.ai && nf.ai.session === nf.aiFill.session && nf.ai.draft
    return live ? { questions: nf.ai.draft.questions || [], memo: nf.ai.draft.memo || '' } : { questions: nf.aiFill.questions || [], memo: nf.aiFill.memo || '' }
  }
  // 사람이 고친 칸 (양식에서 + 미리보기에서)
  const aiEdited = () => {
    const snap = nf.aiFill.ai || nf.aiFill.snap
    const now = { title: nf.title, desc: nf.desc, reason: nf.reason, target: nf.target, mode: byItem ? 'items' : 'one', items: nf.items, list }
    const out = new Set(Object.keys(FIELD_LABEL).filter(f => sig(f, now[f]) !== sig(f, snap[f])).map(f => FIELD_LABEL[f]))
    const a = nf.ai && nf.ai.session === nf.aiFill.session ? nf.ai : null
    if (a) {
      Object.entries(a.locked || {}).forEach(([k, v]) => { if (v && PV2F[k]) out.add(FIELD_LABEL[PV2F[k]]) })
      if (Object.keys(a.taskEdits || {}).length) out.add(FIELD_LABEL.list)
    }
    return [...out]
  }

  async function submit(choice) {
    const items = nf.items.map(i => ({ type: i.type, name: i.name.trim(), target: i.target || '' })).filter(i => i.name)
    const err = !nf.title.trim() ? '제목을 입력해주세요.' : !nf.target ? '전환일을 골라주세요.'
      : !items.length ? '대상 품목을 1개 이상 입력해주세요.' : !pickedN ? '할 일을 1건 이상 배정해주세요.' : ''
    if (err) return set({ err })
    if (edit) return set({ err: '고치고 있는 할 일을 먼저 저장하거나 취소해주세요.' })
    const tasks = currentItems().map(i => ({ department: i.department, title: i.title }))
    if (byItem) {
      const names = items.map(i => i.name)
      if (new Set(names).size !== names.length) return set({ err: '같은 이름의 품목이 있습니다. 품목 이름을 서로 다르게 적어주세요.' })
    }
    // AI 초안으로 채운 경우: 확인 안 된 질문이 있으면 한 번 더 물어봄
    const q = aiQ()
    const open = q.questions.filter(x => x.status === 'open')
    if (nf.aiFill && !choice && open.length) {
      const m = (q.memo || '').trim() || defaultMemo(open)
      return setAsk({ open, memoOn: true, memo: m, aiMemo: m })
    }
    setAsk(null)
    const memo = choice && choice.memoOn && choice.memo.trim() ? { body: choice.memo.trim(), ai: memoFlag(choice.memo, choice.aiMemo) } : null
    if (test) {
      return setTestDone({ title: nf.title.trim(), items, byItem, tasks: tasks.length, open: open.length, memo, turns: nf.aiFill ? (nf.ai ? nf.ai.turns : nf.aiFill.turns) : 0, ai: !!nf.aiFill, edited: nf.aiFill ? aiEdited() : [] })
    }
    const after = async (id, isGroup) => {
      if (!nf.aiFill) return
      let posted = false
      if (memo) {
        const { error } = await supabase.from('messages').insert({ ...(isGroup ? { group_id: id } : { change_id: id }), user_id: uid, body: memo.body, ai: memo.ai })
        if (error) toast('메모를 대화방에 남기지 못했습니다: ' + errText(error)); else posted = true
      }
      const { error } = await supabase.rpc('ai_finish', {
        p_session: nf.aiFill.session, p_change: isGroup ? null : id, p_group: isGroup ? id : null, p_edited: aiEdited(),
        p_q_answered: q.questions.filter(x => x.status === 'answered').length, p_q_open: open.length, p_memo: posted,
      })
      if (error) console.warn('ai_finish', error.message)
    }
    if (byItem) {
      setBusy(true)
      const { data, error } = await supabase.rpc('create_group', {
        p_title: nf.title.trim(), p_description: nf.desc.trim(), p_reason: nf.reason.trim(),
        p_items: items.map(i => ({ type: i.type, name: i.name, target: i.target || nf.target })), p_tasks: tasks,
      })
      if (error) { setBusy(false); return set({ err: errText(error) }) }
      await after(data, true)
      setBusy(false)
      await reload()
      toast(`등록 완료 · 품목 ${items.length}개 · 할 일 ${tasks.length * items.length}건이 배정되었습니다`)
      return onDone(data, true)
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('create_change', {
      p_title: nf.title.trim(), p_description: nf.desc.trim(), p_reason: nf.reason.trim(),
      p_target_date: nf.target, p_items: items, p_tasks: tasks,
    })
    if (error) { setBusy(false); return set({ err: errText(error) }) }
    await after(data, false)
    setBusy(false)
    await reload()
    toast(`등록 완료 · 할 일 ${tasks.length}건이 배정되었습니다`)
    onDone(data)
  }

  const namedN = nf.items.filter(i => i.name.trim()).length
  const byItem = nf.mode === 'items' && namedN >= 2
  const opt = p => <option key={p.id} value={p.id}>{p.name}{p.fixed ? '' : ' · ' + p.items.length + '건'}</option>
  const sc0 = curP.source_change_id ? C(curP.source_change_id) : null

  const aiTurns = nf.ai ? nf.ai.turns : 0
  const tabsBar = aiOn && (
    <div className="nf-tabs">
      <div className="seg ai-seg" role="tablist" aria-label="작성 방식">
        <button type="button" role="tab" aria-selected={tab === 'manual'} className={tab === 'manual' ? 'on' : ''} onClick={() => set({ tab: 'manual' })}>직접 작성</button>
        <button type="button" role="tab" aria-selected={tab === 'ai'} className={tab === 'ai' ? 'on' : ''} disabled={aiOver}
          title={aiOver ? '이번 달 AI 사용 한도를 다 써서 다음 달 1일에 다시 켜집니다' : ''} onClick={() => set({ tab: 'ai' })}>
          ✦ AI로 작성{aiTurns > 0 && <em> · 대화 {aiTurns}</em>}
        </button>
      </div>
      <span className="nf-tabs-h">
        {aiOver ? '이번 달 AI 사용 한도를 다 써서 [AI로 작성]은 다음 달 1일에 다시 켜집니다'
          : tab === 'ai' ? '말로 설명하면 양식을 채워드립니다 · 등록은 직접 눌러야 저장됩니다'
            : '두 탭을 오가도 입력한 내용과 AI 대화는 그대로 남습니다'}
      </span>
      {tab === 'manual' && nf.aiFill && <span className="ai-badge">AI 초안으로 채움</span>}
    </div>
  )
  const dialogs = (ask || testDone) && createPortal(
    <>
      {ask && (
        <>
          <div className="scrim" onClick={() => setAsk(null)} />
          <div className="ai-ask" role="dialog" aria-modal="true" aria-label="확인 안 된 질문">
            <h3>확인 안 된 질문이 {ask.open.length}개 있습니다</h3>
            <ul className="ai-ask-q">{ask.open.map((x, i) => <li key={i}>{x.q}</li>)}</ul>
            <p className="ai-ask-s">AI 대화로 돌아가 답하면 초안에 바로 반영됩니다. 지금 등록해도 됩니다.</p>
            <label className="ai-ask-ck">
              <input type="checkbox" checked={ask.memoOn} onChange={e => setAsk({ ...ask, memoOn: e.target.checked })} />
              대화방에 내 메모로 남기기 <small>(다른 부서 부르기 없음)</small>
            </label>
            {ask.memoOn && (
              <div className="ai-ask-memo">
                <div className="ai-ask-who"><b>{me.name}</b> <AiTag kind={memoFlag(ask.memo, ask.aiMemo) || undefined} />{!memoFlag(ask.memo, ask.aiMemo) && <small>새로 쓴 글이라 AI 표시 없음</small>}<span>· {byItem ? '묶음 전체 대화' : '이 변경의 대화방'}에 남습니다</span></div>
                <textarea rows={3} value={ask.memo} aria-label="대화방에 남길 메모" onChange={e => setAsk({ ...ask, memo: e.target.value })} />
                <p className="ai-ask-h">AI가 쓴 메모입니다. 고쳐도 되고, 등록한 뒤에도 대화방에서 수정·삭제할 수 있어요.</p>
              </div>
            )}
            <div className="ai-ask-b">
              <button type="button" className="btn ghost" onClick={() => { setAsk(null); set({ tab: 'ai' }) }}>AI 대화로 돌아가기</button>
              <button type="button" className="btn" disabled={busy || (ask.memoOn && !ask.memo.trim())} onClick={() => submit({ memoOn: ask.memoOn, memo: ask.memo, aiMemo: ask.aiMemo })}>{busy ? '등록 중…' : '그래도 등록'}</button>
            </div>
          </div>
        </>
      )}
      {testDone && (
        <>
          <div className="scrim" onClick={() => setTestDone(null)} />
          <div className="ai-ask ai-tdone" role="dialog" aria-modal="true" aria-label="시험 등록 결과">
            <h3>시험 등록 결과 <span className="ai-tsave">저장하지 않았습니다</span></h3>
            <dl className="tg-dl">
              <dt>제목</dt><dd>{testDone.title}</dd>
              <dt>대상 품목</dt><dd>{testDone.items.length}개 · {testDone.byItem ? '품목별로 관리 (묶음)' : '하나로 관리'}</dd>
              <dt>할 일</dt><dd>{testDone.byItem ? `${testDone.tasks}건 × 품목 ${testDone.items.length}개 = ${testDone.tasks * testDone.items.length}건` : testDone.tasks + '건'}</dd>
              {testDone.ai && <><dt>AI 표시</dt><dd>제품·묶음 화면 <span className="ai-badge">AI 초안</span> · 이력 <span className="ai-badge">AI 초안으로 작성 · 대화 {testDone.turns}회</span></dd></>}
              {testDone.ai && <><dt>고친 칸</dt><dd>{testDone.edited.length ? testDone.edited.join(', ') : '없음'} <small className="muted">(사용 현황 '사람이 자주 고친 칸'에 들어감 · 시험은 빼고 셈)</small></dd></>}
            </dl>
            {testDone.memo ? (
              <div className="ai-tmemo">
                <div className="ai-ask-l">대화방에 남을 메모 ({testDone.byItem ? '묶음 전체 대화' : '이 변경의 대화방'})</div>
                <div className="msg"><div className="m-who"><b>{me.name}</b> <AiTag kind={testDone.memo.ai} /></div><div className="b-row"><div className="bub">{testDone.memo.body}</div></div></div>
              </div>
            ) : testDone.open > 0 && <p className="ai-ask-s">미확인 질문 {testDone.open}개 · 메모 남기지 않음</p>}
            <div className="ai-ask-b"><button type="button" className="btn" onClick={() => setTestDone(null)}>닫기</button></div>
          </div>
        </>
      )}
    </>, document.body)
  if (tab === 'ai') return <>{tabsBar}<AiDraft nf={nf} upd={upd} conf={conf} test={test} onFill={fillFromAi} />{dialogs}</>

  return (
    <>
      {tabsBar}
      {nf.aiFill && <div className="ai-filled">AI가 채운 내용입니다. 사실과 다른 곳이 없는지 확인한 뒤 등록해주세요. <button type="button" className="link" onClick={() => set({ tab: 'ai' })}>AI 대화로 돌아가기</button></div>}
      <div className="nf-wrap">
      <div className="nf-col">
      <div className="card nf">
        <h3 className="nf-t">1. 기본 정보</h3>
        <label htmlFor="nf-title">제목</label>
        <input id="nf-title" value={nf.title} onChange={e => set({ title: e.target.value, err: '' })} placeholder="예: 쿠팡_곰곰 교자만두_포장지 변경" />
        <p className="hint nf-hint">업체명_제품명_간단한 내용 순서로 적어주세요</p>
        <label htmlFor="nf-desc">변경 내용</label>
        <textarea id="nf-desc" rows={2} value={nf.desc} onChange={e => set({ desc: e.target.value })} placeholder="무엇이 어떻게 바뀌는지" />
        <label htmlFor="nf-reason">변경 사유</label>
        <input id="nf-reason" value={nf.reason} onChange={e => set({ reason: e.target.value })} placeholder="예: 고객사 요청" />
        <label htmlFor="nf-target">{byItem ? '공통 전환일' : '전환일 (변경 적용일)'} <span className="req">*필수 · 직접 골라주세요</span></label>
        <input id="nf-target" type="date" className={!nf.target && nf.err === '전환일을 골라주세요.' ? 'bad' : ''} value={nf.target} onChange={e => set({ target: e.target.value, err: '' })} />
      </div>

      <div className="card nf">
        <h3 className="nf-t">2. 대상 품목 <small>이번 변경이 적용되는 제품·자재를 빠짐없이</small></h3>
        {nf.items.map((it, i) => (
          <div className={'nf-item' + (byItem ? ' by-item' : '')} key={i}>
            <select value={it.type} aria-label="품목 종류" onChange={e => set({ items: nf.items.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) })}>
              {ITEM_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <input value={it.name} placeholder={NAME_HINT[it.type] || '품목 이름'} aria-label="품목 이름" onChange={e => set({ items: nf.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)), err: '' })} />
            {byItem && (
              <input type="date" className={'nf-idate' + (it.target && it.target !== nf.target ? ' own' : '')} value={it.target || nf.target || ''} aria-label={(it.name || '품목') + ' 전환일'} title="이 품목만 전환일이 다르면 바꾸세요"
                onChange={e => set({ items: nf.items.map((x, j) => (j === i ? { ...x, target: e.target.value === nf.target ? '' : e.target.value } : x)) })} />
            )}
            {nf.items.length > 1 && <button type="button" className="x" aria-label="품목 삭제" onClick={() => set({ items: nf.items.filter((_, j) => j !== i) })}>✕</button>}
          </div>
        ))}
        <button type="button" className="pill" onClick={() => set({ items: [...nf.items, { type: nf.items.length ? nf.items[nf.items.length - 1].type : '단품', name: '' }] })}>+ 품목 추가</button>
        {namedN >= 2 && (
          <div className="nf-mode">
            <div className="nm-h">관리 방식</div>
            <div className="nm-seg" role="radiogroup" aria-label="관리 방식">
              <button type="button" role="radio" aria-checked={!byItem} className={!byItem ? 'on' : ''} onClick={() => set({ mode: 'one', err: '' })}><b>하나로 관리</b><small>할 일·대화 1세트</small></button>
              <button type="button" role="radio" aria-checked={byItem} className={byItem ? 'on' : ''} onClick={() => set({ mode: 'items', err: '' })}><b>품목별로 관리</b><small>품목마다 할 일·대화·상태 따로</small></button>
            </div>
            {byItem
              ? <p className="nm-note">아래 할 일 <b>{pickedN}건</b>이 품목 <b>{namedN}개</b>에 똑같이 배정됩니다 → 모두 <b>{pickedN * namedN}건</b>. 품목마다 전환일이 다르면 품목 옆 날짜를 바꾸세요. 등록 후 품목 추가·빼기, 품목별 할 일 추가 배정도 됩니다.</p>
              : <p className="nm-note">품목 {namedN}개를 변경 1건으로 묶어 할 일 {pickedN}건만 배정합니다.</p>}
          </div>
        )}
      </div>

      </div>
      <div className="nf-col">
      <div className="card nf">
        <h3 className="nf-t">3. 부서별 할 일 배정 <small>체크해서 빼거나 추가하고, {wide ? '⋮⋮ 를 끌어' : '▲▼ 로'} 순서를, ✎ 로 내용을 바꿀 수 있습니다 (이번 변경에만 적용)</small></h3>
        <div className="pbox">
          <div className="pb-h"><b>배정 목록</b><span>저장한 목록이나 종결된 변경의 배정을 불러와서 쓸 수 있습니다</span></div>
          <div className="pb-row">
            <select aria-label="배정 목록 선택" value={curP.id} onChange={e => set({ presetSel: e.target.value, presetMode: null, presetErr: '' })}>
              {opt(base)}
              {gSaved.length > 0 && <optgroup label="저장한 목록">{gSaved.map(opt)}</optgroup>}
              {gClosed.length > 0 && <optgroup label="종결된 변경에서 자동 추가">{gClosed.map(opt)}</optgroup>}
            </select>
            <button type="button" className="btn sm" onClick={loadPreset}>불러오기</button>
          </div>
          {curP.source_change_id ? (
            <div className="pb-card">
              <span className="pb-tag">종결된 변경</span>
              <b className="pb-nm">{curP.name}</b>
              <dl className="tg-dl">
                {sc0 && <><dt>제목</dt><dd>{sc0.title}</dd><dt>대상 품목</dt><dd>{sc0.itemsText}</dd><dt>변경 내용</dt><dd>{sc0.description || '-'}</dd></>}
                <dt>종결일</dt><dd>{stampFull(curP.closed_at).slice(0, 10)}{sc0 && sc0.close_type === '중단' ? ' (중단 종결)' : ''}</dd>
                <dt>할 일</dt><dd>{curP.items.length}건 · {ORDER.filter(d => curP.items.some(i => i.department === d)).map(d => SHORT[d] + ' ' + curP.items.filter(i => i.department === d).length).join(' · ')}</dd>
              </dl>
            </div>
          ) : (
            <div className="pb-meta">
              {curP.fixed ? '기본 목록은 수정·삭제할 수 없습니다. 바꿔 쓰려면 고친 뒤 새 목록으로 저장하세요.' : <>저장: <Person id={curP.created_by} /> · 할 일 {curP.items.length}건</>}
            </div>
          )}
          {usedP && <div className="pb-meta"><b>지금 적용: {usedP.name}</b></div>}
          {nf.presetMode === 'save' && (
            <div className="pb-form">
              <label htmlFor="p-name">새 배정 목록 이름</label>
              <input id="p-name" autoFocus value={pName} onChange={e => setPName(e.target.value)} placeholder="예: 원료 변경용" />
              <p className="note">아래에 체크·추가된 할 일 {pickedN}건이 지금 순서와 고친 내용 그대로 함께 저장됩니다.</p>
              {nf.presetErr && <p className="err">{nf.presetErr}</p>}
              <div className="pb-row"><button type="button" className="btn sm" onClick={() => presetAction('save')}>저장</button><button type="button" className="btn sm ghost" onClick={() => set({ presetMode: null })}>취소</button></div>
            </div>
          )}
          {nf.presetMode === 'rename' && (
            <div className="pb-form">
              <label htmlFor="p-rn">목록 이름 수정</label>
              <textarea id="p-rn" rows={3} autoFocus value={pRename} onChange={e => setPRename(e.target.value)} />
              {nf.presetErr && <p className="err">{nf.presetErr}</p>}
              <div className="pb-row"><button type="button" className="btn sm" onClick={() => presetAction('rename')}>이름 저장</button><button type="button" className="btn sm ghost" onClick={() => set({ presetMode: null })}>취소</button></div>
            </div>
          )}
          {nf.presetMode === 'over' && (
            <div className="pb-form">
              <p>"<b>{curP.name}</b>"의 할 일을 아래에 지금 체크·추가된 <b>{pickedN}건</b>으로 바꿀까요?</p>
              {nf.presetErr && <p className="err">{nf.presetErr}</p>}
              <div className="pb-row"><button type="button" className="btn sm" onClick={() => presetAction('over')}>덮어쓰기</button><button type="button" className="btn sm ghost" onClick={() => set({ presetMode: null })}>취소</button></div>
            </div>
          )}
          {nf.presetMode === 'del' && (
            <div className="pb-form danger">
              <p>"<b>{curP.name}</b>" 목록을 삭제할까요? 이미 등록된 변경에는 영향이 없습니다.</p>
              {nf.presetErr && <p className="err">{nf.presetErr}</p>}
              <div className="pb-row"><button type="button" className="btn sm warn" onClick={() => presetAction('del')}>삭제</button><button type="button" className="btn sm ghost" onClick={() => set({ presetMode: null })}>취소</button></div>
            </div>
          )}
          {!nf.presetMode && !test && (
            <div className="pb-row">
              <button type="button" className="pill" onClick={() => { setPName(''); set({ presetMode: 'save', presetErr: '' }) }}>현재 배정을 새 목록으로 저장</button>
              {!curP.fixed && (
                <>
                  <button type="button" className="pill" onClick={() => { setPRename(curP.name); set({ presetMode: 'rename', presetErr: '' }) }}>이름 수정</button>
                  <button type="button" className="pill" onClick={() => set({ presetMode: 'over', presetErr: '' })}>현재 배정으로 덮어쓰기</button>
                  <button type="button" className="pill stop" onClick={() => set({ presetMode: 'del', presetErr: '' })}>삭제</button>
                </>
              )}
            </div>
          )}
        </div>

        {ORDER.map(d => {
          const ons = onRows(d), offs = list.filter(x => x.dept === d && !x.on && !x.hidden)
          const hid = list.filter(x => x.dept === d && x.hidden)
          const n = ons.length
          const canMove = n > 1
          return (
            <section key={d} className={'dept nf-d' + (n === 0 ? ' none' : '')}>
              <div className="grp"><span className="dn">{d}</span><span className="st">{n ? n + '건 배정' : '배정 없음'}</span></div>
              {[...ons, ...offs].map((x, idx) => {
                const on = x.on
                const editing = edit && edit.k === x.k
                const dragOk = on && canMove && wide && !edit
                return (
                  <div key={x.k}
                    className={'nf-row nr2' + (on ? '' : ' off') + (x.tpl ? '' : ' add') + (editing ? ' editing' : '') + (drag && drag.d === d && drag.over === idx && drag.from !== idx ? ' over' : '') + (drag && drag.d === d && drag.from === idx ? ' dragging' : '')}
                    draggable={dragOk}
                    onDragStart={dragOk ? e => { try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.k) } catch (_) {} setDrag({ d, from: idx, over: idx }) } : undefined}
                    onDragOver={on && drag && drag.d === d ? e => { e.preventDefault(); if (drag.over !== idx) setDrag({ ...drag, over: idx }) } : undefined}
                    onDrop={on && drag && drag.d === d ? e => { e.preventDefault(); moveRow(d, drag.from, idx); setDrag(null) } : undefined}
                    onDragEnd={() => setDrag(null)}>
                    {wide && <span className={'grip' + (dragOk ? '' : ' no')} aria-hidden="true">⋮⋮</span>}
                    <span className="tno">{on ? idx + 1 : '–'}</span>
                    {x.tpl || x.plain
                      ? <input type="checkbox" id={'pk' + x.k} checked={on} aria-label={x.title + ' 배정'} onChange={e => toggle(x, e.target.checked)} />
                      : <span className="new">추가</span>}
                    {editing ? (
                      <span className="nr-ed">
                        <input autoFocus value={edit.text} aria-label="할 일 내용" onChange={e => setEdit({ ...edit, text: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); saveEdit() } if (e.key === 'Escape') setEdit(null) }} />
                        <span className="nr-eb"><button type="button" className="btn sm ghost" onClick={() => setEdit(null)}>취소</button><button type="button" className="btn sm" onClick={saveEdit}>저장</button></span>
                      </span>
                    ) : (
                      <label htmlFor={x.tpl || x.plain ? 'pk' + x.k : undefined} className="nf-tt">{x.title}{x.orig && x.title !== x.orig && <span className="nr-mod" title={'원래: ' + x.orig}>수정함</span>}
                        {x.src && (x.src.saved
                          ? <><span className="ai-src sv">저장한 목록에서</span><small className="ai-srcl sv">출처: 저장한 목록 「{x.src.title}」</small></>
                          : <><span className="ai-src">과거 변경에서</span><small className="ai-srcl">출처: 「{x.src.title}」 ({md2(x.src.date)})</small></>)}</label>
                    )}
                    {!editing && (
                      <span className="nr-act">
                        {on && !wide && canMove && <>
                          <button type="button" className="nr-b" aria-label="위로" disabled={idx === 0} onClick={() => moveRow(d, idx, idx - 1)}>▲</button>
                          <button type="button" className="nr-b" aria-label="아래로" disabled={idx === n - 1} onClick={() => moveRow(d, idx, idx + 1)}>▼</button>
                        </>}
                        <button type="button" className="nr-b" aria-label={'내용 고치기: ' + x.title} title="내용 고치기" onClick={() => setEdit({ k: x.k, text: x.title })}>✎</button>
                        {!x.tpl && !x.plain && <button type="button" className="nr-b" aria-label="추가한 할 일 삭제" onClick={() => setList(list.filter(y => y.k !== x.k))}>✕</button>}
                      </span>
                    )}
                  </div>
                )
              })}
              {nf.addDept === d ? (
                <div className="nf-add">
                  <input autoFocus value={addTitle} onChange={e => setAddTitle(e.target.value)} placeholder="할 일 내용" aria-label="추가할 할 일"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (addTitle.trim()) addRow(d, addTitle.trim()) } }} />
                  <button type="button" className="btn sm" onClick={() => {
                    if (!addTitle.trim()) return toast('할 일 내용을 입력해주세요')
                    addRow(d, addTitle.trim())
                  }}>추가</button>
                  <button type="button" className="btn sm ghost" onClick={() => set({ addDept: null })}>취소</button>
                </div>
              ) : (
                <div className="nf-plusrow">
                  <button type="button" className="link nf-plus" onClick={() => { setAddTitle(''); set({ addDept: d }) }}>+ {d} 할 일 추가</button>
                  {hid.length > 0 && (
                    <details className="nf-hid">
                      <summary>기본 할 일 다시 넣기 ({hid.length})</summary>
                      <div className="nf-hid-list">{hid.map(x => <button type="button" key={x.k} onClick={() => toggle(x, true)}>+ {x.title}</button>)}</div>
                    </details>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
      {nf.err && <p className="nf-err">{nf.err}</p>}
      <button type="button" className="btn nf-go" disabled={busy} onClick={() => submit()}>{busy ? '등록 중…' : byItem ? `변경 등록 · 품목 ${namedN}개 · 할 일 ${pickedN * namedN}건 배정` : `변경 등록 · 할 일 ${pickedN}건 배정`}</button>
      </div>
      </div>
      {dialogs}
    </>
  )
}
