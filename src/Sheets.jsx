import { useEffect, useRef, useState } from 'react'
import { ORDER } from './supabase.js'
import { useApp, Person, MsgText } from './ctx.jsx'
import OrgTree from './Org.jsx'
import { add, dd, ddLabel, iso, md, stamp, todayMid } from './util.js'

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
  const { db, me, viewer, wide, C, openChat } = useApp()
  const t = db.tasks.find(x => x.id === tid)
  const [mode, setMode] = useState(null)
  if (!t) return <><Top tag="" close={close} /><p className="empty">이 할 일을 찾을 수 없습니다.</p></>
  const c = C(t.change_id)
  const mineT = t.department === me.department
  const n = dd(t.due_date)
  const canDue = !viewer && c.status === '진행중' && t.status === '대기' && mineT
  const st = t.status === '대기'
    ? <span className={n < 0 ? 'late' : ''}>{ddLabel(n)}</span>
    : <span className="ok">{t.status === '완료' ? '✓ 확인완료' : '해당없음'}</span>
  const linked = db.messages.filter(m => m.task_id === t.id && !m.deleted)
  const logs = db.taskLogs.filter(x => x.task_id === t.id).sort((a, b) => a.id - b.id)

  let actions = null
  if (mode === '완료' || mode === '해당없음') actions = <StatusForm t={t} mode={mode} back={() => setMode(null)} close={close} />
  else if (mode === '취소') actions = <CancelForm t={t} c={c} back={() => setMode(null)} close={close} />
  else if (mode === '마감') actions = <DueForm t={t} back={() => setMode(null)} close={close} />
  else {
    const a = []
    if (!viewer && mineT && t.status === '대기' && c.status === '진행중') {
      a.push(<button key="d" type="button" className="btn" onClick={() => setMode('완료')}>확인완료</button>)
      a.push(<button key="n" type="button" className="btn ghost" onClick={() => setMode('해당없음')}>해당없음</button>)
    }
    if (!viewer && mineT && t.status !== '대기' && !(c.status === '종결' && c.close_type === '중단'))
      a.push(<button key="c" type="button" className="btn warn full" onClick={() => setMode('취소')}>확인 취소</button>)
    if (canDue) a.push(<button key="m" type="button" className="btn ghost full" onClick={() => setMode('마감')}>마감일 변경</button>)
    actions = (
      <>
        {viewer && <div className="lock">임원 계정은 보기 전용입니다. 처리는 {t.department} 부서가 합니다.</div>}
        {!viewer && !mineT && t.status === '대기' && <div className="lock">{t.department} 부서만 처리할 수 있습니다.</div>}
        {!viewer && c.status === '종결' && c.close_type === '중단' && <div className="lock">중단 종결된 변경입니다. 처리하려면 먼저 "다시 진행"을 해주세요.</div>}
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
        <dt>마감일</dt><dd className="mono">{t.due_date}</dd>
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
        {!wide && <button type="button" className="link" onClick={() => openChat(c.id)}>제품 대화 열기 ›</button>}
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

function DueForm({ t, back, close }) {
  const { run } = useApp()
  const [date, setDate] = useState(t.due_date)
  const [reason, setReason] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const save = () => go(async () => {
    if (!date) return { error: '새 마감일을 골라주세요.' }
    if (date === t.due_date) return { error: '기존과 같은 날짜입니다.' }
    if (!reason.trim()) return { error: '변경 사유를 입력해주세요.' }
    const r = await run('change_task_due', { p_task_id: t.id, p_new_due: date, p_reason: reason.trim() }, `마감일을 ${md(date)}로 바꿨습니다`)
    if (!r.error) close()
    return r
  })
  return (
    <>
      <div className="form">
        <label htmlFor="f-date">새 마감일</label>
        <input type="date" id="f-date" value={date} onChange={e => { setDate(e.target.value); setErr('') }} />
        <label htmlFor="f-reason">변경 사유 (필수)</label>
        <input id="f-reason" value={reason} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="예: 신규 포장지 입고 일정 변경" />
        {err && <p className="err">{err}</p>}
      </div>
      <div className="s-acts">
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? '저장 중…' : '변경 저장'}</button>
        <button type="button" className="btn ghost" onClick={back}>취소</button>
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
    const r = await run('change_target', { p_change: cid, p_new: date, p_reason: reason.trim() }, `전환일을 ${md(date)}로 바꿨습니다 · 대기 중인 마감일도 함께 이동`)
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
        <input id="f-reason" value={reason} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="예: 신규 포장지 입고 1주 지연" />
        <p className="note">대기 중인 할 일의 마감일도 같은 날짜만큼 함께 이동합니다. 끝난 할 일은 그대로입니다.</p>
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
        <textarea id="f-reason" ref={ref} rows={3} value={reason} onChange={e => { setReason(e.target.value); setErr('') }} placeholder="예: 고객사 요청으로 포장 변경 계획 철회" />
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
  const [date, setDate] = useState(iso(add(todayMid(), 7)))
  const [reason, setReason] = useState('')
  const { busy, err, setErr, go } = useBusy()
  const save = () => go(async () => {
    if (!title.trim() || !date) return { error: '할 일과 마감일을 입력해주세요.' }
    if (!reason.trim()) return { error: '배정 사유를 입력해주세요.' }
    const r = await run('assign_task', { p_change: cid, p_dept: dept, p_title: title.trim(), p_due: date, p_reason: reason.trim() }, `${dept} 부서에 할 일을 배정했습니다`)
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
        <label htmlFor="f-date">마감일</label>
        <input type="date" id="f-date" value={date} onChange={clr(setDate)} />
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
