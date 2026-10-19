import { useEffect, useState } from 'react'
import { supabase, configured, SIGNUP_DEPTS, VIEWER, EMAIL_DOMAIN } from './supabase.js'
import Dashboard from './Dashboard.jsx'

function errorText(err) {
  const m = (err && err.message) || ''
  if (m.includes('Invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않습니다.'
  if (m.includes('Email not confirmed')) return '이메일 인증이 아직 안 됐습니다. 메일함의 인증 링크를 눌러주세요.'
  if (m.includes('Database error saving new user'))
    return '가입코드가 틀렸거나 회사 이메일(@' + EMAIL_DOMAIN + ')이 아닙니다.'
  if (m.includes('already registered')) return '이미 가입된 이메일입니다.'
  if (m.includes('Password should be')) return '비밀번호는 6자 이상으로 해주세요.'
  if (m.includes('rate limit')) return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
  return m || '알 수 없는 오류가 발생했습니다.'
}

function Card({ title, children }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <h1>푸르온 변경점 관리</h1>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

// 아이디 저장 (이 브라우저에만 이메일을 기억)
const SAVE_KEY = 'pruon_saved_email'
function readSaved() { try { return localStorage.getItem(SAVE_KEY) || '' } catch (e) { return '' } }
function writeSaved(v) { try { v ? localStorage.setItem(SAVE_KEY, v) : localStorage.removeItem(SAVE_KEY) } catch (e) { /* 저장 불가 브라우저 */ } }

function Login({ go }) {
  const [email, setEmail] = useState(readSaved)
  const [remember, setRemember] = useState(() => !!readSaved())
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setMsg('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw })
    if (error) { setMsg(errorText(error)); setBusy(false); return }
    writeSaved(remember ? email.trim() : '')
  }

  return (
    <Card title="로그인">
      <form onSubmit={submit}>
        <label>회사 이메일</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={'name@' + EMAIL_DOMAIN} required autoComplete="email" />
        <label>비밀번호</label>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} required autoComplete="current-password" autoFocus={!!email} />
        <label className="ck-row">
          <input type="checkbox" checked={remember} onChange={e => { setRemember(e.target.checked); if (!e.target.checked) writeSaved('') }} />
          아이디 저장
        </label>
        {msg && <p className="err">{msg}</p>}
        <button disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
      </form>
      <div className="links">
        <a onClick={() => go('signup')}>가입하기</a>
        <a onClick={() => go('forgot')}>비밀번호 찾기</a>
      </div>
    </Card>
  )
}

function Signup({ go }) {
  const [f, setF] = useState({ name: '', department: '', email: '', pw: '', pw2: '', code: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)
  const set = k => e => setF({ ...f, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setMsg('')
    const email = f.email.trim().toLowerCase()
    if (!email.endsWith('@' + EMAIL_DOMAIN)) return setMsg('회사 이메일(@' + EMAIL_DOMAIN + ')만 가입할 수 있습니다.')
    if (!f.department) return setMsg('소속 부서를 선택해주세요.')
    if (f.pw.length < 8) return setMsg('비밀번호는 8자 이상으로 해주세요.')
    if (f.pw !== f.pw2) return setMsg('비밀번호 확인이 일치하지 않습니다.')
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password: f.pw,
      options: {
        data: { name: f.name.trim(), department: f.department, signup_code: f.code.trim() },
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    })
    setBusy(false)
    if (error) return setMsg(errorText(error))
    // 이미 가입된 이메일이면 identities가 비어서 돌아옴
    if (data.user && data.user.identities && data.user.identities.length === 0)
      return setMsg('이미 가입된 이메일입니다.')
    // 이메일 인증을 꺼둔 경우: 가입과 동시에 로그인되어 바로 앱 화면으로 넘어감
    if (data.session) return
    setDone(true)
  }

  if (done)
    return (
      <Card title="가입 신청 완료">
        <p>
          <b>{f.email}</b> 로 인증 메일을 보냈습니다.<br />
          메일의 링크를 누르면 가입이 끝납니다. 메일이 안 보이면 스팸함도 확인해주세요.
        </p>
        <button onClick={() => go('login')}>로그인 화면으로</button>
      </Card>
    )

  return (
    <Card title="가입하기">
      <form onSubmit={submit}>
        <label>이름</label>
        <input value={f.name} onChange={set('name')} required />
        <label>소속 부서</label>
        <select value={f.department} onChange={set('department')} required>
          <option value="">선택</option>
          {SIGNUP_DEPTS.map(d => <option key={d}>{d}</option>)}
        </select>
        {f.department === VIEWER && <p className="muted small-text">임원 계정은 보기 전용입니다. 모든 일정·이력을 볼 수 있고 대화는 쓸 수 있지만, 처리·수정은 할 수 없습니다.</p>}
        <label>회사 이메일</label>
        <input type="email" value={f.email} onChange={set('email')} placeholder={'name@' + EMAIL_DOMAIN} required autoComplete="email" />
        <label>비밀번호 (8자 이상)</label>
        <input type="password" value={f.pw} onChange={set('pw')} required autoComplete="new-password" />
        <label>비밀번호 확인</label>
        <input type="password" value={f.pw2} onChange={set('pw2')} required autoComplete="new-password" />
        <label>가입코드</label>
        <input value={f.code} onChange={set('code')} required inputMode="numeric" />
        {msg && <p className="err">{msg}</p>}
        <button disabled={busy}>{busy ? '처리 중…' : '가입하기'}</button>
      </form>
      <div className="links">
        <a onClick={() => go('login')}>이미 계정이 있어요</a>
      </div>
    </Card>
  )
}

function Forgot({ go }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setMsg('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + window.location.pathname,
    })
    setBusy(false)
    if (error) setMsg(errorText(error))
    else setSent(true)
  }

  if (sent)
    return (
      <Card title="메일을 보냈습니다">
        <p>가입된 이메일이라면 재설정 링크가 도착합니다. 링크를 눌러 새 비밀번호를 정해주세요.</p>
        <button onClick={() => go('login')}>로그인 화면으로</button>
      </Card>
    )

  return (
    <Card title="비밀번호 찾기">
      <form onSubmit={submit}>
        <label>회사 이메일</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        {msg && <p className="err">{msg}</p>}
        <button disabled={busy}>{busy ? '보내는 중…' : '재설정 메일 받기'}</button>
      </form>
      <div className="links">
        <a onClick={() => go('login')}>돌아가기</a>
      </div>
    </Card>
  )
}

function ResetPassword({ onDone }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
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
    if (error) setMsg(errorText(error))
    else onDone()
  }

  return (
    <Card title="새 비밀번호 정하기">
      <form onSubmit={submit}>
        <label>새 비밀번호 (8자 이상)</label>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} required autoComplete="new-password" />
        <label>새 비밀번호 확인</label>
        <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} required autoComplete="new-password" />
        {msg && <p className="err">{msg}</p>}
        <button disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
      </form>
    </Card>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState('login')
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!configured)
    return (
      <Card title="설정이 필요합니다">
        <p>
          <code>.env</code> 파일에 Supabase 주소와 anon 키가 없습니다.<br />
          <code>.env.example</code>을 <code>.env</code>로 복사하고 키를 넣어주세요.
        </p>
      </Card>
    )

  if (!ready) return <Card title="불러오는 중…" />
  if (recovery && session) return <ResetPassword onDone={() => setRecovery(false)} />
  if (session) return <Dashboard session={session} />
  if (view === 'signup') return <Signup go={setView} />
  if (view === 'forgot') return <Forgot go={setView} />
  return <Login go={setView} />
}
