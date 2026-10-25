import { useCallback, useEffect, useState } from 'react'
import { supabase, ORDER, SIGNUP_DEPTS } from './supabase.js'
import { useApp, ICON, useWidth, WIDE } from './ctx.jsx'
import { errText, md, stampFull, iso, add, parse, todayMid } from './util.js'
import Report from './Report.jsx'

// 마지막 접속 = 앱을 쓴 시각 (없으면 마지막 로그인 시각)
const seenOf = u => u.last_seen_at || u.last_sign_in_at || null

// 관리자 모드: 관리 기능만 (업무 화면은 모두 꺼짐). 관리자 여부는 서버가 매번 다시 검사함
const TABS = [['users', '가입자', 'users'], ['dept', '부서', 'org'], ['tpl', '기본 할 일', 'list'], ['del', '변경 삭제', 'trash'], ['stat', '사용 현황', 'stat'], ['help', '도우미 설정', 'help']]

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
    help: <HelpTab />,
    stat: <StatTab users={users} onGoUsers={() => { setTab('users'); window.scrollTo(0, 0) }} />,
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
/* ---------- 사용 현황 (효과 보고용: 이름 없이 부서·전체 숫자 중심) ---------- */
const d2n = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000) }
const n2d = n => new Date(n * 86400000).toISOString().slice(0, 10)
const sday = ts => (ts ? stampFull(ts).slice(0, 10) : '')
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : null)

function buckets(from, to) {
  const a = d2n(from), b = d2n(to), len = b - a + 1
  const out = []
  if (len <= 14) {
    for (let n = a; n <= b; n++) out.push({ s: n, e: n, label: n2d(n).slice(5).replace('-', '/') })
  } else if (len <= 122) {
    // 월요일 시작 주 단위 (기간 밖은 잘라냄)
    let n = a
    while (n <= b) {
      const dow = (new Date(n * 86400000).getUTCDay() + 6) % 7          // 월=0
      const e = Math.min(b, n + (6 - dow))
      const days = e - n + 1
      out.push({ s: n, e, label: n2d(n).slice(5).replace('-', '/') + '~', part: days < 7 ? days : 0 })
      n = e + 1
    }
  } else {
    let n = a
    while (n <= b) {
      const d = new Date(n * 86400000)
      const last = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / 86400000)
      const e = Math.min(b, last)
      out.push({ s: n, e, label: (d.getUTCMonth() + 1) + '월', part: (n !== Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 86400000) || e !== last) ? e - n + 1 : 0 })
      n = e + 1
    }
  }
  return out
}

function StatTab({ users, onGoUsers }) {
  const { db, toast } = useApp()
  const [size, setSize] = useState(null)
  const [busy, setBusy] = useState(false)
  const today = sday(new Date().toISOString())
  const [preset, setPreset] = useState('4w')
  const [cf, setCf] = useState(n2d(d2n(today) - 27))
  const [ct, setCt] = useState(today)
  const range = preset === 'month' ? [today.slice(0, 8) + '01', today]
    : preset === '4w' ? [n2d(d2n(today) - 27), today]
    : preset === '3m' ? [n2d(d2n(today) - 89), today]
    : [cf <= ct ? cf : ct, cf <= ct ? ct : cf]
  const [from, to] = range
  const len = d2n(to) - d2n(from) + 1
  const pFrom = n2d(d2n(from) - len), pTo = n2d(d2n(from) - 1)
  const [acts, setActs] = useState(null)
  const [aErr, setAErr] = useState('')
  useEffect(() => { supabase.rpc('admin_db_size').then(({ data }) => setSize(typeof data === 'number' ? data : Number(data) || null)) }, [])
  useEffect(() => {
    let on = true
    setActs(null)
    supabase.rpc('admin_activity', { p_from: pFrom, p_to: to }).then(({ data, error }) => {
      if (!on) return
      if (error) { setAErr(errText(error)); setActs([]) } else { setAErr(''); setActs(data || []) }
    })
    return () => { on = false }
  }, [pFrom, to])

  const act = (users || []).filter(u => !u.left_at)
  const live = db.changes.filter(c => c.status === '진행중').length
  const mb = size ? size / 1048576 : null
  const depts = [...db.depts].sort((a, b) => a.sort_order - b.sort_order)
  const inR = (d, a, b) => d && d >= a && d <= b
  const deptOf = uid => (db.people[uid] ? db.people[uid].department : '')

  // 기간별 숫자 계산 (이번 기간 / 바로 앞 같은 길이 기간)
  const calc = (a, b) => {
    const reg = db.changes.filter(c => inR(sday(c.created_at), a, b)).length
    const closedC = db.changes.filter(c => c.status === '종결' && inR(sday(c.closed_at), a, b))
    const doneC = closedC.filter(c => c.close_type !== '중단')
    const onTimeC = doneC.filter(c => sday(c.closed_at) <= c.target_date).length
    const doneT = db.tasks.filter(t => t.status !== '대기' && inR(sday(t.done_at), a, b) && db.changeMap[t.change_id])
    const onTimeT = doneT.filter(t => sday(t.done_at) <= db.changeMap[t.change_id].target_date).length
    const usersSet = new Set((acts || []).filter(x => inR(x.d, a, b)).map(x => x.u))
    const msgs = db.messages.filter(m => !m.deleted && inR(sday(m.created_at), a, b))
    return { reg, closed: closedC.length, doneC: doneC.length, onTimeC, doneT: doneT.length, onTimeT, users: usersSet, msgs, doneTasks: doneT }
  }
  const cur = calc(from, to)
  const prev = calc(pFrom, pTo)
  const firstDay = acts && acts.length ? acts.reduce((m, x) => (x.d < m ? x.d : m), acts[0].d) : null

  // 막대그래프: 기간 길이에 따라 하루/주/달 단위
  const bks = buckets(from, to).map(k => {
    const a = n2d(k.s), b = n2d(k.e)
    return { ...k, v: new Set((acts || []).filter(x => inR(x.d, a, b)).map(x => x.u)).size }
  })
  const vmax = Math.max(1, ...bks.map(k => k.v))

  // 얼마나 자주 쓰나: 사람별 접속일 → 주당 평균 (이름은 보여주지 않음)
  const dayCnt = {}
  ;(acts || []).filter(x => inR(x.d, from, to)).forEach(x => { dayCnt[x.u] = (dayCnt[x.u] || 0) + 1 })
  const weeks = Math.max(1, len / 7)
  const freq = { hi: 0, mid: 0, none: 0 }
  act.forEach(u => { const w = (dayCnt[u.id] || 0) / weeks; if (w >= 3) freq.hi++; else if (w > 0) freq.mid++; else freq.none++ })
  const fTot = Math.max(1, act.length)

  // 부서별 (순서 고정)
  const rowsD = depts.map(d => {
    const people = act.filter(u => u.department === d.name)
    const used = people.filter(u => cur.users.has(u.id)).length
    const assigned = db.tasks.filter(t => t.department === d.name && inR(sday(t.created_at), from, to)).length
    const done = cur.doneTasks.filter(t => t.department === d.name)
    const onT = done.filter(t => sday(t.done_at) <= db.changeMap[t.change_id].target_date).length
    const chats = cur.msgs.filter(m => deptOf(m.user_id) === d.name).length
    return { d, n: people.length, used, assigned, done: done.length, onT: pctOf(onT, done.length), chats, view: d.kind === '보기' }
  })

  // 계정 점검: 4주 넘게 열지 않은 계정 수 (이름은 가입자 탭에서)
  const now = Date.now()
  const idleN = act.filter(u => { const s = seenOf(u); return !s || (now - new Date(s)) / 86400000 >= 28 }).length

  const cmp = (c, p, unit = '') => (p == null ? '' : c === p ? '지난 기간과 같음' : `지난 기간 ${p}${unit}`)
  const onC = pctOf(cur.onTimeC, cur.doneC), onCp = pctOf(prev.onTimeC, prev.doneC)
  const onT = pctOf(cur.onTimeT, cur.doneT), onTp = pctOf(prev.onTimeT, prev.doneT)
  const kpis = [
    { k: '변경 등록 / 종결', v: `${cur.reg} / ${cur.closed}`, u: '건', s: `지금 진행 중 ${live}건` },
    { k: '전환일 전에 끝난 변경', v: cur.doneC ? `${cur.onTimeC} / ${cur.doneC}` : '-', u: cur.doneC ? '건' : '', s: onC == null ? '이 기간 종결 없음' : [onC + '%', cmp(onC, onCp, '%')].filter(Boolean).join(' · ') },
    { k: '전환일 전 처리된 할 일', v: onT == null ? '-' : String(onT), u: onT == null ? '' : '%', s: cur.doneT ? [`${cur.doneT}건 중 ${cur.onTimeT}건`, cmp(onT, onTp, '%')].filter(Boolean).join(' · ') : '이 기간 처리 없음' },
    { k: '한 번 이상 쓴 사람', v: acts ? `${cur.users.size} / ${act.length}` : '…', u: acts ? '명' : '', s: acts ? [(pctOf(cur.users.size, act.length) ?? 0) + '%', cmp(cur.users.size, prev.users.size, '명')].filter(Boolean).join(' · ') : '' },
    { k: '앱에서 나눈 대화', v: String(cur.msgs.length), u: '개', s: cmp(cur.msgs.length, prev.msgs.length, '개') },
  ]

  async function downloadReport() {
    if (busy) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const sum = [
        { 항목: '기간', 이번기간: `${from} ~ ${to}`, 지난기간: `${pFrom} ~ ${pTo}` },
        { 항목: '변경 등록 (건)', 이번기간: cur.reg, 지난기간: prev.reg },
        { 항목: '변경 종결 (건)', 이번기간: cur.closed, 지난기간: prev.closed },
        { 항목: '전환일 전에 끝난 변경 (건)', 이번기간: `${cur.onTimeC} / ${cur.doneC}`, 지난기간: `${prev.onTimeC} / ${prev.doneC}` },
        { 항목: '전환일 전에 끝난 변경 (%)', 이번기간: onC ?? '-', 지난기간: onCp ?? '-' },
        { 항목: '처리된 할 일 (건)', 이번기간: cur.doneT, 지난기간: prev.doneT },
        { 항목: '전환일 전 처리 (%)', 이번기간: onT ?? '-', 지난기간: onTp ?? '-' },
        { 항목: '한 번 이상 쓴 사람 (명)', 이번기간: cur.users.size, 지난기간: prev.users.size },
        { 항목: '재직 가입자 (명)', 이번기간: act.length, 지난기간: '' },
        { 항목: '앱에서 나눈 대화 (개)', 이번기간: cur.msgs.length, 지난기간: prev.msgs.length },
        { 항목: '주 3일 이상 쓴 사람 (명)', 이번기간: freq.hi, 지난기간: '' },
        { 항목: '주 1~2일 쓴 사람 (명)', 이번기간: freq.mid, 지난기간: '' },
        { 항목: '이 기간 안 쓴 사람 (명)', 이번기간: freq.none, 지난기간: '' },
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sum), '요약')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bks.map(k => ({ 구간: k.label + (k.part ? ` (${k.part}일)` : ''), 시작: n2d(k.s), 끝: n2d(k.e), 쓴사람: k.v }))), '기간별 사용자')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsD.map(r => ({ 부서: r.d.name, 인원: r.n, 쓴사람: r.used, 배정된할일: r.view ? '' : r.assigned, 처리: r.view ? '' : r.done, 전환일전처리_퍼센트: r.view || r.onT == null ? '' : r.onT, 대화: r.chats }))), '부서별')
      XLSX.writeFile(wb, `푸르온_변경점_사용현황_${from}_${to}.xlsx`)
      toast('보고용 엑셀을 내려받았습니다')
    } catch (e) {
      toast('내려받기에 실패했습니다: ' + errText(e))
    }
    setBusy(false)
  }

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
      <Head title="사용 현황" sub="이름 없이 부서·전체 숫자로 봅니다 · 임원 보고용">
        <button type="button" className="btn" disabled={busy || !acts} onClick={downloadReport}>{busy ? '만드는 중…' : '보고용 엑셀 받기'}</button>
      </Head>
      <div className="us-period">
        <div className="seg" role="tablist" aria-label="기간">
          {[['month', '이번 달'], ['4w', '최근 4주'], ['3m', '최근 3개월'], ['custom', '직접 선택']].map(([k, l]) => (
            <button key={k} type="button" role="tab" className={preset === k ? 'on' : ''} onClick={() => setPreset(k)}>{l}</button>
          ))}
        </div>
        {preset === 'custom' ? (
          <span className="us-dates">
            <input type="date" aria-label="시작일" value={cf} max={today} onChange={e => e.target.value && setCf(e.target.value)} />
            <span>~</span>
            <input type="date" aria-label="종료일" value={ct} max={today} onChange={e => e.target.value && setCt(e.target.value)} />
          </span>
        ) : <span className="us-r mono">{from} ~ {to}</span>}
        <span className="us-cmp">비교: 바로 앞 {len}일 ({pFrom.slice(5)} ~ {pTo.slice(5)})</span>
      </div>
      {aErr && <p className="err">접속 기록을 불러오지 못했습니다: {aErr} (upgrade5.sql을 실행했는지 확인해주세요)</p>}
      {firstDay && firstDay > from && <p className="note us-note">접속 기록은 {firstDay}부터 쌓였습니다. 그 전 기간의 '쓴 사람' 숫자는 실제보다 적게 나옵니다. (처리·대화 숫자는 처음부터 정확합니다)</p>}

      <div className="us-kpis">
        {kpis.map(x => (
          <div key={x.k} className="stat us-k">
            <div className="k">{x.k}</div>
            <div className="v">{x.v}<small> {x.u}</small></div>
            <div className="s">{x.s}</div>
          </div>
        ))}
      </div>

      <div className="adm-two us-two">
        <div className="card adm-card">
          <h2>{bks.length && bks[0].s === bks[0].e ? '날마다' : len <= 122 ? '주마다' : '달마다'} 쓴 사람 수</h2>
          <div className="us-bars" role="img" aria-label={bks.map(k => k.label + ' ' + k.v + '명').join(', ')}>
            {bks.map((k, i) => (
              <div key={k.s} className={'us-b' + (i === bks.length - 1 ? ' last' : '')}>
                <span className="n">{acts ? k.v : ''}</span>
                <i style={{ height: (acts ? Math.max(2, (k.v / vmax) * 100) : 2) + '%' }} />
                <span className="l">{k.label}{k.part ? <small> ({k.part}일)</small> : null}</span>
              </div>
            ))}
          </div>
          <h3 className="us-h3">얼마나 자주 쓰나 <small>(이름 없이 인원만 · 재직 {act.length}명)</small></h3>
          <div className="us-freq" role="img" aria-label={`주 3일 이상 ${freq.hi}명, 주 1~2일 ${freq.mid}명, 안 씀 ${freq.none}명`}>
            <i className="hi" style={{ width: (freq.hi / fTot) * 100 + '%' }} /><i className="mid" style={{ width: (freq.mid / fTot) * 100 + '%' }} /><i className="no" style={{ width: (freq.none / fTot) * 100 + '%' }} />
          </div>
          <div className="us-lg"><span><i className="hi" />주 3일 이상 {freq.hi}명</span><span><i className="mid" />주 1~2일 {freq.mid}명</span><span><i className="no" />이 기간 안 씀 {freq.none}명</span></div>
        </div>
        <div className="card adm-card">
          <h2>부서별 <small className="us-sm">순서 고정 (순위 아님)</small></h2>
          <div className="us-tw">
            <table className="us-t">
              <thead><tr><th>부서</th><th>쓴 사람</th><th>배정된 할 일</th><th>처리</th><th>전환일 전 처리</th><th>대화</th></tr></thead>
              <tbody>
                {rowsD.map(r => (
                  <tr key={r.d.name}>
                    <td>{r.d.name}</td>
                    <td>{acts ? `${r.used} / ${r.n}` : '…'}</td>
                    <td>{r.view ? '–' : r.assigned}</td>
                    <td>{r.view ? '–' : r.done}</td>
                    <td>{r.view || r.onT == null ? '–' : r.onT + '%'}</td>
                    <td>{r.chats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">'쓴 사람'은 기간 중 한 번이라도 연 인원입니다. 접속 횟수·시간은 보여주지 않습니다. 배정·처리는 그 기간에 생기거나 처리된 할 일입니다.</p>
        </div>
      </div>

      <div className="card adm-card us-idle">
        <div><b>계정 점검</b> · 4주 넘게 열지 않은 계정 <b className="mono">{users ? idleN : '…'}</b>개 — 퇴사·부서 이동·로그인 문제일 수 있어요</div>
        <button type="button" className="btn sm ghost" onClick={onGoUsers}>가입자 탭에서 보기 ›</button>
      </div>

      <div className="adm-two">
        <div className="card adm-card">
          <h2>저장 공간</h2>
          <div className="v us-mb">{mb ? mb.toFixed(1) : '…'}<small> MB</small></div>
          <div className="meter"><i style={{ width: (mb ? Math.max(1.5, (mb / 500) * 100) : 0) + '%' }} /></div>
          <p className="note">무료 한도 500MB{mb ? ' 중 ' + ((mb / 500) * 100).toFixed(1) + '%' : ''} · 가입자 재직 {act.length}명 · 퇴사 {users ? users.length - act.length : '…'}명</p>
        </div>
        <div className="card adm-card dl3">
          <div className="tx">
            <h2>전체 데이터 내려받기</h2>
            <p>엑셀 파일 1개로 받습니다. 한 달에 한 번, 또는 큰 변경이 종결될 때마다 받아 회사 공유 폴더에 날짜별로 보관하세요.</p>
            <div className="sheets">{['가입자', '부서', '변경', '할 일', '처리 이력', '대화'].map(x => <span key={x}>{x}</span>)}</div>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={download}>{busy ? '만드는 중…' : '엑셀로 받기'}</button>
        </div>
      </div>
    </>
  )
}

/* ---------- 도우미 설정: 사용 설명서 · 하루 질문 한도 ---------- */
function HelpTab() {
  const { db, toast } = useApp()
  const [cfg, setCfg] = useState(null)
  const [manual, setManual] = useState('')
  const [total, setTotal] = useState('100')
  const [per, setPer] = useState('30')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_help_get')
    if (error) return setErr(errText(error) + ' (upgrade6.sql을 실행했는지 확인해주세요)')
    setErr(''); setCfg(data); setManual(data.manual || ''); setTotal(String(data.daily_total)); setPer(String(data.per_user))
  }, [])
  useEffect(() => { load() }, [load])
  const dirty = cfg && (manual !== cfg.manual || String(cfg.daily_total) !== total || String(cfg.per_user) !== per)
  async function save() {
    if (busy) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('admin_help_save', { p_manual: manual, p_total: parseInt(total, 10), p_per_user: parseInt(per, 10) })
    setBusy(false)
    if (error) return setErr(errText(error))
    toast('도우미 설정을 저장했습니다 · 바로 답변에 반영됩니다')
    load()
  }
  const who = cfg && cfg.updated_by && db.people[cfg.updated_by] ? db.people[cfg.updated_by].name : ''
  return (
    <>
      <Head title="도우미 설정" sub="사용법 도우미(AI)가 참고하는 설명서와 하루 질문 한도">
        <button type="button" className="btn" disabled={!dirty || busy} onClick={save}>{busy ? '저장 중…' : '저장'}</button>
      </Head>
      {err && <p className="err">{err}</p>}
      {!cfg ? (!err && <p className="muted">불러오는 중…</p>) : (
        <>
          <div className="stats four">
            <div className="stat"><div className="k">오늘 질문</div><div className="v">{cfg.today}<small> / {cfg.daily_total}</small></div><div className="s">물어본 사람 {cfg.today_people}명</div></div>
            <div className="stat"><div className="k">최근 30일 질문</div><div className="v">{cfg.last30}</div><div className="s">설명서에서 못 찾음 {cfg.miss30 ?? 0}건</div></div>
            <div className="stat"><div className="k">하루 회사 전체 한도</div><div className="v"><input className="hb-num" type="number" min="0" max="10000" value={total} onChange={e => setTotal(e.target.value)} aria-label="하루 회사 전체 질문 수" /></div><div className="s">0이면 도우미 끄기</div></div>
            <div className="stat"><div className="k">1인 하루 한도</div><div className="v"><input className="hb-num" type="number" min="0" max="1000" value={per} onChange={e => setPer(e.target.value)} aria-label="1인 하루 질문 수" /></div><div className="s">한 사람이 다 쓰지 않도록</div></div>
          </div>
          <HelpDigest cfg={cfg} />
          <HelpLog />
          <div className="card adm-card">
            <h2>사용 설명서 <small className="us-sm">{manual.length.toLocaleString()}자 · 마지막 수정 {cfg.updated_at ? stampFull(cfg.updated_at) : '-'}{who ? ' · ' + who : ''}</small></h2>
            <p className="note">도우미는 이 설명서에 있는 내용만 근거로 답하고, 없는 내용은 "캡처해서 관리자에게 문의"로 안내합니다. 앱 기능이 바뀌면 여기를 같이 고쳐주세요. ## 제목, - 목록, **굵게** 형식을 쓰면 도우미가 더 잘 이해합니다.</p>
            <textarea className="hb-manual" value={manual} onChange={e => setManual(e.target.value)} spellCheck={false} aria-label="사용 설명서" />
          </div>
        </>
      )}
    </>
  )
}

/* 질문 요약 (AI) — 관리자가 누를 때만 실행, 마지막 결과는 저장됨 */
function MiniMd({ text }) {
  const inline = (line, k) => line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
    p.startsWith('**') && p.endsWith('**') ? <b key={k + '-' + j}>{p.slice(2, -2)}</b> : p)
  return String(text).split('\n').map((line, i) => {
    const h2 = line.match(/^##\s+(.*)/), h3 = line.match(/^###\s+(.*)/)
    if (h3) return <h4 key={i} className="dg-h3">{inline(h3[1], i)}</h4>
    if (h2) return <h3 key={i} className="dg-h2">{inline(h2[1], i)}</h3>
    if (!line.trim()) return <div key={i} className="dg-gap" />
    const bul = line.match(/^(\s*)[-•·*]\s+(.*)/)
    if (bul) return <div key={i} className={'dg-li' + (bul[1].length >= 2 ? ' sub' : '')}><span className="dg-dot" aria-hidden="true">•</span>{inline(bul[2], i)}</div>
    const num = /^\s*\d+\.\s/.test(line)
    return <div key={i} className={num ? 'dg-li num' : ''}>{inline(line, i)}</div>
  })
}
const DG_PRE = [['7', '최근 7일'], ['30', '최근 30일'], ['90', '최근 90일'], ['custom', '직접 선택']]
function HelpDigest({ cfg }) {
  const { toast } = useApp()
  const today = iso(todayMid())
  const back = n => iso(add(todayMid(), -(n - 1)))
  const [pre, setPre] = useState('30')
  const [cf, setCf] = useState(cfg.digest_from || back(30))
  const [ct, setCt] = useState(cfg.digest_to || today)
  const from = pre === 'custom' ? cf : back(+pre)
  const to = pre === 'custom' ? ct : today
  const bad = !from || !to ? '기간을 선택해주세요' : from > to ? '시작일이 종료일보다 늦습니다' : (parse(to) - parse(from)) / 864e5 > 366 ? '기간은 1년 이내로 선택해주세요' : ''
  const [dg, setDg] = useState(cfg.digest ? { text: cfg.digest, at: cfg.digest_at, n: cfg.digest_n, from: cfg.digest_from, to: cfg.digest_to, days: cfg.digest_days } : null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function run() {
    if (busy || bad) return
    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase.functions.invoke('help-bot', { body: { mode: 'digest', from, to } })
      if (error) {
        let msg = ''
        try { msg = (await error.context.json()).error } catch (_) {}
        throw new Error(msg || '요약을 만들지 못했습니다. 잠시 후 다시 시도해주세요.')
      }
      setDg({ text: data.digest, at: new Date().toISOString(), n: data.n, from: data.from, to: data.to })
    } catch (e) { setErr(String((e && e.message) || e)) }
    setBusy(false)
  }
  async function copy() {
    try { await navigator.clipboard.writeText(dg.text); toast('요약을 복사했습니다') } catch (_) { toast('복사하지 못했습니다') }
  }
  return (
    <div className="card adm-card">
      <h2>질문 요약 <small className="us-sm">AI가 질문 기록을 주제별로 정리 · 누를 때만 실행 (약 1~3원)</small></h2>
      <div className="hl-f" role="group" aria-label="요약 기간">
        {DG_PRE.map(([k, t]) => <button key={k} type="button" className={'sum-chip' + (pre === k ? ' on' : '')} aria-pressed={pre === k} disabled={busy} onClick={() => { if (k === 'custom') { setCf(from); setCt(to) } setPre(k) }}>{t}</button>)}
        {pre === 'custom' ? (
          <span className="us-dates">
            <input type="date" aria-label="요약 시작일" value={cf} max={today} disabled={busy} onChange={e => e.target.value && setCf(e.target.value)} />
            <span>~</span>
            <input type="date" aria-label="요약 종료일" value={ct} max={today} disabled={busy} onChange={e => e.target.value && setCt(e.target.value)} />
          </span>
        ) : <span className="us-r mono">{from} ~ {to}</span>}
        <button type="button" className="btn sm dg-run" disabled={busy || !!bad} onClick={run}>{busy ? '요약하는 중… (10~30초)' : '요약하기'}</button>
      </div>
      {bad && <p className="err">{bad}</p>}
      {err && <p className="err">{err}</p>}
      {!dg ? <p className="muted">아직 요약한 적이 없습니다. 기간을 고르고 <b>요약하기</b>를 누르세요.</p> : (
        <div className={'dg-box' + (busy ? ' dim' : '')}>
          <div className="dg-meta">
            <span>{dg.at ? stampFull(dg.at) : ''}에 요약 · 기간 {dg.from && dg.to ? dg.from + ' ~ ' + dg.to : dg.days ? '최근 ' + dg.days + '일' : '-'} · 질문 {dg.n ?? '-'}개 기준</span>
            <button type="button" className="btn ghost sm" onClick={copy}>복사</button>
          </div>
          <div className="dg-body"><MiniMd text={dg.text} /></div>
          <p className="dg-note">AI 요약이라 건수나 묶음이 조금 다를 수 있습니다. '설명서에 추가할 문장 초안'은 내용이 맞는지 확인한 뒤 고쳐서 설명서에 넣어주세요. [확인 필요] 표시는 실제 앱에서 확인할 부분입니다.</p>
        </div>
      )}
    </div>
  )
}

/* 질문 기록 (이름 없이 저장됨) — 글자가 같은 질문은 한 줄로 묶음 */
const LOG_F = [['전체', '전체'], ['못찾음', '설명서에서 못 찾음'], ['관계없음', '앱과 관계없는 질문']]
const normQ = q => String(q).toLowerCase().replace(/[\s?？!.~]+/g, ' ').trim()
function HelpLog() {
  const { toast } = useApp()
  const [f, setF] = useState('전체')
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState({})
  const [group, setGroup] = useState(true)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_help_log', { p_filter: f, p_limit: 300 })
    if (error) { setErr(errText(error)); setRows([]); return }
    setErr(''); setRows(data || [])
  }, [f])
  useEffect(() => { setRows(null); load() }, [load])
  async function del(ids) {
    for (const id of ids) {
      const { error } = await supabase.rpc('admin_help_log_del', { p_id: id })
      if (error) return toast(errText(error))
    }
    setRows(r => r.filter(x => !ids.includes(x.id)))
  }
  // 묶기: 최신 질문이 대표, 개수·id 목록
  const items = !rows ? null : !group ? rows.map(r => ({ ...r, ids: [r.id], n: 1 })) : (() => {
    const m = new Map()
    for (const r of rows) {
      const k = normQ(r.q)
      const g = m.get(k)
      if (g) { g.n++; g.ids.push(r.id); if (r.r === '못찾음') g.r = '못찾음' } else m.set(k, { ...r, ids: [r.id], n: 1 })
    }
    return [...m.values()].sort((a, b) => b.n - a.n || (a.at < b.at ? 1 : -1))
  })()
  return (
    <div className="card adm-card">
      <h2>최근 질문 기록 <small className="us-sm">이름·부서 없이 저장 · 180일 지나면 자동 삭제</small></h2>
      <p className="note">사람들이 어디서 막히는지 보고 설명서나 화면을 고치는 데 쓰세요. <b>설명서에서 못 찾음</b>에 자주 나오는 질문은 위 설명서에 답을 추가하면 다음부터 도우미가 답합니다.</p>
      <div className="hl-f" role="group" aria-label="질문 기록 보기">
        {LOG_F.map(([k, t]) => <button key={k} type="button" className={'sum-chip' + (f === k ? ' on' : '')} aria-pressed={f === k} onClick={() => setF(k)}>{t}</button>)}
        <label className="hl-grp"><input type="checkbox" checked={group} onChange={e => setGroup(e.target.checked)} /> 같은 질문 묶기 (많은 순)</label>
        <button type="button" className="btn ghost sm" onClick={load}>새로고침</button>
      </div>
      {err && <p className="err">{err}</p>}
      {!items ? <p className="muted">불러오는 중…</p> : !items.length ? <p className="muted">기록이 없습니다.</p> : (
        <ul className="hl-list">
          {items.map(r => (
            <li key={r.id} className={'hl-row r-' + r.r}>
              <div className="hl-top">
                <span className="hl-at">{group && r.n > 1 ? '최근 ' : ''}{stampFull(r.at)}</span>
                {r.n > 1 && <span className="hl-n">×{r.n}</span>}
                {r.r !== '답변' && <span className="hl-tag">{r.r === '못찾음' ? '설명서에서 못 찾음' : '앱과 관계없음'}</span>}
                <button type="button" className="hl-x" onClick={() => del(r.ids)} aria-label={r.n > 1 ? `이 질문 기록 ${r.n}건 지우기` : '이 기록 지우기'} title={r.n > 1 ? `${r.n}건 모두 지우기` : '이 기록 지우기'}>✕</button>
              </div>
              <button type="button" className="hl-q" aria-expanded={!!open[r.id]} onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))}>
                <span>{r.q}</span><span className="hl-more">{open[r.id] ? '답변 접기' : r.n > 1 ? '최근 답변 보기' : '답변 보기'}</span>
              </button>
              {open[r.id] && <div className="hl-a"><MiniMd text={r.a || ''} /></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
