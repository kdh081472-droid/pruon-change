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

// 비밀번호 변경: 로그인한 상태에서 바로 (메일 인증 없이)
function MyPassword() {
  const { toast } = useApp()
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function submit(e) {
    e.preventDefault()
    setMsg('')
    if (pw.length < 8) return setMsg('비밀번호는 8자 이상으로 해주세요.')
    if (pw !== pw2) return setMsg('비밀번호 확인이 일치하지 않습니다.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) {
      const m = String(error.message || '')
      return setMsg(/different from the old/i.test(m) ? '지금 쓰는 비밀번호와 다른 것으로 정해주세요.' : /reauth|recent/i.test(m) ? '보안을 위해 로그아웃한 뒤 로그인 화면의 [비밀번호 찾기]로 바꿔주세요.' : errText(error))
    }
    setPw(''); setPw2(''); setOpen(false)
    toast('비밀번호를 바꿨습니다 · 다음 로그인부터 새 비밀번호를 씁니다')
  }
  if (!open) return <div className="card nf my-info my-pw"><button type="button" className="btn ghost" onClick={() => setOpen(true)}>비밀번호 변경</button></div>
  return (
    <form className="card nf my-info my-pw" onSubmit={submit}>
      <label htmlFor="my-pw">새 비밀번호 (8자 이상)</label>
      <input id="my-pw" type={show ? 'text' : 'password'} value={pw} onChange={e => { setPw(e.target.value); setMsg('') }} autoComplete="new-password" autoFocus />
      <label htmlFor="my-pw2">새 비밀번호 확인</label>
      <input id="my-pw2" type={show ? 'text' : 'password'} value={pw2} onChange={e => { setPw2(e.target.value); setMsg('') }} autoComplete="new-password" />
      <label className="ck-row"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> 비밀번호 보기</label>
      {msg && <p className="nf-err">{msg}</p>}
      <button className="btn" disabled={busy}>{busy ? '바꾸는 중…' : '비밀번호 바꾸기'}</button>
      <button type="button" className="btn ghost" onClick={() => { setOpen(false); setPw(''); setPw2(''); setMsg('') }}>취소</button>
    </form>
  )
}

export default function Settings() {
  return <><MyInfo /><MyPassword /></>
}
