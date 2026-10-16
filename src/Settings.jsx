import { useEffect, useState, useCallback } from 'react'
import { supabase, DEPARTMENTS } from './supabase.js'

const CHANGE_TYPE = '포장지 변경'

function fmtTime(ts) {
  return new Date(ts).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
// days_before: 양수 = 전환일 N일 전, 0 = 당일, 음수 = N일 후
function daysText(n) {
  if (n === 0) return '전환 당일'
  return n > 0 ? `전환 ${n}일 전` : `전환 ${-n}일 후`
}
function splitDays(n) {
  return { when: n === 0 ? '당일' : n > 0 ? '전' : '후', num: Math.abs(n) }
}
function joinDays(when, num) {
  const v = Math.max(0, parseInt(num, 10) || 0)
  if (when === '당일') return 0
  return when === '전' ? v : -v
}

/* ---------- 마감 일수 입력 ---------- */
function DaysInput({ when, num, onChange }) {
  return (
    <div className="days-input">
      <span>전환일</span>
      {when !== '당일' && (
        <input type="number" min="0" value={num} onChange={e => onChange(when, e.target.value)} />
      )}
      {when !== '당일' && <span>일</span>}
      <select value={when} onChange={e => onChange(e.target.value, num || 0)}>
        <option>전</option>
        <option>당일</option>
        <option>후</option>
      </select>
    </div>
  )
}

/* ---------- 템플릿 항목 하나 ---------- */
function TemplateRow({ t, onSaved }) {
  const [edit, setEdit] = useState(false)
  const [title, setTitle] = useState(t.title)
  const [d, setD] = useState(splitDays(t.days_before))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function save(patch) {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.from('templates').update(patch).eq('id', t.id).select('id')
    setBusy(false)
    if (error) return setMsg(error.message)
    if (!data || !data.length) return setMsg('저장되지 않았습니다. 권한을 확인해주세요.')
    setEdit(false); onSaved()
  }

  function submit() {
    if (!title.trim()) return setMsg('할 일 내용을 입력해주세요.')
    const days = joinDays(d.when, d.num)
    if (title.trim() === t.title && days === t.days_before) return setEdit(false)
    save({ title: title.trim(), days_before: days })
  }

  if (!edit)
    return (
      <div className={'tpl' + (t.active ? '' : ' off')}>
        <div className="tpl-main">
          <div className="task-title">{t.title}</div>
          <div className="muted small-text">
            {daysText(t.days_before)}{!t.active && ' · 사용 안 함'}
          </div>
        </div>
        <div className="tpl-btns">
          {t.active ? (
            <>
              <button className="small ghost" onClick={() => setEdit(true)}>수정</button>
              <button className="small ghost" disabled={busy} onClick={() => save({ active: false })}>사용 안 함</button>
            </>
          ) : (
            <button className="small ghost" disabled={busy} onClick={() => save({ active: true })}>다시 사용</button>
          )}
        </div>
        {msg && <p className="err">{msg}</p>}
      </div>
    )

  return (
    <div className="tpl editing">
      <label>할 일 내용</label>
      <input value={title} onChange={e => setTitle(e.target.value)} />
      <label>마감</label>
      <DaysInput when={d.when} num={d.num} onChange={(when, num) => setD({ when, num })} />
      {msg && <p className="err">{msg}</p>}
      <div className="row-actions">
        <button className="small" disabled={busy} onClick={submit}>{busy ? '저장 중…' : '저장'}</button>
        <button className="small ghost" onClick={() => { setEdit(false); setTitle(t.title); setD(splitDays(t.days_before)); setMsg('') }}>취소</button>
      </div>
    </div>
  )
}

/* ---------- 템플릿 항목 추가 ---------- */
function AddTemplate({ dept, nextOrder, onSaved }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [d, setD] = useState({ when: '전', num: 14 })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit() {
    if (!title.trim()) return setMsg('할 일 내용을 입력해주세요.')
    setBusy(true); setMsg('')
    const { error } = await supabase.from('templates').insert({
      change_type: CHANGE_TYPE, department: dept, title: title.trim(),
      days_before: joinDays(d.when, d.num), sort_order: nextOrder,
    })
    setBusy(false)
    if (error) return setMsg(error.message)
    setOpen(false); setTitle(''); onSaved()
  }

  if (!open) return <a className="link" onClick={() => setOpen(true)}>+ {dept} 기본 할 일 추가</a>
  return (
    <div className="tpl editing">
      <label>할 일 내용</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 신규 박스 인쇄 시안 확인" />
      <label>마감</label>
      <DaysInput when={d.when} num={d.num} onChange={(when, num) => setD({ when, num })} />
      {msg && <p className="err">{msg}</p>}
      <div className="row-actions">
        <button className="small" disabled={busy} onClick={submit}>{busy ? '추가 중…' : '추가'}</button>
        <button className="small ghost" onClick={() => { setOpen(false); setMsg('') }}>취소</button>
      </div>
    </div>
  )
}

/* ---------- 템플릿 관리 ---------- */
function Templates({ people }) {
  const [rows, setRows] = useState(null)
  const [hist, setHist] = useState([])
  const [showHist, setShowHist] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const a = await supabase.from('templates').select('*').eq('change_type', CHANGE_TYPE).order('sort_order')
    const b = await supabase.from('template_history').select('*').order('changed_at', { ascending: false }).limit(30)
    if (a.error) return setErr(a.error.message)
    setRows(a.data); setHist(b.error ? [] : b.data); setErr('')
  }, [])

  useEffect(() => { load() }, [load])

  if (err) return <p className="err">불러오지 못했습니다: {err}</p>
  if (!rows) return <p className="muted">불러오는 중…</p>

  const maxOrder = rows.reduce((m, r) => Math.max(m, r.sort_order), 0)
  const name = uid => (uid && people[uid] ? `${people[uid].name}(${people[uid].department})` : '초기 설정')

  return (
    <div>
      <p className="muted">
        변경을 등록할 때 자동으로 만들어지는 부서별 할 일입니다. 여기서 고친 내용은
        <b> 앞으로 새로 등록하는 변경</b>부터 적용되고, 이미 진행 중인 변경에는 영향이 없습니다.
        누가 언제 고쳤는지는 아래 수정 이력에 남습니다.
      </p>

      {DEPARTMENTS.map(dept => {
        const ts = rows.filter(r => r.department === dept)
        return (
          <div key={dept} className="dept">
            <h4>{dept} <span className="muted small-text">{ts.filter(t => t.active).length}개 사용 중</span></h4>
            {ts.map(t => <TemplateRow key={t.id} t={t} onSaved={load} />)}
            <AddTemplate dept={dept} nextOrder={maxOrder + 1} onSaved={load} />
          </div>
        )
      })}

      <div className="dept">
        <h4>
          수정 이력{' '}
          <a className="link" onClick={() => setShowHist(!showHist)}>{showHist ? '접기' : `펼치기 (최근 ${hist.length}건)`}</a>
        </h4>
        {showHist && hist.map(h => (
          <div key={h.id} className="hist">
            <span className="badge">{h.action === '비활성화' ? '사용 안 함' : h.action}</span>{' '}
            {h.action === '추가' && <>“{h.new_title}” · {daysText(h.new_days)}</>}
            {h.action === '비활성화' && <>“{h.old_title}” 사용 안 함</>}
            {h.action === '수정' && (
              <>
                {h.old_title !== h.new_title ? <>“{h.old_title}” → “{h.new_title}”</> : <>“{h.new_title}”</>}
                {h.old_days !== h.new_days && <> · {daysText(h.old_days)} → {daysText(h.new_days)}</>}
                {h.old_title === h.new_title && h.old_days === h.new_days && <> · 다시 사용</>}
              </>
            )}
            <div className="muted small-text">{name(h.changed_by)} · {fmtTime(h.changed_at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- 내 정보 ---------- */
function MyInfo({ profile, onSaved }) {
  const [name, setName] = useState(profile.name)
  const [dept, setDept] = useState(profile.department)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setMsg(''); setOk(false)
    if (!name.trim()) return setMsg('이름을 입력해주세요.')
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ name: name.trim(), department: dept }).eq('id', profile.id)
    setBusy(false)
    if (error) return setMsg(error.message)
    setOk(true); onSaved()
  }

  return (
    <form onSubmit={submit}>
      <label>이메일 (변경 불가)</label>
      <input value={profile.email} disabled />
      <label>이름</label>
      <input value={name} onChange={e => setName(e.target.value)} />
      <label>소속 부서</label>
      <select value={dept} onChange={e => setDept(e.target.value)}>
        {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
      </select>
      {dept !== profile.department && (
        <p className="muted small-text">
          부서를 바꾸면 이제부터 <b>{dept}</b> 부서의 할 일을 처리하게 됩니다. 이미 처리한 기록은 그대로 남습니다.
        </p>
      )}
      {msg && <p className="err">{msg}</p>}
      {ok && <p className="ok">저장했습니다.</p>}
      <button disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
    </form>
  )
}

/* ---------- 설정 ---------- */
export default function Settings({ profile, people, onProfileSaved }) {
  const [sub, setSub] = useState('tpl')
  return (
    <div>
      <div className="seg">
        <a className={sub === 'tpl' ? 'on' : ''} onClick={() => setSub('tpl')}>기본 할 일(템플릿)</a>
        <a className={sub === 'me' ? 'on' : ''} onClick={() => setSub('me')}>내 정보</a>
      </div>
      {sub === 'tpl' ? <Templates people={people} /> : <MyInfo profile={profile} onSaved={onProfileSaved} />}
    </div>
  )
}
