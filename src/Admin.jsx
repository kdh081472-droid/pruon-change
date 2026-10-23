import { useCallback, useEffect, useState } from 'react'
import { supabase, ORDER, SIGNUP_DEPTS } from './supabase.js'
import { useApp, ICON, useWidth, WIDE } from './ctx.jsx'
import { errText, md, stampFull } from './util.js'
import Report from './Report.jsx'

// 마지막 접속 = 앱을 쓴 시각 (없으면 마지막 로그인 시각)
const seenOf = u => u.last_seen_at || u.last_sign_in_at || null

// 관리자 모드: 관리 기능만 (업무 화면은 모두 꺼짐). 관리자 여부는 서버가 매번 다시 검사함
const TABS = [['users', '가입자', 'users'], ['dept', '부서', 'org'], ['tpl', '기본 할 일', 'list'], ['del', '변경 삭제', 'trash'], ['stat', '사용 현황', 'stat']]

export default function Admin({ onExit }) {
  const app = useApp()
  const { db, me } = app
  const wide = useWidth() >= WIDE
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState(null)
  const [uErr, setUErr] = useState('')
  const [reportCid, setReportCid] = useState(null)

  const loadUsers = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_users')
    if (error) return setUErr(errText(error))
    setUErr(''); setUsers(data || [])
  }, [])
  useEffect(() => { loadUsers() }, [loadUsers])

  // 서버 함수 실행 → 성공하면 앱 데이터 + 가입자 목록 다시 불러오기
  const act = async (fn, args, ok) => {
    const r = await app.run(fn, args, ok)
    if (!r.error) await loadUsers()
    return r
  }
  const counts = { users: users ? users.filter(u => !u.left_at).length : '', dept: db.depts.length, del: db.changes.length }
  const body = {
    users: <UsersTab users={users} err={uErr} act={act} />,
    dept: <DeptTab users={users} act={act} />,
    tpl: <TplTab act={act} />,
    del: <DeleteTab act={act} openReport={setReportCid} />,
    stat: <StatTab users={users} />,
  }[tab]

  return (
    <div className={'adm' + (wide ? ' wide' : '')}>
      <aside className="adm-side">
        <div className="brand">푸르온 변경점 관리 · 관리자</div>
        <div className="adm-me"><b>{me.name}</b><span className="pn-e">{me.email.split('@')[0]}</span></div>
        <nav className="adm-nav">
          {TABS.map(([k, l, ic]) => (
            <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => { setTab(k); window.scrollTo(0, 0) }}>
              {ICON[ic]}<span>{l}</span>{counts[k] !== undefined && counts[k] !== '' && <em>{counts[k]}</em>}
            </button>
          ))}
        </nav>
        <button type="button" className="adm-exit" onClick={onExit}>{ICON.back}업무 모드로 돌아가기</button>
      </aside>
      <main className="adm-main">
        <div className="adm-band"><b>관리자 모드</b><span>업무 기능(할 일 처리·등록·대화)은 꺼져 있습니다</span><button type="button" onClick={onExit}>업무 모드로</button></div>
        {body}
      </main>
      {reportCid && db.changeMap[reportCid] && <Report cid={reportCid} onClose={() => setReportCid(null)} />}
    </div>
  )
}

function Head({ title, sub, children }) {
  return (
    <div className="adm-h">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children}
    </div>
  )
}

function useBusyAct(act) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async (fn, args, ok) => {
    if (busy) return { error: 'busy' }
    setBusy(true); setErr('')
    const r = await act(fn, args, ok)
    setBusy(false)
    if (r.error) setErr(r.error)
    return r
  }
  return { busy, err, setErr, go }
}

/* ---------- 가입자 ---------- */
function UsersTab({ users, err, act }) {
  const { me } = useApp()
  const [f, setF] = useState('all')
  const [ask, setAsk] = useState(null)       // 퇴사 확인 대상
  const { busy, err: aErr, setErr, go } = useBusyAct(act)
  if (err) return <><Head title="가입자" /><div className="card empty">{err}</div></>
  if (!users) return <><Head title="가입자" /><div className="card empty">불러오는 중…</div></>
  const active = users.filter(u => !u.left_at)
  const admins = active.filter(u => u.is_admin)
  const list = users.filter(u => (f === 'all' ? !u.left_at : f === 'left' ? u.left_at : u.is_admin && !u.left_at))
  const target = ask && users.find(u => u.id === ask)
  return (
    <>
      <Head title="가입자" sub="부서 배치, 관리자 지정, 퇴사 처리">
        <div className="seg sm">
          {[['all', '재직 ' + active.length], ['admin', '관리자 ' + admins.length], ['left', '퇴사 ' + (users.length - active.length)]].map(([k, l]) => (
            <button key={k} type="button" className={f === k ? 'on' : ''} onClick={() => { setF(k); setAsk(null) }}>{l}</button>
          ))}
        </div>
      </Head>
      {target && (
        <div className="adm-confirm">
          <h3>{target.name} ({target.email})을 퇴사 처리할까요?</h3>
          <p>로그인이 막히고 열려 있는 화면에서도 로그아웃됩니다. 조직도·@부르기·안 읽은 사람 수에서 빠지고, 지난 확인 메모와 대화는 "{target.name} (퇴사)"로 그대로 남습니다. 복직 처리로 되돌릴 수 있습니다.</p>
          {aErr && <p className="err">{aErr}</p>}
          <div className="row">
            <button type="button" className="btn sm warn" disabled={busy} onClick={async () => { const r = await go('admin_set_left', { p_user: target.id, p_left: true }, target.name + '님을 퇴사 처리했습니다'); if (!r.error) setAsk(null) }}>퇴사 처리</button>
            <button type="button" className="btn sm ghost" onClick={() => { setAsk(null); setErr('') }}>취소</button>
          </div>
        </div>
      )}
      {!target && aErr && <p className="err">{aErr}</p>}
      <div className="card adm-card">
        <div className="tw">
          <table className="adm-t">
            <thead><tr><th>이름</th><th>이메일</th><th>부서</th><th>가입일</th><th>마지막 접속</th><th>상태</th><th className="ra">관리</th></tr></thead>
            <tbody>
              {list.map(u => (
                <tr key={u.id} className={u.left_at ? 'left' : ''}>
                  <td><b className="nm">{u.name}</b>{u.id === me.id && <span className="chip-me">나</span>}</td>
                  <td className="mono">{u.email}</td>
                  <td>
                    {u.left_at ? u.department : (
                      <select value={u.department} aria-label={u.name + ' 부서'} disabled={busy}
                        onChange={e => go('admin_set_dept', { p_user: u.id, p_dept: e.target.value }, `${u.name}: ${u.department} → ${e.target.value}`)}>
                        {!SIGNUP_DEPTS.includes(u.department) && <option>{u.department}</option>}
                        {SIGNUP_DEPTS.map(d => <option key={d}>{d}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="mono">{stampFull(u.created_at).slice(2, 10)}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{seenOf(u) ? stampFull(seenOf(u)).slice(2) : '-'}</td>
                  <td>{u.left_at ? <span className="st off">퇴사</span> : <><span className="st on">재직</span>{u.is_admin && <span className="st adm">관리자</span>}</>}</td>
                  <td>
                    <div className="acts">
                      {u.left_at
                        ? <button type="button" className="btn sm ghost" disabled={busy} onClick={() => go('admin_set_left', { p_user: u.id, p_left: false }, u.name + '님을 복직 처리했습니다')}>복직 처리</button>
                        : <>
                            <button type="button" className="btn sm ghost" disabled={busy}
                              onClick={() => go('admin_set_admin', { p_user: u.id, p_on: !u.is_admin }, u.is_admin ? u.name + '님의 관리자를 해제했습니다' : u.name + '님을 관리자로 지정했습니다')}>
                              {u.is_admin ? '관리자 해제' : '관리자로 지정'}
                            </button>
                            <button type="button" className="btn sm ghost warn-t" disabled={busy || u.id === me.id} title={u.id === me.id ? '본인은 퇴사 처리할 수 없습니다' : ''}
                              onClick={() => { setAsk(u.id); setErr(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>퇴사 처리</button>
                          </>}
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={7} className="muted">해당하는 사람이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="note">'관리자' 표시는 관리자 모드에서만 보입니다. 마지막 남은 관리자는 해제할 수 없고, 본인은 퇴사 처리할 수 없습니다.</p>
      </div>
    </>
  )
}

/* ---------- 부서 ---------- */
function DeptTab({ users, act }) {
  const { db } = useApp()
  const depts = [...db.depts].sort((a, b) => a.sort_order - b.sort_order)
  const [open, setOpen] = useState(null)       // { kind: 'rename' | 'del', name }
  const [rn, setRn] = useState({ name: '', short: '' })
  const [moveTo, setMoveTo] = useState('')
  const [nd, setNd] = useState({ name: '', short: '', kind: '업무' })
  const { busy, err, setErr, go } = useBusyAct(act)
  const active = (users || []).filter(u => !u.left_at)
  const pending = d => db.tasks.filter(t => t.department === d && t.status === '대기' && db.changeMap[t.change_id] && db.changeMap[t.change_id].status === '진행중').length
  const move = (i, k) => {
    const j = i + k
    if (j < 0 || j >= depts.length) return
    const names = depts.map(d => d.name);
    [names[i], names[j]] = [names[j], names[i]]
    go('admin_dept_order', { p_names: names })
  }
  return (
    <>
      <Head title="부서" sub="업무 부서는 할 일을 받고, 보기 전용 부서는 보기와 대화만 합니다" />
      {err && !open && <p className="err">{err}</p>}
      <div className="card adm-card">
        <div className="dl2">
          {depts.map((d, i) => {
            const n = active.filter(u => u.department === d.name).length
            const lt = d.kind === '업무' ? pending(d.name) : 0
            const isOpen = open && open.name === d.name
            return (
              <div key={d.name}>
                <div className="dr2">
                  <div className="ord">
                    <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={d.name + ' 위로'}>▲</button>
                    <button type="button" disabled={busy || i === depts.length - 1} onClick={() => move(i, 1)} aria-label={d.name + ' 아래로'}>▼</button>
                  </div>
                  <div className="dn"><b>{d.name}</b><span>{n}명{d.kind === '업무' ? ` · 진행 중 할 일 ${lt}건 · 기본 할 일 ${db.templates.filter(t => t.department === d.name).length}건` : ''}</span></div>
                  <span className="sh mono">{d.short}</span>
                  <select value={d.kind} disabled={busy} aria-label={d.name + ' 종류'}
                    onChange={e => go('admin_dept_save', { p_old: d.name, p_name: d.name, p_short: d.short, p_kind: e.target.value }, `${d.name} → ${e.target.value === '업무' ? '업무 부서' : '보기 전용'}`)}>
                    <option value="업무">업무 부서</option><option value="보기">보기 전용</option>
                  </select>
                  <div className="acts">
                    <button type="button" className="btn sm ghost" onClick={() => { setOpen({ kind: 'rename', name: d.name }); setRn({ name: d.name, short: d.short }); setErr('') }}>이름 변경</button>
                    <button type="button" className="btn sm ghost warn-t" onClick={() => { setOpen({ kind: 'del', name: d.name }); setMoveTo(ORDER.find(x => x !== d.name) || ''); setErr('') }}>삭제</button>
                  </div>
                </div>
                {isOpen && open.kind === 'rename' && (
                  <div className="adm-confirm soft">
                    <h3>{d.name} 이름 변경</h3>
                    <div className="row">
                      <input value={rn.name} onChange={e => setRn({ ...rn, name: e.target.value })} aria-label="새 부서 이름" />
                      <input className="short" value={rn.short} maxLength={4} onChange={e => setRn({ ...rn, short: e.target.value })} aria-label="짧은 이름" />
                    </div>
                    <p>진행 중인 할 일과 지난 기록도 새 이름으로 바뀝니다. 짧은 이름은 목록·대화에 붙는 2~4글자입니다.</p>
                    {err && <p className="err">{err}</p>}
                    <div className="row">
                      <button type="button" className="btn sm" disabled={busy} onClick={async () => { const r = await go('admin_dept_save', { p_old: d.name, p_name: rn.name.trim(), p_short: rn.short.trim(), p_kind: d.kind }, '부서 이름을 바꿨습니다'); if (!r.error) setOpen(null) }}>저장</button>
                      <button type="button" className="btn sm ghost" onClick={() => setOpen(null)}>취소</button>
                    </div>
                  </div>
                )}
                {isOpen && open.kind === 'del' && (n > 0 ? (
                  <div className="adm-confirm soft">
                    <h3>{d.name}에 {n}명이 있어 삭제할 수 없습니다</h3>
                    <p>가입자 탭에서 먼저 다른 부서로 옮겨주세요.</p>
                    <div className="row"><button type="button" className="btn sm ghost" onClick={() => setOpen(null)}>닫기</button></div>
                  </div>
                ) : (
                  <div className="adm-confirm">
                    <h3>{d.name} 부서를 삭제할까요?</h3>
                    {lt > 0 ? (
                      <div className="row">
                        <span>진행 중 할 일 {lt}건을 넘겨받을 부서</span>
                        <select value={moveTo} onChange={e => setMoveTo(e.target.value)} aria-label="넘겨받을 부서">
                          {ORDER.filter(x => x !== d.name).map(x => <option key={x}>{x}</option>)}
                        </select>
                      </div>
                    ) : <p>진행 중인 할 일이 없습니다.</p>}
                    <p>종결된 기록에는 옛 부서 이름이 그대로 남습니다. 이 부서의 기본 할 일도 함께 빠집니다.</p>
                    {err && <p className="err">{err}</p>}
                    <div className="row">
                      <button type="button" className="btn sm warn" disabled={busy} onClick={async () => { const r = await go('admin_dept_delete', { p_name: d.name, p_move_to: lt ? moveTo : null }, d.name + ' 부서를 삭제했습니다'); if (!r.error) setOpen(null) }}>삭제</button>
                      <button type="button" className="btn sm ghost" onClick={() => setOpen(null)}>취소</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        <form className="adm-add" onSubmit={async e => {
          e.preventDefault()
          const r = await go('admin_dept_save', { p_old: null, p_name: nd.name.trim(), p_short: nd.short.trim(), p_kind: nd.kind }, nd.name.trim() + ' 부서를 추가했습니다' + (nd.kind === '업무' ? ' · 기본 할 일을 채워주세요' : ''))
          if (!r.error) setNd({ name: '', short: '', kind: '업무' })
        }}>
          <label className="w1">새 부서 이름<input value={nd.name} onChange={e => setNd({ ...nd, name: e.target.value })} placeholder="예: 경영지원팀" required /></label>
          <label className="w2">짧은 이름<input value={nd.short} maxLength={4} onChange={e => setNd({ ...nd, short: e.target.value })} placeholder="경영" required /></label>
          <label className="w3">종류<select value={nd.kind} onChange={e => setNd({ ...nd, kind: e.target.value })}><option value="업무">업무 부서</option><option value="보기">보기 전용</option></select></label>
          <button type="submit" className="btn sm" disabled={busy}>부서 추가</button>
        </form>
        <p className="note">순서는 변경 등록 화면, 제품 카드의 부서별 목록, 보고서, 조직도에 그대로 쓰입니다. 진행 중 할 일이 남은 부서는 보기 전용으로 바꿀 수 없습니다.</p>
      </div>
    </>
  )
}

/* ---------- 기본 할 일 ---------- */
function TplTab({ act }) {
  const { db } = useApp()
  const [dept, setDept] = useState(ORDER[0])
  const [title, setTitle] = useState('')
  const [edit, setEdit] = useState({})
  const { busy, err, go } = useBusyAct(act)
  const cur = ORDER.includes(dept) ? dept : ORDER[0]
  const rows = db.templates.filter(t => t.department === cur)
  return (
    <>
      <Head title="기본 할 일" sub={`변경을 등록할 때 자동으로 나오는 할 일 · 업무 부서 ${ORDER.length}곳, 모두 ${db.templates.filter(t => ORDER.includes(t.department)).length}건`} />
      <div className="card adm-card">
        <div className="seg sm wrap">
          {ORDER.map(d => <button key={d} type="button" className={cur === d ? 'on' : ''} onClick={() => setDept(d)}>{d} {db.templates.filter(t => t.department === d).length}</button>)}
        </div>
        {err && <p className="err">{err}</p>}
        <div className="tl2">
          {rows.map(t => {
            const v = edit[t.id] !== undefined ? edit[t.id] : t.title
            const changed = v.trim() !== t.title
            return (
              <div className="tr2" key={t.id}>
                <input value={v} aria-label="할 일 내용" onChange={e => setEdit({ ...edit, [t.id]: e.target.value })} />
                <div className="acts">
                  {changed && <button type="button" className="btn sm" disabled={busy} onClick={async () => { const r = await go('admin_tpl_save', { p_id: t.id, p_dept: cur, p_title: v.trim() }, '기본 할 일을 고쳤습니다'); if (!r.error) setEdit(x => { const y = { ...x }; delete y[t.id]; return y }) }}>저장</button>}
                  <button type="button" className="btn sm ghost warn-t" disabled={busy} onClick={() => go('admin_tpl_delete', { p_id: t.id }, '기본 할 일을 삭제했습니다')}>삭제</button>
                </div>
              </div>
            )
          })}
          {!rows.length && <p className="muted">아직 기본 할 일이 없습니다. 아래에서 추가해주세요.</p>}
        </div>
        <form className="adm-add" onSubmit={async e => {
          e.preventDefault()
          const r = await go('admin_tpl_save', { p_id: null, p_dept: cur, p_title: title.trim() }, '기본 할 일을 추가했습니다')
          if (!r.error) setTitle('')
        }}>
          <label className="w1">{cur} 할 일 추가<input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 신규 자재 샘플 승인" required /></label>
          <button type="submit" className="btn sm" disabled={busy}>추가</button>
        </form>
        <p className="note">마감일은 없습니다. 고친 내용은 앞으로 등록하는 변경부터 적용되고, 진행 중인 변경은 바뀌지 않습니다. 포장지가 아닌 변경(원료 등)은 변경 등록 화면에서 할 일을 고른 뒤 배정 목록으로 저장해 쓰세요.</p>
      </div>
    </>
  )
}

/* ---------- 변경 삭제 ---------- */
function DeleteTab({ act, openReport }) {
  const { db, tOf } = useApp()
  const [q, setQ] = useState('')
  const [ask, setAsk] = useState(null)
  const [typed, setTyped] = useState('')
  const { busy, err, setErr, go } = useBusyAct(act)
  const list = [...db.changes]
    .filter(c => !q.trim() || c.title.includes(q.trim()))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === '진행중' ? -1 : 1) || String(b.created_at).localeCompare(String(a.created_at)))
  return (
    <>
      <Head title="변경 삭제" sub="진행 중·종결 모두 완전히 지웁니다. 삭제 기록도 남지 않습니다">
        <label className="search adm-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="제목 검색" aria-label="변경 검색" />
        </label>
      </Head>
      <div className="card adm-card">
        <div className="cl2">
          {list.map(c => {
            const ts = tOf(c.id), dn = ts.filter(t => t.status !== '대기').length
            const isOpen = ask === c.id
            return (
              <div key={c.id} className="ci2">
                <div className="t"><b>{c.title}</b><span>전환 {md(c.target_date)} · 할 일 {dn}/{ts.length} 처리 · 대화 {db.messages.filter(m => m.change_id === c.id).length}개 · 등록 {stampFull(c.created_at).slice(0, 10)}</span></div>
                <span className={'ps2 ' + (c.status === '진행중' ? 'live' : 'fin')}>{c.status === '진행중' ? '진행 중' : c.close_type === '중단' ? '중단 종결' : '종결'}</span>
                <button type="button" className="btn sm ghost warn-t" onClick={() => { setAsk(isOpen ? null : c.id); setTyped(''); setErr('') }}>완전 삭제</button>
                {isOpen && (
                  <div className="adm-confirm">
                    <h3>되살릴 수 없습니다</h3>
                    <ul>
                      <li>할 일 {ts.length}건, 처리 이력, 전환일 변경 이력</li>
                      <li>제품 대화와 읽음 기록</li>
                      <li>이 건으로 만든 배정 목록</li>
                      {c.status === '진행중' && <li>각 부서 "내 할 일"에서도 바로 빠집니다</li>}
                    </ul>
                    {c.status === '종결' && <div className="row"><button type="button" className="btn sm ghost" onClick={() => openReport(c.id)}>결과 보고서 PDF 먼저 받기</button></div>}
                    <p>확인을 위해 제목을 그대로 입력해주세요: <b>{c.title}</b></p>
                    <div className="row">
                      <input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" aria-label="삭제할 변경 제목 입력" />
                      <button type="button" className="btn sm warn" disabled={busy || typed.trim() !== c.title}
                        onClick={async () => { const r = await go('admin_delete_change', { p_change: c.id, p_confirm: typed.trim() }, `"${c.title}"을 완전히 삭제했습니다`); if (!r.error) setAsk(null) }}>완전 삭제</button>
                      <button type="button" className="btn sm ghost" onClick={() => setAsk(null)}>취소</button>
                    </div>
                    {err && <p className="err">{err}</p>}
                  </div>
                )}
              </div>
            )
          })}
          {!list.length && <p className="muted">맞는 변경이 없습니다.</p>}
        </div>
      </div>
    </>
  )
}

/* ---------- 사용 현황 + 엑셀 내려받기 ---------- */
function StatTab({ users }) {
  const { db, toast } = useApp()
  const [size, setSize] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.rpc('admin_db_size').then(({ data }) => setSize(typeof data === 'number' ? data : Number(data) || null)) }, [])
  const act = (users || []).filter(u => !u.left_at)
  const now = Date.now()
  const days = u => (seenOf(u) ? Math.floor((now - new Date(seenOf(u))) / 86400000) : null)
  const recent = act.filter(u => days(u) !== null && days(u) < 7).length
  const idle = act.filter(u => days(u) === null || days(u) >= 7).sort((a, b) => (days(b) ?? 9999) - (days(a) ?? 9999))
  const live = db.changes.filter(c => c.status === '진행중').length
  const mb = size ? size / 1048576 : null
  const depts = [...db.depts].sort((a, b) => a.sort_order - b.sort_order)
  const byDept = depts.map(d => [d, act.filter(u => u.department === d.name).length])
  const max = Math.max(1, ...byDept.map(x => x[1]))

  async function download() {
    if (busy) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const P = id => (id && db.people[id] ? db.people[id].name + ' (' + db.people[id].email.split('@')[0] + ')' : '')
      const T = c => (db.changeMap[c] ? db.changeMap[c].title : '')
      const S = ts => (ts ? stampFull(ts) : '')
      const sheets = {
        가입자: (users || []).map(u => ({ 이름: u.name, 이메일: u.email, 부서: u.department, 상태: u.left_at ? '퇴사' : '재직', 관리자: u.is_admin ? 'O' : '', 가입일: S(u.created_at), 마지막접속: S(seenOf(u)), 퇴사일: S(u.left_at) })),
        부서: depts.map(d => ({ 순서: d.sort_order, 부서: d.name, 짧은이름: d.short, 종류: d.kind === '업무' ? '업무 부서' : '보기 전용' })),
        변경: db.changes.map(c => ({ 제목: c.title, 상태: c.status, 종결구분: c.close_type || '', 전환일: c.target_date, 처음전환일: c.first_target_date || '', 변경내용: c.description || '', 변경사유: c.reason || '', 대상품목: c.itemsText, 등록자: P(c.created_by), 등록부서: c.created_by_dept, 등록일: S(c.created_at), 종결일: S(c.closed_at), 중단사유: c.close_reason || '' })),
        할일: db.tasks.map(t => ({ 변경: T(t.change_id), 부서: t.department, 할일: t.title, 상태: t.status, 메모: t.memo || '', 처리자: P(t.done_by), 처리일시: S(t.done_at), 추가배정: t.is_extra ? 'O' : '', 배정사유: t.assign_reason || '' })),
        처리이력: [
          ...db.taskLogs.map(x => ({ 일시: S(x.created_at), 변경: T(x.change_id), 할일: (db.tasks.find(t => t.id === x.task_id) || {}).title || '', 내용: x.action, 메모: x.memo || '', 처리자: P(x.user_id) })),
          ...db.changeLogs.map(x => ({ 일시: S(x.created_at), 변경: T(x.change_id), 할일: '', 내용: x.action + (x.old_date ? ` ${x.old_date} → ${x.new_date}` : '') + (x.detail ? ' · ' + x.detail : ''), 메모: x.memo || '', 처리자: P(x.user_id) })),
        ].sort((a, b) => a.일시.localeCompare(b.일시)),
        대화: db.messages.map(m => ({ 일시: S(m.created_at), 변경: T(m.change_id), 작성자: P(m.user_id), 내용: m.deleted ? '(삭제된 메시지)' : m.body, 수정됨: m.edited ? 'O' : '' })),
      }
      const wb = XLSX.utils.book_new()
      Object.entries(sheets).forEach(([name, rows]) => {
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 내용: '자료 없음' }])
        XLSX.utils.book_append_sheet(wb, ws, name)
      })
      const d = new Date()
      const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
      XLSX.writeFile(wb, `푸르온_변경점_${ymd}.xlsx`)
      toast('엑셀 파일을 내려받았습니다')
    } catch (e) {
      toast('내려받기에 실패했습니다: ' + errText(e))
    }
    setBusy(false)
  }

  return (
    <>
      <Head title="사용 현황" sub={stampFull(new Date().toISOString()).slice(0, 10) + ' 기준'} />
      <div className="stats four">
        <div className="stat"><div className="k">가입자 (재직)</div><div className="v">{users ? act.length : '…'}</div><div className="s">퇴사 {users ? users.length - act.length : '…'}명</div></div>
        <div className="stat"><div className="k">최근 7일 접속</div><div className="v">{users ? recent : '…'}</div><div className="s">{users && act.length ? '재직자의 ' + Math.round((recent / act.length) * 100) + '%' : ''}</div></div>
        <div className="stat"><div className="k">진행 중 변경</div><div className="v">{live}</div><div className="s">종결 {db.changes.length - live}건</div></div>
        <div className="stat"><div className="k">저장 공간</div><div className="v">{mb ? mb.toFixed(1) : '…'}<small> MB</small></div>
          <div className="meter"><i style={{ width: (mb ? Math.max(1.5, (mb / 500) * 100) : 0) + '%' }} /></div>
          <div className="s">무료 한도 500MB{mb ? ' 중 ' + ((mb / 500) * 100).toFixed(1) + '%' : ''}</div></div>
      </div>
      <div className="adm-two">
        <div className="card adm-card">
          <h2>부서별 가입자</h2>
          <div className="bars2">
            {byDept.map(([d, n]) => (
              <div key={d.name} className={'bar3' + (d.kind === '보기' ? ' v' : '')}><span>{d.name}</span><span className="tr3"><i style={{ width: (n / max) * 100 + '%' }} /></span><span className="n">{n}</span></div>
            ))}
          </div>
          <p className="note">회색 막대는 보기 전용 부서입니다.</p>
        </div>
        <div className="card adm-card">
          <h2>7일 넘게 접속하지 않은 사람</h2>
          {!users ? <p className="muted">불러오는 중…</p> : !idle.length ? <p className="muted">없습니다.</p> : (
            <div className="idle2">{idle.map(u => <div key={u.id}><span>{u.name} <span className="pn-e">{u.email.split('@')[0]}</span> · {u.department}</span><em>{days(u) === null ? '접속 기록 없음' : days(u) + '일 전'}</em></div>)}</div>
          )}
          <p className="note">퇴사자 정리할 때 참고하세요.</p>
        </div>
      </div>
      <div className="card adm-card dl3">
        <div className="tx">
          <h2>전체 데이터 내려받기</h2>
          <p>엑셀 파일 1개로 받습니다. 한 달에 한 번, 또는 큰 변경이 종결될 때마다 받아 회사 공유 폴더에 날짜별로 보관하세요.</p>
          <div className="sheets">{['가입자', '부서', '변경', '할 일', '처리 이력', '대화'].map(x => <span key={x}>{x}</span>)}</div>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={download}>{busy ? '만드는 중…' : '엑셀로 받기'}</button>
      </div>
    </>
  )
}
