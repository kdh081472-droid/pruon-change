import { useState } from 'react'
import { supabase, ORDER, SHORT, ITEM_TYPES } from './supabase.js'
import { useApp, Person } from './ctx.jsx'
import { add, dayTxt, diffDays, iso, parse, todayMid, errText, stampFull } from './util.js'

export function emptyForm() {
  return {
    title: '', desc: '', reason: '', target: iso(add(todayMid(), 35)),
    items: [{ type: '단품', name: '' }],
    picks: {}, days: {}, extras: [],
    presetSel: 'base', presetUsed: 'base', presetMode: null, presetErr: '',
    addDept: null, err: '',
  }
}

export default function NewChange({ nf, setNf, onDone }) {
  const { db, uid, C, reload, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addDate, setAddDate] = useState('')
  const [pName, setPName] = useState('')
  const [pRename, setPRename] = useState('')
  const set = patch => setNf({ ...nf, ...patch })
  const tpls = db.templates.filter(t => t.active)
  const picked = t => nf.picks[t.id] !== undefined ? nf.picks[t.id] : true
  const daysOf = t => nf.days[t.id] !== undefined ? nf.days[t.id] : t.days_before
  const tgt = nf.target ? parse(nf.target) : null
  const pickedN = tpls.filter(picked).length + nf.extras.length

  const base = { id: 'base', name: `기본 · 포장지 변경 (${tpls.length}건)`, fixed: true, items: tpls.map(t => ({ department: t.department, title: t.title, days: t.days_before })) }
  const presets = [base, ...db.presets]
  const curP = presets.find(p => p.id === nf.presetSel) || base
  const usedP = presets.find(p => p.id === nf.presetUsed)
  const gSaved = db.presets.filter(p => !p.source_change_id)
  const gClosed = db.presets.filter(p => p.source_change_id)

  // 지금 화면의 배정 → 목록 항목
  const currentItems = () => {
    if (!tgt) return null
    return [
      ...tpls.filter(picked).map(t => ({ department: t.department, title: t.title, days: daysOf(t) })),
      ...nf.extras.map(x => ({ department: x.dept, title: x.title, days: diffDays(nf.target, x.date) })),
    ]
  }

  function loadPreset() {
    const P = curP
    const t0 = tgt || add(todayMid(), 35)
    const picks = {}, days = {}
    tpls.forEach(t => {
      const f = P.items.find(i => i.department === t.department && i.title === t.title)
      picks[t.id] = !!f
      days[t.id] = f ? f.days : t.days_before
    })
    const extras = P.items
      .filter(i => !tpls.some(t => t.department === i.department && t.title === i.title))
      .map(i => ({ dept: i.department, title: i.title, date: iso(add(t0, -i.days)) }))
    setNf({ ...nf, picks, days, extras, presetUsed: P.id, presetMode: null, presetErr: '' })
    toast(`"${P.name.length > 24 ? P.name.slice(0, 24) + '…' : P.name}" 목록을 불러왔습니다`)
  }

  async function presetAction(kind) {
    const P = curP
    let res
    if (kind === 'save') {
      const nm = pName.trim(), items = currentItems()
      if (!nm) return set({ presetErr: '목록 이름을 입력해주세요.' })
      if (presets.some(x => x.name === nm)) return set({ presetErr: '같은 이름의 목록이 이미 있습니다.' })
      if (!items) return set({ presetErr: '전환일을 먼저 정해야 마감 일수를 저장할 수 있습니다.' })
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
      if (!items) return set({ presetErr: '전환일을 먼저 정해야 마감 일수를 저장할 수 있습니다.' })
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

  function changeTarget(v) {
    // 전환일을 바꾸면 직접 추가한 할 일 마감도 같은 날수만큼 이동
    let extras = nf.extras
    if (nf.target && v) {
      const sh = diffDays(v, nf.target)
      extras = extras.map(x => ({ ...x, date: iso(add(parse(x.date), sh)) }))
    }
    set({ target: v, extras })
  }

  async function submit() {
    const items = nf.items.map(i => ({ type: i.type, name: i.name.trim() })).filter(i => i.name)
    const err = !nf.title.trim() ? '제목을 입력해주세요.' : !nf.target ? '전환일을 골라주세요.'
      : !items.length ? '대상 품목을 1개 이상 입력해주세요.' : !pickedN ? '할 일을 1건 이상 배정해주세요.' : ''
    if (err) return set({ err })
    const tasks = [
      ...tpls.filter(picked).map(t => ({ department: t.department, title: t.title, due_date: iso(add(tgt, -daysOf(t))) })),
      ...nf.extras.map(x => ({ department: x.dept, title: x.title, due_date: x.date })),
    ]
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

  const opt = p => <option key={p.id} value={p.id}>{p.name}{p.fixed ? '' : ' · ' + p.items.length + '건'}</option>
  const sc0 = curP.source_change_id ? C(curP.source_change_id) : null

  return (
    <>
      <div className="card nf">
        <h3 className="nf-t">1. 기본 정보</h3>
        <label htmlFor="nf-title">제목</label>
        <input id="nf-title" value={nf.title} onChange={e => set({ title: e.target.value, err: '' })} placeholder="예: 곰곰 교자만두 → 교자만두 포장지 변경" />
        <label htmlFor="nf-desc">변경 내용</label>
        <textarea id="nf-desc" rows={2} value={nf.desc} onChange={e => set({ desc: e.target.value })} placeholder="무엇이 어떻게 바뀌는지" />
        <label htmlFor="nf-reason">변경 사유</label>
        <input id="nf-reason" value={nf.reason} onChange={e => set({ reason: e.target.value })} placeholder="예: 고객사 요청" />
        <label htmlFor="nf-target">신규 포장지 전환일</label>
        <input id="nf-target" type="date" value={nf.target} onChange={e => changeTarget(e.target.value)} />
      </div>

      <div className="card nf">
        <h3 className="nf-t">2. 대상 품목 <small>연관 품목을 빠짐없이</small></h3>
        {nf.items.map((it, i) => (
          <div className="nf-item" key={i}>
            <select value={it.type} aria-label="품목 종류" onChange={e => set({ items: nf.items.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) })}>
              {ITEM_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <input value={it.name} placeholder="품목명" aria-label="품목명" onChange={e => set({ items: nf.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)), err: '' })} />
            {nf.items.length > 1 && <button type="button" className="x" aria-label="품목 삭제" onClick={() => set({ items: nf.items.filter((_, j) => j !== i) })}>✕</button>}
          </div>
        ))}
        <button type="button" className="pill" onClick={() => set({ items: [...nf.items, { type: '번들/기획상품', name: '' }] })}>+ 품목 추가</button>
      </div>

      <div className="card nf">
        <h3 className="nf-t">3. 부서별 할 일 배정 <small>체크해서 빼거나 추가하고, 마감일은 눌러서 바꾸세요</small></h3>
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
              {curP.fixed ? '기본 목록은 설정 > 기본 할 일에서 고칩니다 (여기서는 수정·삭제 불가)' : <>저장: <Person id={curP.created_by} /> · 할 일 {curP.items.length}건</>}
            </div>
          )}
          {usedP && <div className="pb-meta"><b>지금 적용: {usedP.name}</b></div>}
          {nf.presetMode === 'save' && (
            <div className="pb-form">
              <label htmlFor="p-name">새 배정 목록 이름</label>
              <input id="p-name" autoFocus value={pName} onChange={e => setPName(e.target.value)} placeholder="예: 김말이 박스 변경용" />
              <p className="note">아래에 체크·추가된 할 일 {pickedN}건이 바꾼 마감 일수(전환 며칠 전)까지 함께 저장됩니다.</p>
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
              <p>"<b>{curP.name}</b>"의 할 일을 아래에 지금 체크·추가된 <b>{pickedN}건</b>(바꾼 마감 일수 포함)으로 바꿀까요?</p>
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
          const rows = tpls.filter(t => t.department === d)
          const ex = nf.extras.map((e, i) => ({ e, i })).filter(x => x.e.dept === d)
          const n = rows.filter(picked).length + ex.length
          return (
            <section key={d} className={'dept nf-d' + (n === 0 ? ' none' : '')}>
              <div className="grp"><span className="dn">{d}</span><span className="st">{n ? n + '건 배정' : '배정 없음'}</span></div>
              {rows.map(t => {
                const on = picked(t), dv = daysOf(t), chg = dv !== t.days_before
                return (
                  <div key={t.id} className={'nf-row ed' + (on ? '' : ' off')}>
                    <input type="checkbox" id={'pk' + t.id} checked={on} onChange={e => set({ picks: { ...nf.picks, [t.id]: e.target.checked }, presetUsed: null, err: '' })} />
                    <div>
                      <label htmlFor={'pk' + t.id} className="nf-tt">{t.title}</label>
                      <div className="nf-dl">
                        <input type="date" aria-label={t.title + ' 마감일'} disabled={!on || !tgt} value={tgt ? iso(add(tgt, -dv)) : ''}
                          onChange={e => { if (e.target.value) set({ days: { ...nf.days, [t.id]: diffDays(nf.target, e.target.value) }, presetUsed: null }) }} />
                        <small>{dayTxt(dv)}{chg && <> · <span className="chg">변경됨</span></>}</small>
                        {chg && <button type="button" className="link rst" onClick={() => set({ days: { ...nf.days, [t.id]: t.days_before } })}>기본값({dayTxt(t.days_before).replace('전환 ', '')})</button>}
                      </div>
                    </div>
                  </div>
                )
              })}
              {ex.map(({ e, i }) => (
                <div key={'x' + i} className="nf-row add ed">
                  <span className="new">추가</span>
                  <div>
                    <span className="nf-tt">{e.title}</span>
                    <div className="nf-dl">
                      <input type="date" aria-label={e.title + ' 마감일'} value={e.date}
                        onChange={ev => { if (ev.target.value) set({ extras: nf.extras.map((x, j) => (j === i ? { ...x, date: ev.target.value } : x)), presetUsed: null }) }} />
                      {tgt && <small>{dayTxt(diffDays(nf.target, e.date))}</small>}
                    </div>
                  </div>
                  <button type="button" className="x" aria-label="추가한 할 일 삭제" onClick={() => set({ extras: nf.extras.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
              {nf.addDept === d ? (
                <div className="nf-add">
                  <input autoFocus value={addTitle} onChange={e => setAddTitle(e.target.value)} placeholder="할 일 내용" aria-label="추가할 할 일" />
                  <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} aria-label="마감일" />
                  <button type="button" className="btn sm" onClick={() => {
                    if (!addTitle.trim() || !addDate) return toast('할 일 내용과 마감일을 입력해주세요')
                    set({ extras: [...nf.extras, { dept: d, title: addTitle.trim(), date: addDate }], addDept: null, presetUsed: null, err: '' })
                  }}>추가</button>
                  <button type="button" className="btn sm ghost" onClick={() => set({ addDept: null })}>취소</button>
                </div>
              ) : (
                <button type="button" className="link nf-plus" onClick={() => { setAddTitle(''); setAddDate(tgt ? iso(add(tgt, -7)) : ''); set({ addDept: d }) }}>+ {d} 할 일 추가</button>
              )}
            </section>
          )
        })}
      </div>
      {nf.err && <p className="nf-err">{nf.err}</p>}
      <button type="button" className="btn nf-go" disabled={busy} onClick={submit}>{busy ? '등록 중…' : `변경 등록 · 할 일 ${pickedN}건 배정`}</button>
    </>
  )
}
