import { useCallback, useEffect, useState } from 'react'
import { supabase, ORDER, SIGNUP_DEPTS, VIEWER } from './supabase.js'
import { useApp, Person } from './ctx.jsx'
import { dayTxt, stamp, errText } from './util.js'

const CHANGE_TYPE = '포장지 변경'

function split(n) { return { when: n === 0 ? '당일' : n > 0 ? '전' : '후', num: Math.abs(n) } }
function join(when, num) {
  const v = Math.max(0, parseInt(num, 10) || 0)
  return when === '당일' ? 0 : when === '전' ? v : -v
}

function DaysInput({ v, onChange }) {
  return (
    <div className="days-input">
      <span>전환일</span>
      {v.when !== '당일' && <input type="number" min="0" value={v.num} onChange={e => onChange({ ...v, num: e.target.value })} />}
      {v.when !== '당일' && <span>일</span>}
      <select value={v.when} onChange={e => onChange({ ...v, when: e.target.value })}>
        <option>전</option><option>당일</option><option>후</option>
      </select>
    </div>
  )
}

function TemplateRow({ t, viewer, onSaved }) {
  const [edit, setEdit] = useState(false)
  const [title, setTitle] = useState(t.title)
  const [d, setD] = useState(split(t.days_before))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function save(patch) {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.from('templates').update(patch).eq('id', t.id).select('id')
    setBusy(false)
    if (error) return setMsg(errText(error))
    if (!data || !data.length) return setMsg('저장되지 않았습니다. 권한을 확인해주세요.')
    setEdit(false); onSaved()
  }
  if (!edit) return (
    <div className={'tpl' + (t.active ? '' : ' off')}>
      <div className="tpl-main">
        <div className="tpl-t">{t.title}</div>
        <div className="hint">{dayTxt(t.days_before)}{!t.active && ' · 사용 안 함'}</div>
      </div>
      {!viewer && (
        <div className="tpl-btns">
          {t.active ? (
            <>
              <button type="button" className="btn sm ghost" onClick={() => setEdit(true)}>수정</button>
              <button type="button" className="btn sm ghost" disabled={busy} onClick={() => save({ active: false })}>사용 안 함</button>
            </>
          ) : <button type="button" className="btn sm ghost" disabled={busy} onClick={() => save({ active: true })}>다시 사용</button>}
        </div>
      )}
      {msg && <p className="err">{msg}</p>}
    </div>
  )
  return (
    <div className="tpl form">
      <label>할 일 내용</label>
      <input value={title} onChange={e => setTitle(e.target.value)} />
      <label>마감</label>
      <DaysInput v={d} onChange={setD} />
      {msg && <p className="err">{msg}</p>}
      <div className="pb-row">
        <button type="button" className="btn sm" disabled={busy} onClick={() => {
          if (!title.trim()) return setMsg('할 일 내용을 입력해주세요.')
          const days = join(d.when, d.num)
          if (title.trim() === t.title && days === t.days_before) return setEdit(false)
          save({ title: title.trim(), days_before: days })
        }}>{busy ? '저장 중…' : '저장'}</button>
        <button type="button" className="btn sm ghost" onClick={() => { setEdit(false); setTitle(t.title); setD(split(t.days_before)); setMsg('') }}>취소</button>
      </div>
    </div>
  )
}

function AddTemplate({ dept, nextOrder, onSaved }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [d, setD] = useState({ when: '전', num: 14 })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  if (!open) return <button type="button" className="link nf-plus" onClick={() => setOpen(true)}>+ {dept} 기본 할 일 추가</button>
  return (
    <div className="tpl form">
      <label>할 일 내용</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 신규 박스 인쇄 시안 확인" />
      <label>마감</label>
      <DaysInput v={d} onChange={setD} />
      {msg && <p className="err">{msg}</p>}
      <div className="pb-row">
        <button type="button" className="btn sm" disabled={busy} onClick={async () => {
          if (!title.trim()) return setMsg('할 일 내용을 입력해주세요.')
          setBusy(true); setMsg('')
          const { error } = await supabase.from('templates').insert({ change_type: CHANGE_TYPE, department: dept, title: title.trim(), days_before: join(d.when, d.num), sort_order: nextOrder })
          setBusy(false)
          if (error) return setMsg(errText(error))
          setOpen(false); setTitle(''); onSaved()
        }}>{busy ? '추가 중…' : '추가'}</button>
        <button type="button" className="btn sm ghost" onClick={() => { setOpen(false); setMsg('') }}>취소</button>
      </div>
    </div>
  )
}

function Templates() {
  const { db, viewer, reload } = useApp()
  const [hist, setHist] = useState([])
  const [showHist, setShowHist] = useState(false)
  const loadHist = useCallback(async () => {
    const { data } = await supabase.from('template_history').select('*').order('changed_at', { ascending: false }).limit(50)
    setHist(data || [])
  }, [])
  useEffect(() => { loadHist() }, [loadHist])
  const onSaved = async () => { await reload(); loadHist() }
  const rows = db.templates
  const maxOrder = rows.reduce((m, r) => Math.max(m, r.sort_order), 0)
  return (
    <>
      <p className="hint" style={{ margin: '0 2px 10px' }}>
        변경을 등록할 때 "기본" 배정 목록으로 나오는 부서별 할 일입니다. 여기서 고친 내용은 <b>앞으로 새로 등록하는 변경</b>부터 적용되고,
        진행 중인 변경에는 영향이 없습니다. 누가 언제 고쳤는지는 아래 수정 이력에 남습니다.{viewer && ' (임원 계정은 보기만 가능)'}
      </p>
      {ORDER.map(dept => {
        const ts = rows.filter(r => r.department === dept)
        return (
          <section key={dept} className="dept">
            <div className="grp"><span className="dn">{dept}</span><span className="st">{ts.filter(t => t.active).length}개 사용 중</span></div>
            {ts.map(t => <TemplateRow key={t.id + t.title + t.days_before + t.active} t={t} viewer={viewer} onSaved={onSaved} />)}
            {!viewer && <AddTemplate dept={dept} nextOrder={maxOrder + 1} onSaved={onSaved} />}
          </section>
        )
      })}
      <section className="dept">
        <div className="grp">
          <span className="dn">수정 이력</span>
          <button type="button" className="link st" onClick={() => setShowHist(!showHist)}>{showHist ? '접기' : `펼치기 (최근 ${hist.length}건)`}</button>
        </div>
        {showHist && (
          <div className="hist" style={{ borderTop: 0 }}>
            <ol>
              {hist.map(h => (
                <li key={h.id}>
                  <b>{h.action === '비활성화' ? '사용 안 함' : h.action}</b>{' '}
                  {h.action === '추가' && <>“{h.new_title}” · {dayTxt(h.new_days)}</>}
                  {h.action === '비활성화' && <>“{h.old_title}”</>}
                  {h.action === '수정' && (
                    <>
                      {h.old_title !== h.new_title ? <>“{h.old_title}” → “{h.new_title}”</> : <>“{h.new_title}”</>}
                      {h.old_days !== h.new_days && <> · {dayTxt(h.old_days)} → {dayTxt(h.new_days)}</>}
                      {h.old_title === h.new_title && h.old_days === h.new_days && <> · 다시 사용</>}
                    </>
                  )}
                  <br /><Person id={h.changed_by} fallback="초기 설정" /> · {stamp(h.changed_at)}
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </>
  )
}

function MyInfo() {
  const { me, reload } = useApp()
  const [name, setName] = useState(me.name)
  const [dept, setDept] = useState(me.department)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setMsg(''); setOk(false)
    if (!name.trim()) return setMsg('이름을 입력해주세요.')
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ name: name.trim(), department: dept }).eq('id', me.id)
    setBusy(false)
    if (error) return setMsg(errText(error))
    setOk(true); reload()
  }
  return (
    <form className="card nf" onSubmit={submit}>
      <label>이메일 (변경 불가)</label>
      <input value={me.email} disabled />
      <label>이름</label>
      <input value={name} onChange={e => setName(e.target.value)} />
      <label>소속 부서</label>
      <select value={dept} onChange={e => setDept(e.target.value)}>{SIGNUP_DEPTS.map(d => <option key={d}>{d}</option>)}</select>
      {dept !== me.department && (
        <p className="hint">
          {dept === VIEWER ? '임원 계정은 보기 전용입니다. 처리·수정은 할 수 없고 대화만 쓸 수 있습니다.'
            : <>부서를 바꾸면 이제부터 <b>{dept}</b> 부서의 할 일을 처리하게 됩니다. 이미 처리한 기록은 그대로 남습니다.</>}
        </p>
      )}
      {msg && <p className="nf-err">{msg}</p>}
      {ok && <p className="ok-t">저장했습니다.</p>}
      <button className="btn" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
      <button type="button" className="btn ghost" onClick={() => supabase.auth.signOut()}>로그아웃</button>
    </form>
  )
}

export default function Settings() {
  return <MyInfo />
}
