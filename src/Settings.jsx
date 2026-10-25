import { useState } from 'react'
import { supabase } from './supabase.js'
import { useApp } from './ctx.jsx'
import { errText } from './util.js'

// 내 정보: 이름 수정, 로그아웃. 부서는 가입 때만 고르고, 이후엔 관리자가 바꿈
function MyInfo() {
  const { me, reload, isAdmin, setAdminMode, wide } = useApp()
  const [name, setName] = useState(me.name)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setMsg(''); setOk(false)
    if (!name.trim()) return setMsg('이름을 입력해주세요.')
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ name: name.trim() }).eq('id', me.id)
    setBusy(false)
    if (error) return setMsg(errText(error))
    setOk(true); reload()
  }
  return (
    <form className="card nf my-info" onSubmit={submit}>
      <label>이메일 (변경 불가)</label>
      <input value={me.email} disabled />
      <label htmlFor="my-name">이름</label>
      <input id="my-name" value={name} onChange={e => setName(e.target.value)} />
      <label>소속 부서</label>
      <div className="dept-ro"><b>{me.department}</b><span>변경은 관리자에게 문의</span></div>
      <p className="hint">부서 변경이 필요하면 관리자에게 문의해주세요.</p>
      {msg && <p className="nf-err">{msg}</p>}
      {ok && <p className="ok-t">저장했습니다.</p>}
      <button className="btn" disabled={busy}>{busy ? '저장 중…' : '이름 저장'}</button>
      <button type="button" className="btn ghost" onClick={() => supabase.auth.signOut()}>로그아웃</button>
      {isAdmin && !wide && <button type="button" className="btn admin-go" onClick={() => setAdminMode(true)}>관리자 모드</button>}
    </form>
  )
}

export default function Settings() {
  return <MyInfo />
}
