import { useEffect, useState, useCallback } from 'react'
import { supabase, DEPARTMENTS } from './supabase.js'
import TimelineView, { ChangeTimeline, TimelineLegend } from './Timeline.jsx'
import Settings from './Settings.jsx'

const ITEM_TYPES = ['단품', '번들/기획상품', '띠지', '박스', '기타']

/* ---------- 날짜 도우미 ---------- */
function todayMidnight() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
// 양수 = 남은 일수, 0 = 오늘, 음수 = 지연
function dday(s) {
  return Math.round((parseDate(s) - todayMidnight()) / 86400000)
}
function ddayLabel(n) {
  if (n < 0) return `${-n}일 지연`
  if (n === 0) return '오늘 마감'
  return `D-${n}`
}
function dueClass(n) {
  return n < 0 ? 'late' : n <= 3 ? 'soon' : ''
}
function shortDate(s) {
  const d = parseDate(s)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
function fmtTime(ts) {
  return new Date(ts).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/* ---------- 확인완료 / 해당없음 (메모 필수) ---------- */
function TaskAction({ task, onDone }) {
  const [mode, setMode] = useState(null)
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit() {
    if (!memo.trim())
      return setMsg(mode === '완료' ? '확인 메모를 입력해주세요. (무엇을 확인했는지)' : '해당없음 사유를 입력해주세요.')
    setBusy(true); setMsg('')
    const { data, error } = await supabase
      .from('tasks')
      .update({ status: mode, memo: memo.trim() })
      .eq('id', task.id)
      .select('id')
    setBusy(false)
    if (error) return setMsg(error.message)
    if (!data || data.length === 0)
      return setMsg('처리할 수 없습니다. 담당 부서 계정인지, 이미 종결된 변경은 아닌지 확인해주세요.')
    onDone()
  }

  if (!mode)
    return (
      <div className="row-actions">
        <button className="small" onClick={() => setMode('완료')}>확인완료</button>
        <button className="small ghost" onClick={() => setMode('해당없음')}>해당없음</button>
      </div>
    )

  return (
    <div className="action-box">
      <label>{mode === '완료' ? '확인 메모 (필수)' : '해당없음 사유 (필수)'}</label>
      <textarea
        rows={2}
        value={memo}
        onChange={e => setMemo(e.target.value)}
        placeholder={mode === '완료' ? '예: 신규 띠지 입고 확인, 번들 포함' : '예: 이번 변경은 박스 변경 없음'}
      />
      {msg && <p className="err">{msg}</p>}
      <div className="row-actions">
        <button className="small" disabled={busy} onClick={submit}>{busy ? '저장 중…' : mode === '완료' ? '확인완료 저장' : '해당없음 저장'}</button>
        <button className="small ghost" onClick={() => { setMode(null); setMemo(''); setMsg('') }}>취소</button>
      </div>
    </div>
  )
}

/* ---------- 내 할 일 ---------- */
function MyTasks({ profile, onOpen }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('id,title,due_date,change_id,change_requests!inner(title,target_date,status)')
      .eq('department', profile.department)
      .eq('status', '대기')
      .eq('change_requests.status', '진행중')
      .order('due_date')
    if (error) setErr(error.message)
    else { setRows(data); setErr('') }
  }, [profile.department])

  useEffect(() => { load() }, [load])

  if (err) return <p className="err">불러오지 못했습니다: {err}</p>
  if (!rows) return <p className="muted">불러오는 중…</p>

  const late = rows.filter(r => dday(r.due_date) < 0).length

  return (
    <div>
      <p className="muted">
        <b>{profile.department}</b> 부서가 처리할 일 {rows.length}건
        {late > 0 && <span className="late"> · 지연 {late}건</span>}
      </p>
      {rows.length === 0 && <div className="empty">처리할 일이 없습니다. 👍</div>}
      {rows.map(t => {
        const n = dday(t.due_date)
        return (
          <div key={t.id} className={'task ' + dueClass(n)}>
            <div className="task-top">
              <span className={'badge ' + dueClass(n)}>{ddayLabel(n)}</span>
              <span className="muted">마감 {shortDate(t.due_date)}</span>
            </div>
            <div className="task-title">{t.title}</div>
            <a className="link" onClick={() => onOpen(t.change_id)}>{t.change_requests.title}</a>
            <TaskAction task={t} onDone={load} />
          </div>
        )
      })}
    </div>
  )
}

/* ---------- 변경 목록 ---------- */
function ChangeList({ onOpen }) {
  const [list, setList] = useState(null)
  const [tasks, setTasks] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const a = await supabase.from('change_requests').select('*').order('created_at', { ascending: false })
      const b = await supabase.from('tasks').select('change_id,status,due_date,department')
      if (a.error || b.error) return setErr((a.error || b.error).message)
      setList(a.data); setTasks(b.data)
    })()
  }, [])

  if (err) return <p className="err">불러오지 못했습니다: {err}</p>
  if (!list) return <p className="muted">불러오는 중…</p>
  if (list.length === 0) return <div className="empty">등록된 변경이 없습니다. "변경 등록" 탭에서 만들어보세요.</div>

  return (
    <div>
      {list.map(c => {
        const ts = tasks.filter(t => t.change_id === c.id)
        const done = ts.filter(t => t.status !== '대기').length
        const late = ts.filter(t => t.status === '대기' && dday(t.due_date) < 0).length
        return (
          <div key={c.id} className="task clickable" onClick={() => onOpen(c.id)}>
            <div className="task-top">
              <span className={'badge ' + (c.status === '종결' ? 'done' : 'ing')}>{c.status}</span>
              {c.status === '진행중' && late > 0 && <span className="badge late">지연 {late}건</span>}
              <span className="muted">전환 목표 {shortDate(c.target_date)}</span>
            </div>
            <div className="task-title">{c.title}</div>
            <div className="muted">
              발의 {c.created_by_dept} · 완료 {done}/{ts.length}
            </div>
            <div className="bar"><i style={{ width: ts.length ? (done / ts.length) * 100 + '%' : '0%' }} /></div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- 마감일 변경 폼 ---------- */
function DueEditor({ task, onDone }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(task.due_date)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!date) return setMsg('새 마감일을 선택해주세요.')
    if (date === task.due_date) return setMsg('기존과 같은 날짜입니다.')
    if (!reason.trim()) return setMsg('변경 사유를 입력해주세요.')
    setBusy(true); setMsg('')
    const { error } = await supabase.rpc('change_task_due', {
      p_task_id: task.id, p_new_due: date, p_reason: reason.trim(),
    })
    setBusy(false)
    if (error) return setMsg(error.message)
    setOpen(false); setReason(''); onDone()
  }

  if (!open) return <a className="link" onClick={() => setOpen(true)}>마감일 변경</a>
  return (
    <div className="action-box">
      <label>새 마감일</label>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      <label>변경 사유 (필수)</label>
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="예: 신규 포장지 입고가 일주일 늦어짐" />
      {msg && <p className="err">{msg}</p>}
      <div className="row-actions">
        <button className="small" disabled={busy} onClick={submit}>{busy ? '저장 중…' : '변경 저장'}</button>
        <button className="small ghost" onClick={() => { setOpen(false); setMsg('') }}>취소</button>
      </div>
    </div>
  )
}

/* ---------- 할 일 직접 배정 ---------- */
function AddTask({ changeId, profile, onDone }) {
  const [open, setOpen] = useState(false)
  const [dept, setDept] = useState('')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!dept || !title.trim() || !due) return setMsg('부서, 할 일, 마감일을 모두 입력해주세요.')
    setBusy(true); setMsg('')
    const { error } = await supabase.from('tasks').insert({
      change_id: changeId, department: dept, title: title.trim(), due_date: due, assigned_by: profile.id,
    })
    setBusy(false)
    if (error) return setMsg(error.message)
    setOpen(false); setDept(''); setTitle(''); setDue(''); onDone()
  }

  if (!open) return <button className="ghost" onClick={() => setOpen(true)}>+ 다른 부서에 할 일 배정</button>
  return (
    <div className="action-box">
      <label>담당 부서</label>
      <select value={dept} onChange={e => setDept(e.target.value)}>
        <option value="">선택</option>
        {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
      </select>
      <label>할 일</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 번들 띠지 신규 도안 확인" />
      <label>마감일</label>
      <input type="date" value={due} onChange={e => setDue(e.target.value)} />
      {msg && <p className="err">{msg}</p>}
      <div className="row-actions">
        <button className="small" disabled={busy} onClick={submit}>{busy ? '배정 중…' : '배정하기'}</button>
        <button className="small ghost" onClick={() => { setOpen(false); setMsg('') }}>취소</button>
      </div>
    </div>
  )
}

/* ---------- 변경 상세 ---------- */
function Detail({ id, profile, people, onBack }) {
  const [change, setChange] = useState(null)
  const [items, setItems] = useState([])
  const [tasks, setTasks] = useState([])
  const [hist, setHist] = useState([])
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const a = await supabase.from('change_requests').select('*').eq('id', id).single()
    const b = await supabase.from('change_items').select('*').eq('change_id', id)
    const c = await supabase.from('tasks').select('*').eq('change_id', id).order('due_date')
    if (a.error || b.error || c.error) return setErr((a.error || b.error || c.error).message)
    let h = []
    if (c.data.length) {
      const r = await supabase.from('task_due_history').select('*').in('task_id', c.data.map(t => t.id)).order('changed_at')
      if (!r.error) h = r.data
    }
    setChange(a.data); setItems(b.data); setTasks(c.data); setHist(h); setErr('')
  }, [id])

  useEffect(() => { load() }, [load])

  if (err) return <div><a className="link" onClick={onBack}>← 목록</a><p className="err">불러오지 못했습니다: {err}</p></div>
  if (!change) return <p className="muted">불러오는 중…</p>

  const active = change.status === '진행중'
  const name = uid => (people[uid] ? people[uid].name : '알 수 없음')

  return (
    <div>
      <a className="link" onClick={onBack}>← 목록으로</a>
      <div className="detail-head">
        <span className={'badge ' + (active ? 'ing' : 'done')}>{change.status}</span>
        <h3>{change.title}</h3>
        <p className="muted">
          발의 {change.created_by_dept} ({name(change.created_by)}) · 전환 목표 {change.target_date}
          {change.closed_at && ` · 종결 ${fmtTime(change.closed_at)}`}
        </p>
        {change.description && <p>{change.description}</p>}
        {change.reason && <p className="muted">사유: {change.reason}</p>}
        <div className="chips">
          {items.map(i => <span key={i.id} className="chip">{i.item_type} · {i.item_name}</span>)}
        </div>
        <div className="task tl-card">
          <div className="task-title">부서별 일정</div>
          <ChangeTimeline change={change} tasks={tasks} />
          <TimelineLegend />
        </div>
      </div>

      {DEPARTMENTS.map(dept => {
        const ts = tasks.filter(t => t.department === dept)
        if (ts.length === 0) return null
        const mine = dept === profile.department
        return (
          <div key={dept} className="dept">
            <h4>{dept}{mine && <span className="me"> · 우리 부서</span>}</h4>
            {ts.map(t => {
              const waiting = t.status === '대기'
              const n = dday(t.due_date)
              const canDue = active && waiting && (mine || profile.department === change.created_by_dept)
              const th = hist.filter(x => x.task_id === t.id)
              return (
                <div key={t.id} className={'task ' + (waiting ? dueClass(n) : 'finished')}>
                  <div className="task-top">
                    <span className={'badge ' + (waiting ? dueClass(n) : t.status === '완료' ? 'done' : 'na')}>
                      {waiting ? ddayLabel(n) : t.status === '완료' ? '확인완료' : '해당없음'}
                    </span>
                    <span className="muted">마감 {shortDate(t.due_date)}</span>
                  </div>
                  <div className="task-title">{t.title}</div>
                  {!waiting && (
                    <div className="memo">
                      “{t.memo}”
                      <span className="muted"> — {name(t.done_by)}, {t.done_at && fmtTime(t.done_at)}</span>
                    </div>
                  )}
                  {th.map(x => (
                    <div key={x.id} className="muted small-text">
                      마감 변경 {shortDate(x.old_due)}→{shortDate(x.new_due)} · {x.reason} ({name(x.changed_by)}, {fmtTime(x.changed_at)})
                    </div>
                  ))}
                  {active && waiting && mine && <TaskAction task={t} onDone={load} />}
                  {canDue && <DueEditor task={t} onDone={load} />}
                </div>
              )
            })}
          </div>
        )
      })}

      {active && <AddTask changeId={id} profile={profile} onDone={load} />}
    </div>
  )
}

/* ---------- 변경 등록 ---------- */
function NewChange({ onCreated }) {
  const [f, setF] = useState({ title: '', description: '', reason: '', target_date: '' })
  const [items, setItems] = useState([{ type: '단품', name: '' }])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = k => e => setF({ ...f, [k]: e.target.value })

  const setItem = (i, k, v) => setItems(items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)))

  async function submit(e) {
    e.preventDefault()
    setMsg('')
    const clean = items.map(i => ({ type: i.type, name: i.name.trim() })).filter(i => i.name)
    if (clean.length === 0) return setMsg('변경 대상 품목을 1개 이상 입력해주세요. (단품·번들·띠지 등 연관 품목 포함)')
    setBusy(true)
    const { data, error } = await supabase.rpc('create_change', {
      p_title: f.title.trim(),
      p_description: f.description.trim() || null,
      p_reason: f.reason.trim() || null,
      p_change_type: '포장지 변경',
      p_target_date: f.target_date,
      p_items: clean,
    })
    setBusy(false)
    if (error) return setMsg(error.message)
    onCreated(data)
  }

  return (
    <form onSubmit={submit}>
      <label>제목</label>
      <input value={f.title} onChange={set('title')} required placeholder="예: 곰곰 교자만두 → 교자만두 포장지 변경" />
      <label>변경 내용</label>
      <textarea rows={3} value={f.description} onChange={set('description')} placeholder="무엇이 어떻게 바뀌는지" />
      <label>변경 사유</label>
      <input value={f.reason} onChange={set('reason')} placeholder="예: 제품명에서 '곰곰' 삭제" />
      <label>신규 포장지 전환일 (목표일)</label>
      <input type="date" value={f.target_date} onChange={set('target_date')} required />

      <label>변경 대상 품목 (연관 품목을 빠짐없이!)</label>
      {items.map((it, i) => (
        <div key={i} className="item-row">
          <select value={it.type} onChange={e => setItem(i, 'type', e.target.value)}>
            {ITEM_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
          <input value={it.name} onChange={e => setItem(i, 'name', e.target.value)} placeholder="품목명" />
          {items.length > 1 && <button type="button" className="small ghost" onClick={() => setItems(items.filter((_, idx) => idx !== i))}>삭제</button>}
        </div>
      ))}
      <button type="button" className="ghost" onClick={() => setItems([...items, { type: '번들/기획상품', name: '' }])}>+ 품목 추가</button>

      <p className="muted small-text">
        등록하면 부서별 기본 할 일이 자동으로 만들어집니다(마감일 = 목표일 − 템플릿 일수).
        목표일이 가까우면 일부 마감일이 이미 지난 상태로 생길 수 있으며, 등록 후 상세 화면에서 사유를 적고 조정할 수 있습니다.
      </p>
      {msg && <p className="err">{msg}</p>}
      <button disabled={busy}>{busy ? '등록 중…' : '변경 등록'}</button>
    </form>
  )
}

/* ---------- 메인 ---------- */
export default function Dashboard({ session }) {
  const [profile, setProfile] = useState(null)
  const [people, setPeople] = useState({})
  const [tab, setTab] = useState('mine')
  const [openId, setOpenId] = useState(null)
  const [err, setErr] = useState('')

  const loadPeople = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('id,name,department,email')
    if (error) return setErr(error.message)
    const map = {}
    data.forEach(p => { map[p.id] = p })
    setPeople(map)
    setProfile(map[session.user.id] || null)
    if (!map[session.user.id]) setErr('프로필이 없습니다. 관리자(동현)에게 문의해주세요.')
  }, [session.user.id])

  useEffect(() => { loadPeople() }, [loadPeople])

  if (err) return <div className="wrap"><div className="card"><p className="err">{err}</p><button className="ghost" onClick={() => supabase.auth.signOut()}>로그아웃</button></div></div>
  if (!profile) return <div className="wrap"><div className="card"><p className="muted">불러오는 중…</p></div></div>

  const goTab = t => { setTab(t); setOpenId(null) }
  const open = id => { setTab('list'); setOpenId(id) }

  return (
    <div className="app">
      <header>
        <div>
          <b>푸르온 변경점 관리</b>
          <div className="muted">{profile.name} · {profile.department}</div>
        </div>
        <div className="head-btns">
          <button className={'small ghost' + (tab === 'settings' ? ' on' : '')} onClick={() => goTab('settings')}>설정</button>
          <button className="small ghost" onClick={() => supabase.auth.signOut()}>로그아웃</button>
        </div>
      </header>

      <nav>
        <a className={tab === 'mine' ? 'on' : ''} onClick={() => goTab('mine')}>내 할 일</a>
        <a className={tab === 'timeline' ? 'on' : ''} onClick={() => goTab('timeline')}>타임라인</a>
        <a className={tab === 'list' ? 'on' : ''} onClick={() => goTab('list')}>변경 목록</a>
        <a className={tab === 'new' ? 'on' : ''} onClick={() => goTab('new')}>변경 등록</a>
      </nav>

      <main>
        {tab === 'mine' && <MyTasks key="mine" profile={profile} onOpen={open} />}
        {tab === 'timeline' && <TimelineView onOpen={open} />}
        {tab === 'list' && (openId
          ? <Detail key={openId} id={openId} profile={profile} people={people} onBack={() => setOpenId(null)} />
          : <ChangeList onOpen={setOpenId} />)}
        {tab === 'new' && <NewChange onCreated={id => open(id)} />}
        {tab === 'settings' && <Settings profile={profile} people={people} onProfileSaved={loadPeople} />}
      </main>
    </div>
  )
}
