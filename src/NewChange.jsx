import { useState } from 'react'
import { supabase, ORDER, SHORT, ITEM_TYPES } from './supabase.js'
import { useApp, Person, useWidth, WIDE } from './ctx.jsx'
import { errText, stampFull } from './util.js'

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
  }
}

export default function NewChange({ nf, setNf, onDone }) {
  const { db, uid, C, reload, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [pName, setPName] = useState('')
  const [pRename, setPRename] = useState('')
  const [edit, setEdit] = useState(null)        // { k, text } 할 일 내용 고치는 중
  const [drag, setDrag] = useState(null)        // { d, from, over }
  const wide = useWidth() >= WIDE
  const set = patch => setNf({ ...nf, ...patch })
  const tpls = db.templates.filter(t => t.active)

  // 할 일 한 줄: { k, dept, title, on, tpl(기본 할 일 id 또는 null=직접 추가), orig(기본 할 일 원래 문구) }
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
    const nx = { ...x, on }
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
    P.items.filter(i => ORDER.includes(i.department)).forEach(i => {     // 지금은 없는 부서의 할 일은 빼고
      let t = i.tpl && tpls.find(x => x.id === i.tpl && x.department === i.department && !used.has(x.id))
      if (!t) t = tpls.find(x => x.department === i.department && x.title === i.title && !used.has(x.id))
      if (t) { used.add(t.id); out.push(fromTpl(t, true, i.title)) } else out.push({ k: newK(), dept: i.department, title: i.title, on: true, tpl: null })
    })
    tpls.filter(t => !used.has(t.id)).forEach(t => out.push(fromTpl(t, false)))
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

  async function submit() {
    const items = nf.items.map(i => ({ type: i.type, name: i.name.trim(), target: i.target || '' })).filter(i => i.name)
    const err = !nf.title.trim() ? '제목을 입력해주세요.' : !nf.target ? '전환일을 골라주세요.'
      : !items.length ? '대상 품목을 1개 이상 입력해주세요.' : !pickedN ? '할 일을 1건 이상 배정해주세요.' : ''
    if (err) return set({ err })
    if (edit) return set({ err: '고치고 있는 할 일을 먼저 저장하거나 취소해주세요.' })
    const tasks = currentItems().map(i => ({ department: i.department, title: i.title }))
    if (byItem) {
      const names = items.map(i => i.name)
      if (new Set(names).size !== names.length) return set({ err: '같은 이름의 품목이 있습니다. 품목 이름을 서로 다르게 적어주세요.' })
      setBusy(true)
      const { data, error } = await supabase.rpc('create_group', {
        p_title: nf.title.trim(), p_description: nf.desc.trim(), p_reason: nf.reason.trim(),
        p_items: items.map(i => ({ type: i.type, name: i.name, target: i.target || nf.target })), p_tasks: tasks,
      })
      setBusy(false)
      if (error) return set({ err: errText(error) })
      await reload()
      toast(`등록 완료 · 품목 ${items.length}개 · 할 일 ${tasks.length * items.length}건이 배정되었습니다`)
      return onDone(data, true)
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('create_change', {
      p_title: nf.title.trim(), p_description: nf.desc.trim(), p_reason: nf.reason.trim(),
      p_target_date: nf.target, p_items: items, p_tasks: tasks,
    })
    setBusy(false)
    if (error) return set({ err: errText(error) })
    await reload()
    toast(`등록 완료 · 할 일 ${tasks.length}건이 배정되었습니다`)
    onDone(data)
  }

  const namedN = nf.items.filter(i => i.name.trim()).length
  const byItem = nf.mode === 'items' && namedN >= 2
  const opt = p => <option key={p.id} value={p.id}>{p.name}{p.fixed ? '' : ' · ' + p.items.length + '건'}</option>
  const sc0 = curP.source_change_id ? C(curP.source_change_id) : null

  return (
    <>
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
          {!nf.presetMode && (
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
          const ons = onRows(d), offs = list.filter(x => x.dept === d && !x.on)
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
                    {x.tpl
                      ? <input type="checkbox" id={'pk' + x.k} checked={on} aria-label={x.title + ' 배정'} onChange={e => toggle(x, e.target.checked)} />
                      : <span className="new">추가</span>}
                    {editing ? (
                      <span className="nr-ed">
                        <input autoFocus value={edit.text} aria-label="할 일 내용" onChange={e => setEdit({ ...edit, text: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); saveEdit() } if (e.key === 'Escape') setEdit(null) }} />
                        <span className="nr-eb"><button type="button" className="btn sm ghost" onClick={() => setEdit(null)}>취소</button><button type="button" className="btn sm" onClick={saveEdit}>저장</button></span>
                      </span>
                    ) : (
                      <label htmlFor={x.tpl ? 'pk' + x.k : undefined} className="nf-tt">{x.title}{x.tpl && x.title !== x.orig && <span className="nr-mod" title={'원래: ' + x.orig}>수정함</span>}</label>
                    )}
                    {!editing && (
                      <span className="nr-act">
                        {on && !wide && canMove && <>
                          <button type="button" className="nr-b" aria-label="위로" disabled={idx === 0} onClick={() => moveRow(d, idx, idx - 1)}>▲</button>
                          <button type="button" className="nr-b" aria-label="아래로" disabled={idx === n - 1} onClick={() => moveRow(d, idx, idx + 1)}>▼</button>
                        </>}
                        <button type="button" className="nr-b" aria-label={'내용 고치기: ' + x.title} title="내용 고치기" onClick={() => setEdit({ k: x.k, text: x.title })}>✎</button>
                        {!x.tpl && <button type="button" className="nr-b" aria-label="추가한 할 일 삭제" onClick={() => setList(list.filter(y => y.k !== x.k))}>✕</button>}
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
                <button type="button" className="link nf-plus" onClick={() => { setAddTitle(''); set({ addDept: d }) }}>+ {d} 할 일 추가</button>
              )}
            </section>
          )
        })}
      </div>
      {nf.err && <p className="nf-err">{nf.err}</p>}
      <button type="button" className="btn nf-go" disabled={busy} onClick={submit}>{busy ? '등록 중…' : byItem ? `변경 등록 · 품목 ${namedN}개 · 할 일 ${pickedN * namedN}건 배정` : `변경 등록 · 할 일 ${pickedN}건 배정`}</button>
      </div>
      </div>
    </>
  )
}
