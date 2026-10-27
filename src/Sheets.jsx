import { useEffect, useRef, useState } from 'react'
import { ORDER, ITEM_TYPES } from './supabase.js'
import { useApp, Person, MsgText } from './ctx.jsx'
import OrgTree from './Org.jsx'
import { md, stamp } from './util.js'

export default function Sheet() {
  const app = useApp()
  const { sheet, setSheet } = app
  const close = () => setSheet(null)
  useEffect(() => {
    const on = e => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  })
  let body = null
  if (sheet.kind === 'task') body = <TaskSheet tid={sheet.tid} close={close} />
  else if (sheet.kind === 'target') body = <TargetSheet cid={sheet.cid} close={close} />
  else if (sheet.kind === 'stop') body = <StopSheet cid={sheet.cid} close={close} />
  else if (sheet.kind === 'resume') body = <ResumeSheet cid={sheet.cid} close={close} />
  else if (sheet.kind === 'assign') body = <AssignSheet cid={sheet.cid} close={close} />
  else if (sheet.kind === 'edit') body = <EditSheet cid={sheet.cid} close={close} />
  else if (sheet.kind === 'bulk') body = <BulkSheet tids={sheet.tids} close={close} />
  else if (sheet.kind === 'gedit') body = <GroupEditSheet gid={sheet.gid} close={close} />
  else if (sheet.kind === 'gtarget') body = <GroupTargetSheet gid={sheet.gid} close={close} />
  else if (sheet.kind === 'gstop') body = <GroupStopSheet gid={sheet.gid} close={close} />
  else if (sheet.kind === 'gadd') body = <GroupAddSheet gid={sheet.gid} close={close} />
  else if (sheet.kind === 'gremove') body = <GroupRemoveSheet cid={sheet.cid} close={close} />
  else if (sheet.kind === 'org') body = <><Top tag={'가입한 사람 ' + app.db.profiles.length + '명'} close={close} /><div className="s-title">조직도</div><OrgTree inSheet /></>
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="grab" />
        {body}
      </div>
    </>
  )
}

function Top({ tag, close }) {
  return (
    <div className="s-top">
      <span className="s-tag">{tag}</span>
      <button type="button" className="s-x" onClick={close} aria-label="닫기">✕</button>
    </div>
  )
}

function useBusy() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async fn => {
    if (busy) return
    setBusy(true); setErr('')
    const r = await fn()
    setBusy(false)
    if (r && r.error) setErr(r.error)
    return r
  }
  return { busy, err, setErr, go }
}

function useFocus() {
  const ref = useRef(null)
  useEffect(() => { ref.current && ref.current.focus() }, [])
  return ref
}

/* ---------- 할 일 처리 ---------- */
function TaskSheet({ tid, close }) {
  const { db, me, viewer, C, isLate } = useApp()
  const t = db.tasks.find(x => x.id === tid)
  const [mode, setMode] = useState(null)
  if (!t) return <><Top tag="" close={close} /><p className="empty">이 할 일을 찾을 수 없습니다.</p></>
  const c = C(t.change_id)
  const mineT = t.department === me.department
  const st = t.status === '대기'
    ? <span className={isLate(t) ? 'late' : ''}>{isLate(t) ? '전환일 지남 · 대기' : '대기'}</span>
    : <span className="ok">{t.status === '완료' ? '✓ 확인완료' : '해당없음'}</span>
  const linked = db.messages.filter(m => m.task_id === t.id && !m.deleted)
  const logs = db.taskLogs.filter(x => x.task_id === t.id).sort((a, b) => a.id - b.id)

  let actions = null
  if (mode === '완료' || mode === '해당없음') actions = <StatusForm t={t} mode={mode} back={() => setMode(null)} close={close} />
  else if (mode === '취소') actions = <CancelForm t={t} c={c} back={() => setMode(null)} close={close} />
  else {
    const a = []
    const canDo = !viewer && mineT && t.status === '대기' && c.status === '진행중'
    if (!viewer && mineT && t.status !== '대기' && !(c.status === '종결' && c.close_type === '중단'))
      a.push(<button key="c" type="button" className="btn warn full" onClick={() => setMode('취소')}>확인 취소</button>)
    actions = (
      <>
        {viewer && <div className="lock">보기 전용 계정입니다. 처리는 {t.department} 부서가 합니다.</div>}
        {!viewer && !mineT && t.status === '대기' && <div className="lock">{t.department} 부서만 처리할 수 있습니다.</div>}
        {!viewer && c.status === '종결' && c.close_type === '중단' && <div className="lock">중단 종결된 변경입니다. 처리하려면 먼저 "다시 진행"을 해주세요.</div>}
        {canDo && <QuickForm t={t} close={close} />}
        {a.length > 0 && <div className="s-acts">{a}</div>}
      </>
    )
  }

  return (
    <>
      <Top tag={c.short + ' · ' + t.department} close={close} />
      <div className="s-title">{t.title}</div>
      <dl className="kv">
        <dt>상태</dt><dd>{st}</dd>
        <dt>전환일</dt><dd className="mono">{c.target_date}</dd>
        <dt>담당</dt><dd>{t.department}</dd>
      </dl>
      {t.is_extra && (
        <div className="asg-box">
          <b>추가 배정된 할 일</b>
          <span>배정: <Person id={t.assigned_by} /> · {stamp(t.created_at)}</span>
          <span>사유: {t.assign_reason}</span>
        </div>
      )}
      {t.status !== '대기' && <div className="memo">“{t.memo}”<small><Person id={t.done_by} /> · {stamp(t.done_at)}</small></div>}
      {actions}
      <div className="hist">
        <h3>연결된 대화 {linked.length}</h3>
        {linked.length > 0 && (
          <ol>{linked.map(m => <li key={m.id}><Person id={m.user_id} /> · “<MsgText m={m} />” — {stamp(m.created_at)}</li>)}</ol>
        )}
      </div>
      {logs.length > 0 && (
        <div className="hist">
          <h3>처리 이력 {logs.length}</h3>
          <ol>{logs.map(x => <li key={x.id}><b>{x.action}</b> · “{x.memo}” — <Person id={x.user_id} />, {stamp(x.created_at)}</li>)}</ol>
        </div>
      )}
    </>
  )
}

/* 처리 메모를 바로 쓰고, 확인완료 / 해당없음 중 하나로 저장 */
function QuickForm({ t, close }) {
  const { run } = useApp()
  const [memo, setMemo] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const ref = useFocus()
  const save = mode => go(async () => {
    if (!memo.trim()) return { error: mode === '완료' ? '확인 메모를 입력해주세요. (무엇을 확인했는지)' : '해당없음 사유를 입력해주세요.' }
    const r = await run('complete_task', { p_task: t.id, p_status: mode, p_memo: memo.trim() },
      d => (d === '종결' ? '모든 부서 확인 완료 → 자동 종결 · 배정 목록에 추가됨' : (mode === '완료' ? '확인완료' : '해당없음') + ' 저장됨'))
    if (!r.error) close()
    return r
  })
  return (
    <>
      <div className="form">
        <label htmlFor="f-memo">처리 메모 (필수) — 확인한 내용 또는 해당없음 사유</label>
        <textarea id="f-memo" ref={ref} rows={3} value={memo} onChange={e => { setMemo(e.target.value); setErr('') }}
          placeholder="예: 신규 띠지 입고 확인, 번들 포함 / 이번 변경은 박스 변경 없음" />
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={() => save('완료')}>{busy ? '저장 중…' : '확인완료로 저장'}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => save('해당없음')}>해당없음으로 저장</button>
      </div>
    </>
  )
}

function StatusForm({ t, mode, back, close }) {
  const { run } = useApp()
  const [memo, setMemo] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const ref = useFocus()
  const save = () => go(async () => {
    if (!memo.trim()) return { error: mode === '완료' ? '확인 메모를 입력해주세요. (무엇을 확인했는지)' : '해당없음 사유를 입력해주세요.' }
    const r = await run('complete_task', { p_task: t.id, p_status: mode, p_memo: memo.trim() },
      d => (d === '종결' ? '모든 부서 확인 완료 → 자동 종결 · 배정 목록에 추가됨' : mode + ' 저장됨'))
    if (!r.error) close()
    return r
  })
  return (
    <>
      <div className="form">
        <label htmlFor="f-memo">{mode === '완료' ? '확인 메모 (필수)' : '해당없음 사유 (필수)'}</label>
        <textarea id="f-memo" ref={ref} rows={3} value={memo} onChange={e => { setMemo(e.target.value); setErr('') }}
          placeholder={mode === '완료' ? '예: 신규 띠지 입고 확인, 번들 포함' : '예: 이번 변경은 박스 변경 없음'} />
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? '저장 중…' : mode + ' 저장'}</button>
        <button type="button" className="btn ghost" onClick={back}>취소</button>
      </div>
    </>
  )
}

function CancelForm({ t, c, back, close }) {
  const { run } = useApp()
  const [memo, setMemo] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const ref = useFocus()
  const save = () => go(async () => {
    if (!memo.trim()) return { error: '취소 사유를 입력해주세요.' }
    const r = await run('cancel_task', { p_task: t.id, p_reason: memo.trim() },
      d => (d === 'reopened' ? '확인 취소 → 다시 진행중으로 열렸습니다' : '확인 취소 → 다시 대기'))
    if (!r.error) close()
    return r
  })
  return (
    <>
      <div className="form">
        <label htmlFor="f-memo">취소 사유 (필수)</label>
        <textarea id="f-memo" ref={ref} rows={3} value={memo} onChange={e => { setMemo(e.target.value); setErr('') }} placeholder="예: 번들 포장지 재고 남아 있음 확인, 재처리 필요" />
        <p className="note">다시 "대기"가 되고 이전 기록은 이력에 남습니다.{c.status === '종결' ? ' 종결된 변경이 다시 진행중으로 열립니다.' : ''}</p>
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn warn" disabled={busy} onClick={save}>{busy ? '처리 중…' : '확인 취소'}</button>
        <button type="button" className="btn ghost" onClick={back}>닫기</button>
      </div>
    </>
  )
}

/* ---------- 전환일 변경 ---------- */
function TargetSheet({ cid, close }) {
  const { C, run } = useApp()
  const c = C(cid)
  const [date, setDate] = useState(c.target_date)
  const [reason, setReason] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const save = () => go(async () => {
    if (!date || date === c.target_date) return { error: '기존과 다른 날짜를 골라주세요.' }
    if (!reason.trim()) return { error: '변경 사유를 입력해주세요.' }
    const r = await run('change_target', { p_change: cid, p_new: date, p_reason: reason.trim() }, `전환일을 ${md(date)}로 바꿨습니다`)
    if (!r.error) close()
    return r
  })
  return (
    <>
      <Top tag={c.short} close={close} />
      <div className="s-title">전환일 변경</div>
      <div className="form">
        <label htmlFor="f-date">새 전환일 (현재 {md(c.target_date)})</label>
        <input type="date" id="f-date" value={date} onChange={e => { setDate(e.target.value); setErr('') }} />
        <label htmlFor="f-reason">변경 사유 (필수)</label>
        <input id="f-reason" value={reason} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="예: 신규 자재 입고 1주 지연" />
        <p className="note">바뀐 날짜와 사유는 이력에 남고 결과 보고서에도 들어갑니다.</p>
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? '저장 중…' : '변경 저장'}</button>
        <button type="button" className="btn ghost" onClick={close}>취소</button>
      </div>
    </>
  )
}

/* ---------- 중단 종결 ---------- */
function StopSheet({ cid, close }) {
  const { C, tOf, run } = useApp()
  const c = C(cid)
  const leftN = tOf(cid).filter(t => t.status === '대기').length
  const [reason, setReason] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const ref = useFocus()
  const save = () => go(async () => {
    if (!reason.trim()) return { error: '중단 사유를 입력해주세요.' }
    const r = await run('stop_change', { p_change: cid, p_reason: reason.trim() }, '중단 종결되었습니다 · 배정 목록에 추가됨')
    if (!r.error) close()
    return r
  })
  return (
    <>
      <Top tag={c.short} close={close} />
      <div className="s-title">일정 중단 종결</div>
      <div className="warnbox">
        이 변경을 더 진행하지 않고 종결합니다.<br />
        남은 할 일 <b>{leftN}건</b>은 <b>"중단"</b>으로 기록되고 더 이상 처리할 수 없습니다. 지금까지의 처리 기록과 이력은 그대로 남습니다.
      </div>
      <div className="form">
        <label htmlFor="f-reason">중단 사유 (필수)</label>
        <textarea id="f-reason" ref={ref} rows={3} value={reason} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="예: 고객사 요청으로 변경 계획 철회" />
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn warn" disabled={busy} onClick={save}>{busy ? '처리 중…' : '중단 종결하기'}</button>
        <button type="button" className="btn ghost" onClick={close}>취소</button>
      </div>
    </>
  )
}

/* ---------- 다시 진행 ---------- */
function ResumeSheet({ cid, close }) {
  const { C, run } = useApp()
  const c = C(cid)
  const [reason, setReason] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const ref = useFocus()
  const save = () => go(async () => {
    if (!reason.trim()) return { error: '다시 진행하는 사유를 입력해주세요.' }
    const r = await run('resume_change', { p_change: cid, p_reason: reason.trim() }, '다시 진행중으로 열렸습니다')
    if (!r.error) close()
    return r
  })
  return (
    <>
      <Top tag={c.short} close={close} />
      <div className="s-title">다시 진행</div>
      <div className="lock">중단 종결을 취소하고 남은 할 일을 다시 처리할 수 있게 엽니다. 중단 기록은 이력에 남습니다.</div>
      <div className="form">
        <label htmlFor="f-reason">다시 진행하는 사유 (필수)</label>
        <textarea id="f-reason" ref={ref} rows={2} value={reason} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="예: 고객사가 변경 재요청" />
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? '처리 중…' : '다시 진행'}</button>
        <button type="button" className="btn ghost" onClick={close}>취소</button>
      </div>
    </>
  )
}

/* ---------- 다른 부서에 할 일 배정 ---------- */
function AssignSheet({ cid, close }) {
  const { C, run } = useApp()
  const c = C(cid)
  const [dept, setDept] = useState(ORDER[0])
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const save = () => go(async () => {
    if (!title.trim()) return { error: '할 일 내용을 입력해주세요.' }
    if (!reason.trim()) return { error: '배정 사유를 입력해주세요.' }
    const r = await run('assign_task', { p_change: cid, p_dept: dept, p_title: title.trim(), p_reason: reason.trim() }, `${dept} 부서에 할 일을 배정했습니다`)
    if (!r.error) close()
    return r
  })
  const clr = f => e => { f(e.target.value); setErr('') }
  return (
    <>
      <Top tag={c.short} close={close} />
      <div className="s-title">다른 부서에 할 일 배정</div>
      <div className="form">
        <label htmlFor="f-dept">담당 부서</label>
        <select id="f-dept" value={dept} onChange={clr(setDept)}>{ORDER.map(d => <option key={d}>{d}</option>)}</select>
        <label htmlFor="f-title">할 일</label>
        <input id="f-title" value={title} onChange={clr(setTitle)} placeholder="예: 번들 띠지 신규 도안 확인" />
        <label htmlFor="f-reason">배정 사유 (필수)</label>
        <textarea id="f-reason" rows={2} value={reason} onChange={clr(setReason)} placeholder="예: 번들 띠지에도 구 제품명 표기가 있어 함께 교체 필요" />
        <p className="note">배정한 사람·부서·사유가 이력에 남고, 결과 보고서에도 들어갑니다.</p>
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? '배정 중…' : '배정하기'}</button>
        <button type="button" className="btn ghost" onClick={close}>취소</button>
      </div>
    </>
  )
}

/* ---------- 변경 내용 수정 (등록 부서 + 관리자, 진행 중인 건만) ---------- */
function EditSheet({ cid, close }) {
  const { C, run } = useApp()
  const c = C(cid)
  const [title, setTitle] = useState(c.title)
  const [desc, setDesc] = useState(c.description || '')
  const [reason, setReason] = useState(c.reason || '')
  const [items, setItems] = useState(c.items.length ? c.items.map(i => ({ type: i.item_type, name: i.item_name })) : [{ type: '단품', name: '' }])
  const { busy, err, setErr, go } = useBusy()
  const setItem = (i, patch) => { setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x))); setErr('') }
  const save = () => go(async () => {
    if (!title.trim()) return { error: '제목을 입력해주세요.' }
    if (!items.some(x => x.name.trim())) return { error: '대상 품목을 1개 이상 입력해주세요.' }
    const r = await run('update_change', { p_change: cid, p_title: title.trim(), p_description: desc.trim(), p_reason: reason.trim(), p_items: items.filter(x => x.name.trim()) }, '내용을 수정했습니다')
    if (!r.error) close()
    return r
  })
  return (
    <>
      <Top tag={c.short} close={close} />
      <div className="s-title">변경 내용 수정</div>
      <div className="form">
        <label htmlFor="e-title">제목</label>
        <input id="e-title" value={title} onChange={e => { setTitle(e.target.value); setErr('') }} />
        <label htmlFor="e-desc">변경 내용</label>
        <textarea id="e-desc" rows={2} value={desc} onChange={e => { setDesc(e.target.value); setErr('') }} />
        <label htmlFor="e-reason">변경 사유</label>
        <input id="e-reason" value={reason} onChange={e => { setReason(e.target.value); setErr('') }} />
        <label>대상 품목</label>
        {items.map((it, i) => (
          <div className="ed-item" key={i}>
            <select aria-label="품목 종류" value={it.type} onChange={e => setItem(i, { type: e.target.value })}>
              {ITEM_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <input aria-label="품목 이름" value={it.name} onChange={e => setItem(i, { name: e.target.value })} />
            {items.length > 1 && <button type="button" className="x" aria-label="품목 삭제" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        <button type="button" className="pill" style={{ alignSelf: 'flex-start' }} onClick={() => setItems([...items, { type: '번들/기획상품', name: '' }])}>+ 품목 추가</button>
        <p className="note">무엇을 바꿨는지 이력에 남고 결과 보고서에도 들어갑니다. 전환일은 '전환일 변경'에서 바꿉니다.</p>
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? '저장 중…' : '수정 저장'}</button>
        <button type="button" className="btn ghost" onClick={close}>취소</button>
      </div>
    </>
  )
}

/* ================= 품목별 관리 (묶음) ================= */

/* ---------- 같은 할 일 여러 품목 한 번에 처리 ---------- */
function BulkSheet({ tids, close }) {
  const { db, C, run, me } = useApp()
  const ts = tids.map(id => db.tasks.find(t => t.id === id)).filter(t => t && t.status === '대기' && C(t.change_id) && C(t.change_id).status === '진행중')
  const [memo, setMemo] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const ref = useFocus()
  if (!ts.length) return <><Top tag="한 번에 처리" close={close} /><p className="note" style={{ padding: '0 20px 20px' }}>처리할 할 일이 없습니다. 이미 처리됐을 수 있습니다.</p></>
  const title = ts[0].title
  const save = mode => go(async () => {
    if (!memo.trim()) return { error: mode === '완료' ? '확인 메모를 입력해주세요.' : '해당없음 사유를 입력해주세요.' }
    const r = await run('complete_tasks', { p_tasks: ts.map(t => t.id), p_status: mode, p_memo: memo.trim() },
      n => `${n}개 품목을 ${mode === '완료' ? '확인완료' : '해당없음'}로 처리했습니다`)
    if (!r.error) close()
    return r
  })
  return (
    <>
      <Top tag={me.department + ' · 한 번에 처리'} close={close} />
      <div className="s-title">한 번에 처리 · {ts.length}개 품목</div>
      <p className="bk-t">{title}</p>
      <ul className="bk-list">{ts.map(t => <li key={t.id}>{C(t.change_id).title}</li>)}</ul>
      <div className="form">
        <label htmlFor="bk-memo">처리 메모 ({ts.length}개 품목에 똑같이 남음)</label>
        <textarea id="bk-memo" ref={ref} rows={3} value={memo} onChange={e => { setMemo(e.target.value); setErr('') }} placeholder="예: 품목제조변경보고 10/27 완료 (일괄 신고)" />
        <p className="note">품목마다 처리자·시각·메모가 각각 기록됩니다. 하나라도 처리할 수 없으면 아무것도 저장되지 않습니다. 잘못 처리한 품목은 그 품목에서 하나씩 '확인 취소'하세요.</p>
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={() => save('완료')}>{busy ? '저장 중…' : `확인완료로 저장 (${ts.length})`}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => save('해당없음')}>해당없음으로 저장 ({ts.length})</button>
      </div>
    </>
  )
}

/* ---------- 묶음 내용 수정 ---------- */
function GroupEditSheet({ gid, close }) {
  const { db, run } = useApp()
  const g = db.groupMap[gid]
  const [title, setTitle] = useState(g.title)
  const [desc, setDesc] = useState(g.description || '')
  const [reason, setReason] = useState(g.reason || '')
  const { busy, err, setErr, go } = useBusy()
  const save = () => go(async () => {
    if (!title.trim()) return { error: '제목을 입력해주세요.' }
    const r = await run('group_update', { p_group: gid, p_title: title.trim(), p_description: desc.trim(), p_reason: reason.trim() }, '묶음 내용을 수정했습니다')
    if (!r.error) close()
    return r
  })
  return (
    <>
      <Top tag={'묶음 · 품목 ' + g.kids.length} close={close} />
      <div className="s-title">묶음 내용 수정</div>
      <div className="form">
        <label htmlFor="ge-t">제목</label>
        <input id="ge-t" value={title} onChange={e => { setTitle(e.target.value); setErr('') }} />
        <label htmlFor="ge-d">변경 내용 (모든 품목 공통)</label>
        <textarea id="ge-d" rows={2} value={desc} onChange={e => { setDesc(e.target.value); setErr('') }} />
        <label htmlFor="ge-r">변경 사유 (모든 품목 공통)</label>
        <input id="ge-r" value={reason} onChange={e => { setReason(e.target.value); setErr('') }} />
        <p className="note">진행 중인 품목의 변경 내용·사유도 함께 바뀌고, 품목마다 '내용 수정' 이력이 남습니다. 종결된 품목은 그대로입니다.</p>
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? '저장 중…' : '저장'}</button>
        <button type="button" className="btn ghost" onClick={close}>취소</button>
      </div>
    </>
  )
}

/* ---------- 전환일 일괄 변경 (고른 품목만) ---------- */
function GroupTargetSheet({ gid, close }) {
  const { db, run } = useApp()
  const g = db.groupMap[gid]
  const open = g.kids.filter(k => k.status === '진행중')
  const [pick, setPick] = useState(() => Object.fromEntries(open.map(k => [k.id, true])))
  const [date, setDate] = useState(open[0] ? open[0].target_date : '')
  const [reason, setReason] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const ids = open.filter(k => pick[k.id]).map(k => k.id)
  const save = () => go(async () => {
    if (!ids.length) return { error: '품목을 골라주세요.' }
    if (!date) return { error: '새 전환일을 골라주세요.' }
    if (!reason.trim()) return { error: '변경 사유를 입력해주세요.' }
    const r = await run('group_change_target', { p_group: gid, p_ids: ids, p_new: date, p_reason: reason.trim() }, n => `${n}개 품목의 전환일을 ${md(date)}로 바꿨습니다`)
    if (!r.error) close()
    return r
  })
  return (
    <>
      <Top tag={'묶음 · ' + g.title} close={close} />
      <div className="s-title">전환일 일괄 변경</div>
      <div className="form">
        <div className="gt-h"><span>품목 고르기 (진행 중 {open.length}개)</span><label><input type="checkbox" checked={ids.length === open.length} onChange={e => setPick(Object.fromEntries(open.map(k => [k.id, e.target.checked])))} /> 모두 선택</label></div>
        <div className="gt-list">
          {open.map(k => (
            <label key={k.id} className={pick[k.id] ? 'on' : ''}>
              <input type="checkbox" checked={!!pick[k.id]} onChange={e => { setPick({ ...pick, [k.id]: e.target.checked }); setErr('') }} />
              <span className="gt-n">{k.title}</span><span className="gt-d mono">{md(k.target_date)}</span>
            </label>
          ))}
        </div>
        <label htmlFor="gt-date">새 전환일</label>
        <input type="date" id="gt-date" value={date} onChange={e => { setDate(e.target.value); setErr('') }} />
        <label htmlFor="gt-reason">변경 사유 (필수)</label>
        <input id="gt-reason" value={reason} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="예: 스페인산 원료 입고 2주 지연" />
        <p className="note">고른 품목마다 변경 이력이 남습니다. 이미 그 날짜인 품목은 건너뜁니다. 품목 하나만 바꾸려면 그 품목 화면의 '전환일 변경'을 쓰세요.</p>
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? '저장 중…' : `${ids.length}개 품목 변경`}</button>
        <button type="button" className="btn ghost" onClick={close}>취소</button>
      </div>
    </>
  )
}

/* ---------- 묶음 중단 종결 ---------- */
function GroupStopSheet({ gid, close }) {
  const { db, run } = useApp()
  const g = db.groupMap[gid]
  const open = g.kids.filter(k => k.status === '진행중')
  const [reason, setReason] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const ref = useFocus()
  const save = () => go(async () => {
    if (!reason.trim()) return { error: '중단 사유를 입력해주세요.' }
    const r = await run('group_stop', { p_group: gid, p_reason: reason.trim() }, n => `${n}개 품목을 중단 종결했습니다`)
    if (!r.error) close()
    return r
  })
  return (
    <>
      <Top tag={'묶음 · ' + g.title} close={close} />
      <div className="s-title">묶음 중단 종결</div>
      <div className="warnbox">진행 중인 품목 <b>{open.length}개</b>를 모두 중단 종결합니다. 남은 할 일은 "중단"으로 기록되고, 지금까지의 처리 기록은 그대로 남습니다. 품목 하나만 멈추려면 그 품목의 '중단'을 쓰세요.</div>
      <div className="form">
        <label htmlFor="gs-r">중단 사유 (필수)</label>
        <textarea id="gs-r" ref={ref} rows={3} value={reason} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="예: 고객사 CR 계획 철회" />
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn warn" disabled={busy} onClick={save}>{busy ? '처리 중…' : '묶음 중단 종결하기'}</button>
        <button type="button" className="btn ghost" onClick={close}>취소</button>
      </div>
    </>
  )
}

/* ---------- 품목 추가 ---------- */
function GroupAddSheet({ gid, close }) {
  const { db, run } = useApp()
  const g = db.groupMap[gid]
  const last = g.kids[g.kids.length - 1]
  const [type, setType] = useState(last && last.items[0] ? last.items[0].item_type : '기타')
  const [name, setName] = useState('')
  const open = g.kids.filter(k => k.status === '진행중').map(k => k.target_date).sort()
  const [date, setDate] = useState(open[0] || (last ? last.target_date : ''))
  const [reason, setReason] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const ref = useFocus()
  const save = () => go(async () => {
    if (!name.trim()) return { error: '품목 이름을 입력해주세요.' }
    if (!date) return { error: '전환일을 골라주세요.' }
    if (!reason.trim()) return { error: '추가 사유를 입력해주세요.' }
    const r = await run('group_add_item', { p_group: gid, p_type: type, p_name: name.trim(), p_target: date, p_reason: reason.trim() }, `"${name.trim()}" 품목을 추가했습니다`)
    if (!r.error) close()
    return r
  })
  return (
    <>
      <Top tag={'묶음 · ' + g.title} close={close} />
      <div className="s-title">품목 추가</div>
      <div className="form">
        <label htmlFor="ga-t">품목 종류</label>
        <select id="ga-t" value={type} onChange={e => setType(e.target.value)}>{ITEM_TYPES.map(t => <option key={t}>{t}</option>)}</select>
        <label htmlFor="ga-n">품목 이름</label>
        <input id="ga-n" ref={ref} value={name} onChange={e => { setName(e.target.value); setErr('') }} placeholder="예: 풀무원 김치손만두속" />
        <label htmlFor="ga-d">전환일</label>
        <input type="date" id="ga-d" value={date} onChange={e => { setDate(e.target.value); setErr('') }} />
        <label htmlFor="ga-r">추가 사유 (필수)</label>
        <input id="ga-r" value={reason} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="예: 고객사 CR 대상 품목 추가 통보 (10/27 메일)" />
        <p className="note">사유는 묶음 이력과 새 품목의 변경 이력에 남습니다. 묶음에 등록된 할 일 세트({(g.tasks || []).length}건)가 새 품목에도 똑같이 배정되고, 관련 부서의 '내 할 일'에 바로 나타납니다.</p>
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? '추가 중…' : '추가'}</button>
        <button type="button" className="btn ghost" onClick={close}>취소</button>
      </div>
    </>
  )
}

/* ---------- 품목 빼기 (아무도 처리 안 한 품목만) ---------- */
function GroupRemoveSheet({ cid, close }) {
  const { C, run } = useApp()
  const c = C(cid)
  const [reason, setReason] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const ref = useFocus()
  if (!c) return null
  const save = () => go(async () => {
    if (!reason.trim()) return { error: '빼는 사유를 입력해주세요.' }
    const r = await run('group_remove_item', { p_change: cid, p_reason: reason.trim() }, `"${c.title}" 품목을 묶음에서 뺐습니다`)
    if (!r.error) close()
    return r
  })
  return (
    <>
      <Top tag={c.group ? '묶음 · ' + c.group.title : '품목'} close={close} />
      <div className="s-title">품목 빼기</div>
      <div className="warnbox">"<b>{c.title}</b>" 품목을 묶음에서 뺍니다. 이 품목의 할 일 {c.tasks.length}건과 대화가 함께 지워지고, 묶음 이력에 '품목 빼기'로 남습니다.</div>
      <div className="form">
        <label htmlFor="gr-r">빼는 사유 (필수)</label>
        <textarea id="gr-r" ref={ref} rows={2} value={reason} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="예: 고객사가 이번 CR 대상에서 제외" />
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn warn" disabled={busy} onClick={save}>{busy ? '처리 중…' : '빼기'}</button>
        <button type="button" className="btn ghost" onClick={close}>취소</button>
      </div>
    </>
  )
}
