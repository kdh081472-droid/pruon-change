import { useState } from 'react'
import { supabase, SIGNUP_DEPTS, isViewDept } from './supabase.js'
import { useApp } from './ctx.jsx'
import { errText } from './util.js'

// 내 정보: 이름·부서 수정, 로그아웃, (관리자만) 관리자 모드 전환
function MyInfo() {
  const { me, reload, isAdmin, setAdminMode } = useApp()
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
          {isViewDept(dept) ? dept + '은(는) 보기 전용 부서입니다. 처리·수정은 할 수 없고 대화만 쓸 수 있습니다.'
            : <>부서를 바꾸면 이제부터 <b>{dept}</b> 부서의 할 일을 처리하게 됩니다. 이미 처리한 기록은 그대로 남습니다.</>}
        </p>
      )}
      {msg && <p className="nf-err">{msg}</p>}
      {ok && <p className="ok-t">저장했습니다.</p>}
      <button className="btn" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
      <button type="button" className="btn ghost" onClick={() => supabase.auth.signOut()}>로그아웃</button>
      {isAdmin && <button type="button" className="btn admin-go" onClick={() => setAdminMode(true)}>관리자 모드</button>}
    </form>
  )
}

export default function Settings() {
  return <MyInfo />
}
