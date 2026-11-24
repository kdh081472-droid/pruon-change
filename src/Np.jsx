import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { Ctx, useApp, ICON, Person } from './ctx.jsx'
import { NP_DEPT } from './data.js'
import { md, dd, iso, parse, todayMid, add, stamp, norm, hasAll, errText, DAY } from './util.js'
import Chat from './Chat.jsx'

// =============================================================
// 신제품 모드: 샘플 스펙 확정 후 사후업무(순서대로, 마감일 없음) + 생산 점검 1~3차
//  - 등록·수정·처리: 개발팀만 (서버에서도 막음) · 다른 부서: 보기 + 대화 글쓰기
// =============================================================

const STAGES = ['진행 중', '생산 점검 중', '완료', '중단']
const STALE = 14   // 다음 할 일이 이 날짜 넘게 그대로면 표시
const TEAMS = ['1팀', '2팀', '파트장']
const teamCls = t => (t === '1팀' ? 'nt1' : t === '2팀' ? 'nt2' : t === '파트장' ? 'npl' : '')
const nameOf = (db, id) => (id && db.people[id] ? db.people[id].name : '-')
const staleDays = p => (p.stage === '진행 중' && p.lastAct ? Math.floor((Date.now() - new Date(p.lastAct)) / DAY) : 0)

// 신제품 탭 빨간 숫자: 오늘·지난 생산 점검(개발팀: 내 담당) + 안 읽은 신제품 대화
export function npBadge(db, uid, me) {
  if (!db || !db.np) return 0
  const editor = me && me.department === NP_DEPT && !me.left_at
  const due = editor ? db.np.filter(p => p.status === '진행중').reduce((n, p) => n + p.checks.filter(c => c.status === '대기' && c.prod_date && dd(c.prod_date) <= 0 && c.assignee === uid).length, 0) : 0
  const rd = room => db.reads[uid + '|' + room] || 0
  const unread = db.npMessages.filter(m => m.user_id !== uid && !m.deleted && m.id > rd(m.room)).length
  return due + unread
}

function TeamChip({ team }) {
  if (!team) return null
  return <span className={'np-team ' + teamCls(team)}>{team}</span>
}
function Prog({ p }) {
  const n = p.steps.length || 1
  return <span className="np-prog"><span className="np-bar"><i style={{ width: Math.round((p.stepsDone / n) * 100) + '%' }} /></span>{p.stepsDone}/{p.steps.length}</span>
}
function StageTag({ p }) {
  const c = { '진행 중': 'go', '생산 점검 중': 'pcs', 완료: 'dn', 중단: 'stp' }[p.stage]
  return <span className={'np-stt ' + c}>{p.stage}{p.stage === '완료' && p.closed_at ? ' ' + md(new Date(p.closed_at)) : ''}</span>
}
// 생산 점검 한 칸
function checkState(c) {
  if (c.status === '완료') return 'ok'
  if (c.status === '해당없음') return 'na'
  if (!c.prod_date) return 'tbd'
  const d = dd(c.prod_date)
  return d < 0 ? 'late' : d === 0 ? 'today' : 'sch'
}
function CheckPill({ c, short, onClick }) {
  const s = checkState(c)
  const txt = s === 'ok' ? `✓ ${c.round}차${!short && c.prod_date ? ' ' + md(c.prod_date) : ''}${!short && c.round === 1 && c.report_done ? ' · 초도생산 보고서 ✓' : ''}`
    : s === 'na' ? `${c.round}차 해당없음`
      : s === 'tbd' ? `${c.round}차 ${short ? '미정' : '날짜 미정'}${!short && c.round === 1 ? ' · 초도생산 보고서' : ''}`
        : s === 'today' ? `${c.round}차 ${md(c.prod_date)} 오늘`
          : s === 'late' ? `${c.round}차 ${md(c.prod_date)} 점검 지남`
            : `${c.round}차 ${md(c.prod_date)}`
  return onClick
    ? <button type="button" className={'np-pill ' + s} onClick={onClick}>{txt}</button>
    : <span className={'np-pill ' + s}>{txt}</span>
}

// =============================================================
export default function NpApp({ onExit, onOverlay, closeRef }) {
  const app = useApp()
  const { db, me, uid, wide, ui, setUi, toast, reload } = app
  const editor = me.department === NP_DEPT && !me.left_at
  const myTeam = db.npMembers[uid] || ''
  const tabKey = ui.npTab || (editor ? 'mine' : 'sum')
  const sel = ui.npSel || null
  const [sheet, setSheet] = useState(null)
  const [chatOpen, setChatOpen] = useState(null)     // 휴대폰: 열린 신제품 대화방
  const go = (t, s) => { setUi(u => ({ ...u, npTab: t, npSel: s === undefined ? u.npSel : s })); setSheet(null); setChatOpen(null); setTimeout(() => { const el = document.querySelector('.wide-main'); el ? el.scrollTo(0, 0) : window.scrollTo(0, 0) }, 0) }
  const open = id => go('detail', id)
  // 서버 함수 → 다시 불러오기 → 알림
  const run = async (fn, args, ok) => {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) return { error: errText(error) }
    await reload()
    if (ok) toast(typeof ok === 'function' ? ok(data) : ok)
    return { data }
  }
  const openNpTask = tid => {
    const p = db.np.find(x => x.steps.some(t => t.id === tid) || x.checks.some(t => t.id === tid))
    if (p) { go('detail', p.id); if (editor) setSheet({ kind: 'task', tid }) }
  }
  const npApp = { ...app, openNpTask, npRun: run, npOpen: open, npGo: go, npEditor: editor, setNpSheet: setSheet }
  const rd = room => db.reads[uid + '|' + room] || 0
  const unreadOf = id => db.npMessages.filter(m => m.np_id === id && m.user_id !== uid && !m.deleted && m.id > rd('n:' + id)).length
  const unreadAll = db.npMessages.filter(m => m.user_id !== uid && !m.deleted && m.id > rd(m.room)).length
  const myDue = db.np.filter(p => p.status === '진행중').reduce((n, p) => n + p.checks.filter(c => c.status === '대기' && c.prod_date && dd(c.prod_date) <= 0 && c.assignee === uid).length, 0)
  const detailP = tabKey === 'detail' && sel ? db.npMap[sel] : null
  // 처리 창·휴대폰 대화 창이 열려 있으면 뒤로 가기로 먼저 닫힘
  const ovOn = !!(sheet || (!wide && chatOpen))
  useEffect(() => { if (onOverlay) onOverlay(ovOn) }, [ovOn])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (onOverlay) onOverlay(false) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  if (closeRef) closeRef.current = () => { setSheet(null); setChatOpen(null) }

  // 보기 전용 계정이 등록 화면에 머물러 있으면 요약으로
  useEffect(() => { if (!editor && (tabKey === 'new' || tabKey === 'mine')) setUi(u => ({ ...u, npTab: 'sum' })) }, [editor, tabKey])

  if (!db.npReady) {
    return (
      <div className="auth"><div className="auth-card">
        <h2>신제품 모드 준비 중</h2>
        <p className="muted">서버 준비(upgrade22)가 아직 안 되어 있습니다. 관리자가 준비를 마치면 쓸 수 있습니다.</p>
        <button type="button" onClick={onExit}>변경점 관리로 돌아가기</button>
      </div></div>
    )
  }

  const nav = [
    ...(editor ? [['mine', '내 할 일', 'mine', myDue]] : []),
    ['cal', '달력', 'timeline'], ['sum', '요약', 'table'],
    ...(wide ? [] : [['rooms', '대화', 'chat', unreadAll]]),
    ...(editor ? [['new', wide ? '신제품 등록' : '등록', 'new']] : []),
  ]
  const isOn = k => tabKey === k || (tabKey === 'detail' && k === 'sum')
  const titles = { mine: '내 할 일', cal: '달력', sum: '요약', new: '신제품 등록', rooms: '신제품 대화', detail: '' }

  const content = (
    <>
      {tabKey === 'mine' && editor && <NpMine />}
      {tabKey === 'sum' && <NpSummary />}
      {tabKey === 'cal' && <NpCalendar />}
      {tabKey === 'new' && editor && <NpNew />}
      {tabKey === 'rooms' && !wide && <NpRooms onPick={id => setChatOpen(id)} unreadOf={unreadOf} />}
      {tabKey === 'detail' && (detailP ? <NpDetail p={detailP} onChat={() => setChatOpen(detailP.id)} unread={unreadOf(detailP.id)} /> : <div className="card empty">신제품을 찾을 수 없습니다. 지워졌을 수 있습니다.</div>)}
    </>
  )
  const overlays = (
    <>
      {sheet && <NpSheet key={JSON.stringify(sheet)} sheet={sheet} close={() => setSheet(null)} />}
      {!wide && chatOpen && db.npMap[chatOpen] && <Chat cid={'n:' + chatOpen} onClose={() => setChatOpen(null)} />}
    </>
  )

  if (wide) {
    const dock = tabKey === 'detail' && detailP
    return (
      <Ctx.Provider value={npApp}>
        <div className={'wide-wrap np-mode' + (dock || tabKey === 'mine' ? '' : ' no-dock')}>
          <aside className="sidebar np-side" aria-label="신제품 메뉴">
            <div className="sd-top">
              <div className="np-modebar">✦ 신제품 모드<small>{editor ? '개발팀' : '보기 전용'}</small></div>
              <div className="np-me"><Person id={uid} /><TeamChip team={myTeam} /></div>
            </div>
            <nav className="sd-nav">
              {nav.map(([k, label, ic, n], i) => (
                <div key={k}>
                  {((editor && i === 1) || (!editor && i === 0)) && <div className="sn-g">전체 일정</div>}
                  <button type="button" className={'sn' + (k === 'cal' || k === 'sum' ? ' sub' : '') + (isOn(k) ? ' on' : '')} onClick={() => go(k, k === 'detail' ? sel : null)}>
                    {ICON[ic]}<span>{label}</span>{n > 0 && <span className="n">{n}</span>}
                  </button>
                </div>
              ))}
            </nav>
            <div className="sd-fill" />
            <div className="np-back-w"><button type="button" className="np-back" onClick={onExit}>‹ 변경점 관리로 돌아가기</button></div>
          </aside>
          <div className="wide-main">
            <div className={'wide-in' + (tabKey === 'cal' || tabKey === 'sum' || tabKey === 'new' ? ' full' : '')}>
              {titles[tabKey] && <h1 className="page-t wide-t">{titles[tabKey]} <span className="np-h1tag">신제품</span></h1>}
              {content}
            </div>
          </div>
          {dock ? <Chat key={detailP.id} cid={'n:' + detailP.id} docked onClose={() => {}} /> : tabKey === 'mine' ? <NpDockEmpty unreadOf={unreadOf} /> : null}
        </div>
        {overlays}
      </Ctx.Provider>
    )
  }

  return (
    <Ctx.Provider value={npApp}>
      <div className="app np-mode">
        <div className="top">
          <div>
            <div className="brand"><span className="np-m">신제품</span>{editor ? '개발팀' : '보기 전용'}</div>
            <h1 className="page-t">{titles[tabKey] || (detailP ? '신제품' : '')}</h1>
          </div>
          <div className="top-r"><button type="button" className="np-back sm" onClick={onExit}>‹ 변경점</button></div>
        </div>
        {!editor && (tabKey === 'sum' || tabKey === 'cal') && <div className="np-ro">보기 전용 · 등록·처리는 개발팀만 · 대화방 글쓰기는 가능</div>}
        <main>{content}</main>
        <nav className="tabs np-tabs" aria-label="신제품 화면 전환">
          <div className="tabs-in">
            {nav.map(([k, label, ic, n]) => (
              <button key={k} type="button" className={'tab' + (isOn(k) ? ' on' : '')} onClick={() => go(k, null)}>
                {ICON[ic]}<span>{label}</span>{n > 0 && <span className="n">{n}</span>}
              </button>
            ))}
          </div>
        </nav>
      </div>
      {overlays}
    </Ctx.Provider>
  )
}

// PC 내 할 일 오른쪽: 안 읽은 신제품 대화
function NpDockEmpty({ unreadOf }) {
  const { db, npOpen } = useApp()
  const rows = db.np.map(p => ({ p, n: unreadOf(p.id) })).filter(x => x.n > 0)
  return (
    <div className="chat docked dock-empty">
      <div className="ch-h"><div><span className="s-tag">신제품 대화</span><b>신제품을 고르면<br />그 신제품의 대화가 여기에 뜹니다</b></div></div>
      <div className="ch-list">
        {rows.length ? rows.map(({ p, n }) => {
          const last = [...db.npMessages].reverse().find(m => m.np_id === p.id && !m.deleted)
          return (
            <button key={p.id} type="button" className="card np-room" onClick={() => npOpen(p.id)}>
              <span className="ub">{n}</span><b>{p.name}</b>
              {last && <small><Person id={last.user_id} /> {String(last.body).slice(0, 60)}</small>}
            </button>
          )
        }) : <div className="empty">안 읽은 신제품 대화가 없습니다.</div>}
      </div>
    </div>
  )
}

// =============================================================
// 내 할 일 (개발팀)
function NpMine() {
  const { db, uid, ui, setUi } = useApp()
  const myTeam = db.npMembers[uid] || ''
  const view = ui.npView || (myTeam === '파트장' ? 'all' : 'me')
  const live = db.np.filter(p => p.status === '진행중')
  const isMine = p => p.owner === uid || [...p.steps, ...p.checks].some(t => t.status === '대기' && t.assignee === uid)
  const inTeam = p => (myTeam === '1팀' || myTeam === '2팀' ? p.team === myTeam : true)
  const lists = { me: live.filter(isMine), team: live.filter(inTeam), all: live }
  const due = c => c.status === '대기' && c.prod_date && dd(c.prod_date) <= 0
  const list = [...lists[view]].sort((a, b) => (b.checks.some(due) - a.checks.some(due)) || (staleDays(b) >= STALE) - (staleDays(a) >= STALE) || String(b.sample_date).localeCompare(String(a.sample_date)))
  const alerts = list.flatMap(p => p.checks.filter(due).map(c => ({ p, c })))
  const today = alerts.filter(x => dd(x.c.prod_date) === 0), late = alerts.filter(x => dd(x.c.prod_date) < 0)
  const teamLbl = myTeam === '1팀' || myTeam === '2팀' ? `우리 팀(${myTeam})` : '우리 팀'
  return (
    <>
      <div className="np-viewbar">
        <div className="seg sm">
          {[['me', '내 담당'], ['team', teamLbl], ['all', '전체']].map(([k, l]) => <button key={k} type="button" className={view === k ? 'on' : ''} onClick={() => setUi(u => ({ ...u, npView: k }))}>{l} {lists[k].length}</button>)}
        </div>
        {!myTeam && <small className="muted">팀이 아직 지정되지 않았습니다 (관리자 모드 › 신제품 설정)</small>}
      </div>
      {late.length > 0 && <div className="np-alert">● 점검 지남 {late.length}건 · {late.map(x => `${x.p.name} ${x.c.round}차 (${md(x.c.prod_date)})`).join(', ')}</div>}
      {today.length > 0 && <div className="np-alert">● 오늘 생산 점검 {today.length}건 · {today.map(x => `${x.p.name} ${x.c.round}차`).join(', ')}</div>}
      {list.map(p => <NpCard key={p.id} p={p} />)}
      {!list.length && <div className="card empty">{view === 'me' ? '내가 담당하는 진행 중 신제품이 없습니다.' : '진행 중인 신제품이 없습니다.'}</div>}
      <p className="note">카드를 누르면 상세(사후업무 전체·생산 점검·대화) · 순서를 건너뛰어 처리해도 됩니다 · 다른 사람에게 넘긴 할 일은 이름이 붙습니다</p>
    </>
  )
}

function NpCard({ p }) {
  const { db, npOpen, setNpSheet, npEditor, wide } = useApp()
  const st = staleDays(p)
  const dueC = p.checks.find(c => c.status === '대기' && c.prod_date && dd(c.prod_date) <= 0)
  const nextC = p.stepsDone === p.steps.length ? p.checks.find(c => c.status === '대기') : null
  const stop = e => e.stopPropagation()
  return (
    <div className="card np-card" role="button" tabIndex={0} onClick={() => npOpen(p.id)} onKeyDown={e => { if (e.key === 'Enter') npOpen(p.id) }}>
      <div className="np-ch">
        <b className="t">{p.name}</b>{p.customer && <span className="np-who">{p.customer}</span>}
        <span className="np-meta">
          {p.owner && <span className="np-who">{nameOf(db, p.owner)} <TeamChip team={p.team} /></span>}
          <Prog p={p} />
          {p.stage !== '진행 중' && <StageTag p={p} />}
          {st >= STALE && <span className="np-stale">{st}일째 그대로</span>}
        </span>
      </div>
      {p.next && (
        <div className="np-next" onClick={stop}>
          <span className="k">다음 할 일</span><span className="np-no">{p.steps.indexOf(p.next) + 1}</span><span className="s">{p.next.title}</span>
          {p.next.assignee !== p.owner && <span className="np-who">· {nameOf(db, p.next.assignee)}</span>}
          {npEditor && <button type="button" className="btn sm np-btn" onClick={() => setNpSheet({ kind: 'task', tid: p.next.id })}>처리</button>}
        </div>
      )}
      {wide && p.next && (
        <div className="np-rest">
          {p.steps.map((t, i) => t === p.next ? null : <span key={t.id} className={t.status !== '대기' ? 'dn' : ''}>{i + 1} {t.title}{t.status === '대기' && t.assignee !== p.owner ? ' · ' + nameOf(db, t.assignee) : ''}</span>)}
        </div>
      )}
      <div className="np-pc" onClick={stop}>
        <span className="lb">생산 점검</span>
        {p.checks.map(c => <CheckPill key={c.id} c={c} short={!wide} />)}
        {npEditor && dueC && <button type="button" className="btn sm np-btn" onClick={() => setNpSheet({ kind: 'task', tid: dueC.id })}>{dueC.round}차 점검 처리</button>}
        {npEditor && !dueC && nextC && !nextC.prod_date && <button type="button" className="btn sm ghost np-btn" onClick={() => setNpSheet({ kind: 'date', tid: nextC.id })}>{nextC.round}차 생산일 넣기</button>}
      </div>
    </div>
  )
}

// =============================================================
// 요약
function NpSummary() {
  const { db, ui, setUi, npOpen, wide } = useApp()
  const st = ui.npSum || { chips: ['진행 중', '생산 점검 중'], team: '', q: '', sort: { k: 'sample', dir: 'desc' } }
  const set = o => setUi(u => ({ ...u, npSum: { ...st, ...o } }))
  const cnt = s => db.np.filter(p => p.stage === s).length
  const toggle = s => set({ chips: st.chips.includes(s) ? st.chips.filter(x => x !== s) : [...st.chips, s] })
  let list = db.np.filter(p => (!st.chips.length || st.chips.includes(p.stage)) && (!st.team || p.team === st.team))
  if (st.q.trim()) list = list.filter(p => hasAll([p.name, p.customer, p.spec, nameOf(db, p.owner), p.team, p.next && p.next.title].join(' '), st.q))
  const val = (p, k) => ({ name: p.name, customer: p.customer || '', owner: nameOf(db, p.owner), prog: p.stepsDone / (p.steps.length || 1), sample: p.sample_date, stage: STAGES.indexOf(p.stage) }[k])
  list = [...list].sort((a, b) => { const x = val(a, st.sort.k), y = val(b, st.sort.k); return (x > y ? 1 : x < y ? -1 : 0) * (st.sort.dir === 'asc' ? 1 : -1) })
  const H = ({ k, children }) => (
    <th><button type="button" className="np-th" onClick={() => set({ sort: { k, dir: st.sort.k === k && st.sort.dir === 'asc' ? 'desc' : 'asc' } })}>{children}{st.sort.k === k ? (st.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
  )
  return (
    <>
      <div className="np-chips">
        {STAGES.map(s => <button key={s} type="button" className={'np-chip' + (st.chips.includes(s) ? ' on' : '')} onClick={() => toggle(s)}>{s} {cnt(s)}</button>)}
        <span className="np-sp" />
        <div className="seg sm">{[['', '전체'], ['1팀', '1팀'], ['2팀', '2팀']].map(([k, l]) => <button key={l} type="button" className={st.team === k ? 'on' : ''} onClick={() => set({ team: k })}>{l}</button>)}</div>
        <input className="np-q" value={st.q} onChange={e => set({ q: e.target.value })} placeholder="검색 (제품·고객사·담당)" aria-label="신제품 검색" />
      </div>
      {wide ? (
        <table className="np-sum">
          <thead><tr><H k="name">제품</H><H k="customer">고객사</H><H k="owner">담당</H><H k="prog">사후업무</H><th>다음 할 일</th><th>생산 점검</th><H k="sample">샘플 확정</H><H k="stage">상태</H></tr></thead>
          <tbody>
            {list.map(p => {
              const s = staleDays(p)
              return (
                <tr key={p.id} className={p.stage === '완료' || p.stage === '중단' ? 'fin' : ''} onClick={() => npOpen(p.id)}>
                  <td className="t">{p.name}</td><td>{p.customer || '-'}</td>
                  <td className="nw">{nameOf(db, p.owner)} <TeamChip team={p.team} /></td>
                  <td><Prog p={p} /></td>
                  <td>{p.next ? <><b>{p.steps.indexOf(p.next) + 1} {p.next.title}</b>{s >= STALE && <span className="np-stale">{s}일째</span>}</> : <span className="muted">—</span>}</td>
                  <td className="np-pcs">{p.checks.map(c => <CheckPill key={c.id} c={c} short />)}</td>
                  <td className="nw">{md(p.sample_date)}</td>
                  <td><StageTag p={p} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : list.map(p => (
        <div key={p.id} className="card np-card" role="button" tabIndex={0} onClick={() => npOpen(p.id)}>
          <div className="np-ch"><b className="t">{p.name}</b><span className="np-meta"><span className="np-who">{nameOf(db, p.owner)} <TeamChip team={p.team} /></span><StageTag p={p} /></span></div>
          <div className="np-line">사후업무 {p.stepsDone}/{p.steps.length}{p.next ? ' · 다음: ' + p.next.title : ''}{p.customer ? ' · ' + p.customer : ''}</div>
          <div className="np-pc">{p.checks.map(c => <CheckPill key={c.id} c={c} short />)}</div>
        </div>
      ))}
      {!list.length && <div className="card empty">{db.np.length ? '조건에 맞는 신제품이 없습니다.' : '아직 등록된 신제품이 없습니다.'}</div>}
      {wide && <p className="note">머리글을 누르면 정렬 · 줄을 누르면 상세 · '{STALE}일째' = 다음 할 일이 {STALE}일 넘게 그대로</p>}
    </>
  )
}

// =============================================================
// 달력: 샘플 확정일 · 생산 점검 생산일(1~3차) · 완료일
function NpCalendar() {
  const { db, ui, setUi, npOpen, wide } = useApp()
  const t0 = todayMid()
  const month = ui.npMonth || iso(new Date(t0.getFullYear(), t0.getMonth(), 1))
  const team = ui.npCalTeam || ''
  const m0 = parse(month)
  const setM = n => setUi(u => ({ ...u, npMonth: iso(new Date(m0.getFullYear(), m0.getMonth() + n, 1)) }))
  const evs = {}
  const push = (d, e) => { (evs[d] = evs[d] || []).push(e) }
  db.np.filter(p => !team || p.team === team).forEach(p => {
    push(String(p.sample_date).slice(0, 10), { p, cls: 'sm', t: `${p.name} 샘플 확정` })
    p.checks.forEach(c => { if (c.prod_date) { const s = checkState(c); push(String(c.prod_date).slice(0, 10), { p, cls: 'chk ' + s, t: `${p.name} ${c.round}차 점검${s === 'today' ? ' · 오늘' : s === 'late' ? ' · 지남' : s === 'na' ? ' · 해당없음' : ''}` }) } })
    if (p.status === '완료' && p.closed_at) push(iso(new Date(p.closed_at)), { p, cls: 'dn', t: `${p.name} 완료` })
  })
  const start = add(m0, -m0.getDay())
  const days = Array.from({ length: 42 }, (_, i) => add(start, i))
  const rows = days[35].getMonth() !== m0.getMonth() ? days.slice(0, 35) : days
  const head = (
    <div className="np-calh">
      <b>{m0.getFullYear()}년 {m0.getMonth() + 1}월</b>
      <div className="seg sm"><button type="button" onClick={() => setM(-1)} aria-label="이전 달">‹</button><button type="button" className="on" onClick={() => setUi(u => ({ ...u, npMonth: null }))}>오늘</button><button type="button" onClick={() => setM(1)} aria-label="다음 달">›</button></div>
      <span className="np-sp" />
      <div className="seg sm">{[['', '전체'], ['1팀', '1팀'], ['2팀', '2팀']].map(([k, l]) => <button key={l} type="button" className={team === k ? 'on' : ''} onClick={() => setUi(u => ({ ...u, npCalTeam: k }))}>{l}</button>)}</div>
    </div>
  )
  const legend = <div className="np-legend"><span><i className="chk" />생산 점검</span><span><i className="late" />점검 지남</span><span><i className="sm" />샘플 확정</span><span><i className="dn" />완료</span></div>
  if (!wide) {
    const inM = Object.keys(evs).filter(d => parse(d).getMonth() === m0.getMonth() && parse(d).getFullYear() === m0.getFullYear()).sort()
    return (
      <>
        {head}{legend}
        {inM.map(d => (
          <div key={d} className={'card np-agenda' + (d === iso(t0) ? ' td' : '')}>
            <div className="np-ad">{md(d)} ({'일월화수목금토'[parse(d).getDay()]}){d === iso(t0) && <b> 오늘</b>}</div>
            {evs[d].map((e, i) => <button key={i} type="button" className={'np-ev ' + e.cls} onClick={() => npOpen(e.p.id)}>{e.t}</button>)}
          </div>
        ))}
        {!inM.length && <div className="card empty">이 달에는 일정이 없습니다.</div>}
      </>
    )
  }
  return (
    <>
      {head}{legend}
      <div className="np-cal">
        {'일월화수목금토'.split('').map(w => <div key={w} className="dw">{w}</div>)}
        {rows.map(d => {
          const k = iso(d)
          return (
            <div key={k} className={'c' + (d.getMonth() !== m0.getMonth() ? ' o' : '') + (k === iso(t0) ? ' td' : '')}>
              <span className="d">{d.getDate()}</span>
              {(evs[k] || []).map((e, i) => <button key={i} type="button" className={'np-ev ' + e.cls} title={e.t} onClick={() => npOpen(e.p.id)}>{e.t}</button>)}
            </div>
          )
        })}
      </div>
    </>
  )
}

// =============================================================
// 신제품 등록 (개발팀)
function devPeople(db) {
  return db.profiles.filter(p => p.department === NP_DEPT && !p.left_at)
    .sort((a, b) => TEAMS.indexOf(db.npMembers[a.id] || 'z') - TEAMS.indexOf(db.npMembers[b.id] || 'z') || a.name.localeCompare(b.name))
}
function OwnerSelect({ value, onChange, id }) {
  const { db } = useApp()
  return (
    <select id={id} value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="" disabled>담당자 고르기</option>
      {devPeople(db).map(p => <option key={p.id} value={p.id}>{p.name}{db.npMembers[p.id] ? ' · ' + db.npMembers[p.id] : ''}</option>)}
    </select>
  )
}

function NpNew() {
  const { db, uid, npRun, npOpen } = useApp()
  const mkSteps = () => db.npTemplates.map((t, i) => ({ k: 't' + i, t: t.title, on: true }))
  const [f, setF] = useState(() => ({ name: '', customer: '', sample: '', owner: devPeople(db).some(p => p.id === uid) ? uid : '', spec: '', memo: '' }))
  const [steps, setSteps] = useState(mkSteps)
  const [nt, setNt] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const drag = useRef(null)
  const set = o => { setF({ ...f, ...o }); setErr('') }
  const onN = steps.filter(s => s.on && s.t.trim()).length
  const move = (from, to) => { if (from === to || from == null) return; const a = [...steps]; const [x] = a.splice(from, 1); a.splice(to, 0, x); setSteps(a) }
  async function submit() {
    if (!f.name.trim()) return setErr('제품명을 입력해주세요.')
    if (!f.sample) return setErr('샘플 확정일을 골라주세요.')
    if (!f.owner) return setErr('담당자를 골라주세요.')
    setBusy(true)
    const r = await npRun('np_create', { p_name: f.name, p_customer: f.customer, p_spec: f.spec, p_memo: f.memo, p_sample: f.sample, p_owner: f.owner, p_steps: steps.filter(s => s.on && s.t.trim()).map(s => s.t.trim()) }, '신제품을 등록했습니다')
    setBusy(false)
    if (r.error) return setErr(r.error)
    npOpen(r.data)
  }
  return (
    <div className="np-new">
      <div className="nf np-form">
        <label htmlFor="np-name">제품명 <span className="req">*필수</span></label>
        <input id="np-name" value={f.name} onChange={e => set({ name: e.target.value })} maxLength={100} placeholder="예: 새우 딤섬 500g" />
        <div className="np-g2">
          <div><label htmlFor="np-cus">고객사</label><input id="np-cus" value={f.customer} onChange={e => set({ customer: e.target.value })} maxLength={60} placeholder="예: 가나식품 / 자체 개발" /></div>
          <div><label htmlFor="np-sample">샘플 확정일 <span className="req">*필수</span></label><input id="np-sample" type="date" value={f.sample} onChange={e => set({ sample: e.target.value })} /></div>
        </div>
        <div className="np-g2">
          <div><label htmlFor="np-owner">담당자 <span className="req">*필수</span></label><OwnerSelect id="np-owner" value={f.owner} onChange={v => set({ owner: v })} /></div>
          <div><label htmlFor="np-spec">품목·규격</label><input id="np-spec" value={f.spec} onChange={e => set({ spec: e.target.value })} maxLength={100} placeholder="예: 1kg × 10입 / 박스" /></div>
        </div>
        <label htmlFor="np-memo">메모</label>
        <textarea id="np-memo" rows={3} value={f.memo} onChange={e => set({ memo: e.target.value })} placeholder="스펙 요약, 참고 사항 등" />
        <p className="note">팀은 담당자를 따라 자동으로 붙습니다 (관리자 모드 › 신제품 설정) · 등록하면 신제품 대화방이 함께 만들어집니다</p>
      </div>
      <div className="np-steps-w">
        <div className="np-fl">사후업무 <span>· 담당자에게 모두 배정 · ⋮⋮ 끌어서 순서 · 체크를 끄면 빠짐</span></div>
        <div className="np-tl">
          {steps.map((s, i) => (
            <div key={s.k} className={'np-tr' + (s.on ? '' : ' off')} draggable onDragStart={() => { drag.current = i }} onDragOver={e => e.preventDefault()} onDrop={() => { move(drag.current, i); drag.current = null }}>
              <span className="h" title="끌어서 순서 바꾸기">⋮⋮</span>
              <input type="checkbox" checked={s.on} aria-label={s.t + ' 넣기'} onChange={() => setSteps(steps.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} />
              <span className="np-no">{steps.slice(0, i + 1).filter(x => x.on).length && s.on ? steps.slice(0, i + 1).filter(x => x.on).length : ''}</span>
              <span className="tt">{s.t}</span>
              <span className="mv">
                <button type="button" aria-label="위로" disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                <button type="button" aria-label="아래로" disabled={i === steps.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                <button type="button" aria-label="빼기" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>✕</button>
              </span>
            </div>
          ))}
          <form className="np-add" onSubmit={e => { e.preventDefault(); if (nt.trim()) { setSteps([...steps, { k: 'n' + Date.now(), t: nt.trim(), on: true }]); setNt('') } }}>
            <input value={nt} onChange={e => setNt(e.target.value)} placeholder="+ 할 일 직접 추가 (Enter)" maxLength={100} aria-label="할 일 직접 추가" />
          </form>
        </div>
        <div className="np-fl">생산 점검 <span>· 자동으로 붙음 · 생산일은 나중에</span></div>
        <div className="np-pc np-pc-new"><span className="np-pill tbd">1차 · 초도생산 보고서</span><span className="np-pill tbd">2차</span><span className="np-pill tbd">3차</span></div>
        {err && <p className="nf-err">{err}</p>}
        <button type="button" className="btn np-go" disabled={busy} onClick={submit}>{busy ? '등록 중…' : `신제품 등록 · 사후업무 ${onN}건`}</button>
      </div>
    </div>
  )
}

// =============================================================
// 상세
function NpDetail({ p, onChat, unread }) {
  const { db, wide, npEditor, setNpSheet } = useApp()
  const [more, setMore] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const live = p.status === '진행중'
  const S = (kind, extra) => setNpSheet({ kind, id: p.id, ...extra })
  return (
    <div className="np-detail">
      <div className="np-dh">
        <div className="np-dht">
          <h1 className="np-dt">{p.name}</h1>
          <div className="np-kv">
            {p.customer && <span>고객사<b>{p.customer}</b></span>}
            <span>샘플 확정<b>{md(p.sample_date)}</b></span>
            <span>담당<b>{nameOf(db, p.owner)}</b> <TeamChip team={p.team} /></span>
            <span>등록<b>{md(new Date(p.created_at))} · {nameOf(db, p.created_by)}</b></span>
            {p.spec && <span>품목·규격<b>{p.spec}</b></span>}
          </div>
          {p.memo && <p className="np-memo">{p.memo}</p>}
          {p.status === '중단' && <p className="np-stopped">중단 · {p.close_reason}</p>}
        </div>
        <div className="np-dha">
          <StageTag p={p} /><Prog p={p} />
          {!wide && <button type="button" className="pill" onClick={onChat}>대화{unread > 0 ? ` ${unread}` : ''}</button>}
          {npEditor && (
            <>
              <button type="button" className="pill" onClick={() => S('edit')}>내용 수정</button>
              <button type="button" className="pill" onClick={() => S('owner')}>담당 바꾸기</button>
              <span className="np-more-w">
                <button type="button" className="pill" aria-expanded={more} onClick={() => setMore(v => !v)}>⋯</button>
                {more && (
                  <span className="np-more" onMouseLeave={() => setMore(false)}>
                    {live && <button type="button" onClick={() => { setMore(false); S('stop') }}>중단</button>}
                    {p.status === '중단' && <button type="button" onClick={() => { setMore(false); S('resume') }}>다시 진행</button>}
                    <button type="button" className="warn" onClick={() => { setMore(false); S('delete') }}>삭제</button>
                  </span>
                )}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="np-sec">사후업무 <span>· 순서대로 · 마감일 없음</span>{npEditor && live && <button type="button" className="pill np-sec-r" onClick={() => S('add')}>+ 할 일 추가</button>}</div>
      <div className="np-steps">
        {p.steps.map((t, i) => {
          const cur = p.next && p.next.id === t.id
          return (
            <div key={t.id} className={'np-st' + (t.status !== '대기' ? ' dn' : '') + (cur ? ' cur' : '')}>
              <span className="np-no">{i + 1}</span>
              <span className="nm">{t.title}{cur && <span className="np-nexttag">다음</span>}{t.status === '해당없음' && <span className="np-na">해당없음</span>}</span>
              <span className="by">{t.status === '대기' ? '대기' : <>{t.status === '완료' ? '✓' : '–'} {nameOf(db, t.done_by)} · {md(new Date(t.done_at))}</>}</span>
              <span className="as">
                {npEditor && live && t.status === '대기'
                  ? <button type="button" className="link" onClick={() => setNpSheet({ kind: 'assign', tid: t.id })}>{nameOf(db, t.assignee)} ▾</button>
                  : nameOf(db, t.assignee)}
              </span>
              <span className="ac">
                {npEditor && live && t.status === '대기' && <button type="button" className={'btn sm' + (cur ? ' np-btn' : ' ghost')} onClick={() => setNpSheet({ kind: 'task', tid: t.id })}>처리</button>}
                {npEditor && live && t.status !== '대기' && <button type="button" className="np-undo" onClick={() => setNpSheet({ kind: 'cancel', tid: t.id })}>확인 취소</button>}
              </span>
              {t.memo && t.status !== '대기' && <span className="np-mm">“{t.memo}”</span>}
            </div>
          )
        })}
        {!p.steps.length && <div className="empty">사후업무가 없습니다.</div>}
      </div>

      <div className="np-sec">생산 점검 <span>· 생산계획이 나오면 날짜를 넣음 · 3차까지 끝나면 완료</span></div>
      <div className="np-chk">
        {p.checks.map(c => {
          const s = checkState(c)
          return (
            <div key={c.id} className={'np-cb ' + s}>
              <div className="h">{c.round}차 <span className={'np-tag ' + s}>{{ ok: '완료', na: '해당없음', tbd: '날짜 미정', today: '오늘', late: '점검 지남', sch: '예정' }[s]}</span></div>
              <div className="d">생산일 {c.prod_date ? md(c.prod_date) + ' (' + '일월화수목금토'[parse(c.prod_date).getDay()] + ')' : '—'}</div>
              {c.round === 1 && <div className="sub">{c.report_done ? '☑' : '☐'} 초도생산 보고서 (1차 점검과 함께)</div>}
              {c.status !== '대기' && <div className="sub">{c.status === '완료' ? '✓' : '–'} {nameOf(db, c.done_by)} · {md(new Date(c.done_at))}{c.memo ? ' · “' + c.memo + '”' : ''}</div>}
              {npEditor && live && (
                <div className="acts">
                  {c.status === '대기' && <button type="button" className="btn sm ghost" onClick={() => setNpSheet({ kind: 'date', tid: c.id })}>{c.prod_date ? '생산일 바꾸기' : '생산일 넣기'}</button>}
                  {c.status === '대기' && c.prod_date && <button type="button" className={'btn sm' + (s === 'today' || s === 'late' ? ' np-btn' : ' ghost')} onClick={() => setNpSheet({ kind: 'task', tid: c.id })}>점검 처리</button>}
                  {c.status !== '대기' && <button type="button" className="np-undo" onClick={() => setNpSheet({ kind: 'cancel', tid: c.id })}>확인 취소</button>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button type="button" className="np-sec np-logt" aria-expanded={logOpen} onClick={() => setLogOpen(v => !v)}>{logOpen ? '▾' : '▸'} 기록 <span>· {p.logs.length}건</span></button>
      {logOpen && (
        <div className="np-logs">
          {[...p.logs].reverse().map(l => {
            const t = l.task_id && [...p.steps, ...p.checks].find(x => x.id === l.task_id)
            return <div key={l.id} className="np-log"><span>{stamp(l.created_at)}</span><span>{nameOf(db, l.user_id)}</span><span><b>{l.action}</b>{t ? ' · ' + t.title : ''}{l.memo ? ' · ' + l.memo : ''}</span></div>
          })}
        </div>
      )}
    </div>
  )
}

// 휴대폰: 신제품 대화 목록
function NpRooms({ onPick, unreadOf }) {
  const { db } = useApp()
  const last = {}
  db.npMessages.forEach(m => { if (!m.deleted && (!last[m.np_id] || last[m.np_id].id < m.id)) last[m.np_id] = m })
  const rows = [...db.np].sort((a, b) => ((last[b.id] && last[b.id].id) || 0) - ((last[a.id] && last[a.id].id) || 0))
  return (
    <>
      {rows.map(p => {
        const l = last[p.id], n = unreadOf(p.id)
        return (
          <button key={p.id} type="button" className="card np-room" onClick={() => onPick(p.id)}>
            {n > 0 && <span className="ub">{n}</span>}<b>{p.name}</b><StageTag p={p} />
            <small>{l ? <><Person id={l.user_id} /> {String(l.body).slice(0, 50)}</> : '아직 대화가 없습니다'}</small>
          </button>
        )
      })}
      {!rows.length && <div className="card empty">아직 등록된 신제품이 없습니다.</div>}
    </>
  )
}

// =============================================================
// 처리 창들
function NpSheet({ sheet, close }) {
  const { db, npRun, npGo, toast } = useApp()
  const tk = sheet.tid ? db.np.flatMap(p => [...p.steps, ...p.checks].map(t => ({ t, p }))).find(x => x.t.id === sheet.tid) : null
  const p = tk ? tk.p : db.npMap[sheet.id]
  const t = tk ? tk.t : null
  const [memo, setMemo] = useState('')
  const [report, setReport] = useState(false)
  const [date, setDate] = useState(t && t.prod_date ? String(t.prod_date).slice(0, 10) : '')
  const [f, setF] = useState(() => (p ? { name: p.name, customer: p.customer || '', spec: p.spec || '', memo: p.memo || '', sample: String(p.sample_date).slice(0, 10) } : {}))
  const [owner, setOwner] = useState(p ? p.owner : '')
  const [moveT, setMoveT] = useState(true)
  const [who, setWho] = useState(t ? t.assignee : (p ? p.owner : ''))
  const [title, setTitle] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const on = e => { if (e.key === 'Escape' && !memo.trim()) close() }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  })
  if (!p || (sheet.tid && !t)) return null
  const go = async (fn, args, ok, after) => {
    if (busy) return
    setBusy(true); setErr('')
    const r = await npRun(fn, args, ok)
    setBusy(false)
    if (r.error) return setErr(r.error)
    if (after) after(r.data); else close()
  }
  const isC = t && t.kind === 'check'
  let body = null, head = ''
  if (sheet.kind === 'task') {
    head = isC ? `${t.round}차 생산 점검${t.prod_date ? ' · ' + md(t.prod_date) : ''}` : t.title
    body = (
      <>
        {isC && t.round === 1 && <label className="np-ck"><input type="checkbox" checked={report} onChange={e => setReport(e.target.checked)} /> <b>초도생산 보고서 작성</b> <small>1차 점검과 함께 챙김</small></label>}
        <label htmlFor="np-memo-in">{isC ? '점검 메모' : '처리 메모'} <span className="req">*필수</span></label>
        <textarea id="np-memo-in" rows={3} autoFocus value={memo} onChange={e => { setMemo(e.target.value); setErr('') }} placeholder={isC ? '예: 중량·외관 이상 없음' : '예: 품질팀에 검토 요청함'} />
        {isC && t.round === 1 && <p className="note">초도생산 보고서를 체크하지 않으면 1차 점검을 완료할 수 없습니다 (해당없음은 가능)</p>}
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts">
          <button type="button" className="btn np-btn" disabled={busy} onClick={() => { if (!memo.trim()) return setErr('메모를 입력해주세요.'); if (isC && t.round === 1 && !report) return setErr('초도생산 보고서를 체크해야 1차 점검을 완료할 수 있습니다.'); go('np_task_done', { p_task: t.id, p_status: '완료', p_memo: memo, p_report: report }, isC ? `${t.round}차 점검을 완료했습니다` : '확인완료로 저장했습니다') }}>{isC ? `${t.round}차 점검 완료` : '확인완료로 저장'}</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => { if (!memo.trim()) return setErr('메모를 입력해주세요.'); go('np_task_done', { p_task: t.id, p_status: '해당없음', p_memo: memo, p_report: false }, '해당없음으로 저장했습니다') }}>해당없음</button>
        </div>
      </>
    )
  } else if (sheet.kind === 'date') {
    head = `${t.round}차 생산일`
    body = (
      <>
        <label htmlFor="np-d">생산일 (생산계획에 나온 날짜)</label>
        <input id="np-d" type="date" value={date} onChange={e => setDate(e.target.value)} autoFocus />
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts">
          <button type="button" className="btn np-btn" disabled={busy || !date} onClick={() => go('np_set_date', { p_task: t.id, p_date: date }, `${t.round}차 생산일을 ${md(date)}로 정했습니다`)}>저장</button>
          {t.prod_date ? <button type="button" className="btn ghost" disabled={busy} onClick={() => go('np_set_date', { p_task: t.id, p_date: null }, '생산일을 미정으로 바꿨습니다')}>미정으로 되돌리기</button> : <button type="button" className="btn ghost" onClick={close}>취소</button>}
        </div>
      </>
    )
  } else if (sheet.kind === 'cancel') {
    head = `확인 취소 · ${isC ? t.round + '차 생산 점검' : t.title}`
    body = (
      <>
        <label htmlFor="np-r">취소 사유 <span className="req">*필수</span></label>
        <textarea id="np-r" rows={2} autoFocus value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 잘못 눌러서" />
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className="btn warn" disabled={busy || !memo.trim()} onClick={() => go('np_task_cancel', { p_task: t.id, p_reason: memo }, '확인을 취소했습니다 · 다시 대기로 돌아갔습니다')}>확인 취소</button><button type="button" className="btn ghost" onClick={close}>닫기</button></div>
      </>
    )
  } else if (sheet.kind === 'assign') {
    head = `할 일 담당 · ${t.title}`
    body = (
      <>
        <label htmlFor="np-who">이 할 일을 맡을 사람</label>
        <OwnerSelect id="np-who" value={who} onChange={setWho} />
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className="btn np-btn" disabled={busy || !who || who === t.assignee} onClick={() => go('np_task_assign', { p_task: t.id, p_user: who }, '할 일 담당을 바꿨습니다')}>바꾸기</button><button type="button" className="btn ghost" onClick={close}>취소</button></div>
      </>
    )
  } else if (sheet.kind === 'edit') {
    head = '내용 수정'
    const s = o => setF({ ...f, ...o })
    body = (
      <>
        <label htmlFor="ne-n">제품명 <span className="req">*필수</span></label><input id="ne-n" value={f.name} onChange={e => s({ name: e.target.value })} maxLength={100} />
        <label htmlFor="ne-c">고객사</label><input id="ne-c" value={f.customer} onChange={e => s({ customer: e.target.value })} maxLength={60} />
        <label htmlFor="ne-s">샘플 확정일 <span className="req">*필수</span></label><input id="ne-s" type="date" value={f.sample} onChange={e => s({ sample: e.target.value })} />
        <label htmlFor="ne-p">품목·규격</label><input id="ne-p" value={f.spec} onChange={e => s({ spec: e.target.value })} maxLength={100} />
        <label htmlFor="ne-m">메모</label><textarea id="ne-m" rows={3} value={f.memo} onChange={e => s({ memo: e.target.value })} />
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className="btn np-btn" disabled={busy} onClick={() => go('np_update', { p_id: p.id, p_name: f.name, p_customer: f.customer, p_spec: f.spec, p_memo: f.memo, p_sample: f.sample || null }, '내용을 고쳤습니다')}>저장</button><button type="button" className="btn ghost" onClick={close}>취소</button></div>
      </>
    )
  } else if (sheet.kind === 'owner') {
    head = '담당 바꾸기'
    body = (
      <>
        <label htmlFor="no-o">새 담당자</label>
        <OwnerSelect id="no-o" value={owner} onChange={setOwner} />
        <label className="np-ck"><input type="checkbox" checked={moveT} onChange={e => setMoveT(e.target.checked)} /> 남은 할 일도 새 담당자에게 넘기기 <small>(다른 사람에게 따로 맡긴 할 일은 그대로)</small></label>
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className="btn np-btn" disabled={busy || !owner || owner === p.owner} onClick={() => go('np_set_owner', { p_id: p.id, p_owner: owner, p_move: moveT }, '담당을 바꿨습니다')}>바꾸기</button><button type="button" className="btn ghost" onClick={close}>취소</button></div>
      </>
    )
  } else if (sheet.kind === 'add') {
    head = '사후업무 추가'
    body = (
      <>
        <label htmlFor="na-t">할 일 <span className="req">*필수</span></label>
        <input id="na-t" autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={100} placeholder="예: 고객사 품질 서류 제출" />
        <label htmlFor="na-w">맡을 사람</label>
        <OwnerSelect id="na-w" value={who} onChange={setWho} />
        <p className="note">사후업무 맨 끝에 붙습니다</p>
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className="btn np-btn" disabled={busy || !title.trim()} onClick={() => go('np_task_add', { p_id: p.id, p_title: title, p_user: who || null }, '사후업무를 추가했습니다')}>추가</button><button type="button" className="btn ghost" onClick={close}>취소</button></div>
      </>
    )
  } else if (sheet.kind === 'stop' || sheet.kind === 'resume') {
    const stop = sheet.kind === 'stop'
    head = stop ? '신제품 중단' : '다시 진행'
    body = (
      <>
        <label htmlFor="ns-r">{stop ? '중단 사유' : '다시 진행하는 사유'} <span className="req">*필수</span></label>
        <textarea id="ns-r" rows={2} autoFocus value={memo} onChange={e => setMemo(e.target.value)} placeholder={stop ? '예: 고객사 출시 보류' : '예: 고객사 출시 재개'} />
        {stop && <p className="note">중단하면 처리 버튼이 사라지고 요약에 '중단'으로 남습니다. 나중에 다시 진행할 수 있습니다.</p>}
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className={'btn ' + (stop ? 'warn' : 'np-btn')} disabled={busy || !memo.trim()} onClick={() => go(stop ? 'np_stop' : 'np_resume', { p_id: p.id, p_reason: memo }, stop ? '중단했습니다' : '다시 진행합니다')}>{stop ? '중단' : '다시 진행'}</button><button type="button" className="btn ghost" onClick={close}>취소</button></div>
      </>
    )
  } else if (sheet.kind === 'delete') {
    head = '신제품 삭제'
    body = (
      <>
        <p className="note">'{p.name}'의 사후업무·생산 점검·대화·기록이 모두 지워지고 되돌릴 수 없습니다. 잘못 등록한 경우에만 쓰고, 개발을 멈춘 경우는 '중단'을 씁니다.</p>
        <label htmlFor="nd-c">지우려면 <b>삭제</b>라고 입력</label>
        <input id="nd-c" value={memo} onChange={e => setMemo(e.target.value)} autoFocus />
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className="btn warn" disabled={busy || memo.trim() !== '삭제'} onClick={() => go('np_delete', { p_id: p.id, p_confirm: '삭제' }, '신제품을 삭제했습니다', () => { close(); npGo('sum', null) })}>완전 삭제</button><button type="button" className="btn ghost" onClick={close}>취소</button></div>
      </>
    )
  }
  return (
    <>
      <div className="scrim" onClick={() => { if (!memo.trim()) close(); else toast('쓰던 글이 있습니다 · ✕로 닫으면 됩니다') }} />
      <div className="sheet np-sheet" role="dialog" aria-modal="true" aria-label={head}>
        <div className="s-top"><span className="s-tag">{p.name}{t && !isC ? ` · ${p.steps.indexOf(t) + 1}/${p.steps.length}` : ''}</span><button type="button" className="s-x" onClick={close} aria-label="닫기">✕</button></div>
        <div className="s-title">{head}</div>
        <div className="nf np-sf">{body}</div>
      </div>
    </>
  )
}

// =============================================================
// 관리자 모드 › 신제품 설정
export function NpAdmin() {
  const { db, toast, reload } = useApp()
  const [sub, setSub] = useState('team')
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState(() => db.npTemplates.map(t => t.title))
  const [nt, setNt] = useState('')
  const [err, setErr] = useState('')
  const base = db.npTemplates.map(t => t.title)
  const dirty = JSON.stringify(rows) !== JSON.stringify(base)
  useEffect(() => { if (!dirty) setRows(base) }, [JSON.stringify(base)])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!db.npReady) return <><div className="adm-h"><div><h1>신제품 설정</h1></div></div><div className="card empty">upgrade22.sql을 먼저 실행해야 합니다.</div></>
  const devs = devPeople(db)
  const ownN = id => db.np.filter(p => p.owner === id && p.status === '진행중').length
  const setTeam = async (id, team) => {
    if (busy) return
    setBusy(true)
    const { error } = await supabase.rpc('np_member_set', { p_user: id, p_team: team })
    setBusy(false)
    if (error) return toast(errText(error))
    await reload(); toast('팀을 저장했습니다')
  }
  const move = (i, d) => { const a = [...rows]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setRows(a) }
  const saveTpl = async () => {
    const list = rows.map(r => r.trim()).filter(Boolean)
    if (!list.length) return setErr('하나 이상 넣어주세요.')
    if (new Set(list).size !== list.length) return setErr('같은 이름이 두 번 들어 있습니다.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('np_tpl_set', { p_titles: list })
    setBusy(false)
    if (error) return setErr(errText(error))
    await reload(); toast('기본 사후업무를 저장했습니다 · 앞으로 등록하는 신제품부터 적용됩니다')
  }
  return (
    <>
      <div className="adm-h"><div><h1>신제품 설정</h1><p>개발팀 구성(내 할 일 '우리 팀' 보기·요약 필터) · 신제품 등록 때 미리 체크되어 나오는 기본 사후업무</p></div></div>
      <div className="seg sm np-adm-seg"><button type="button" className={sub === 'team' ? 'on' : ''} onClick={() => setSub('team')}>개발팀 구성</button><button type="button" className={sub === 'tpl' ? 'on' : ''} onClick={() => setSub('tpl')}>기본 사후업무 {base.length}</button></div>
      {sub === 'team' ? (
        <div className="card adm-card">
          <p className="note" style={{ marginTop: 0 }}>'{NP_DEPT}' 부서 가입자만 나옵니다 · {NP_DEPT}이면 누구나 신제품 등록·수정·처리를 할 수 있습니다 · 다른 부서는 보기와 대화 글쓰기만 됩니다</p>
          {devs.length ? (
            <table className="adm-t np-mem">
              <thead><tr><th>이름</th><th>이메일</th><th>팀</th><th>담당 중</th></tr></thead>
              <tbody>
                {devs.map(u => {
                  const cur = db.npMembers[u.id] || ''
                  return (
                    <tr key={u.id}>
                      <td><b>{u.name}</b></td><td className="muted">{String(u.email).split('@')[0]}</td>
                      <td><div className="seg sm">{[...TEAMS, ''].map(tm => <button key={tm || 'x'} type="button" disabled={busy} className={cur === tm ? 'on' : ''} onClick={() => cur !== tm && setTeam(u.id, tm)}>{tm || '미지정'}</button>)}</div></td>
                      <td>{ownN(u.id)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : <p className="muted">'{NP_DEPT}' 부서 가입자가 없습니다. 부서 이름이 정확히 '{NP_DEPT}'인지 확인해주세요.</p>}
        </div>
      ) : (
        <div className="card adm-card np-tpl">
          <p className="note" style={{ marginTop: 0 }}>순서대로 신제품 등록 화면에 미리 체크되어 나옵니다 · 저장하면 앞으로 등록하는 신제품부터 적용되고, 이미 등록된 신제품은 그대로입니다 · 생산 점검(1~3차)은 따로 자동으로 붙습니다</p>
          {rows.map((r, i) => (
            <div key={i} className="np-tr">
              <span className="np-no">{i + 1}</span>
              <input value={r} onChange={e => setRows(rows.map((x, j) => (j === i ? e.target.value : x)))} maxLength={100} aria-label={`${i + 1}번 사후업무`} />
              <span className="mv">
                <button type="button" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" aria-label="아래로" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" aria-label="빼기" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
              </span>
            </div>
          ))}
          <form className="np-add" onSubmit={e => { e.preventDefault(); if (nt.trim()) { setRows([...rows, nt.trim()]); setNt('') } }}>
            <input value={nt} onChange={e => setNt(e.target.value)} placeholder="+ 사후업무 추가 (Enter)" maxLength={100} aria-label="사후업무 추가" />
          </form>
          {err && <p className="nf-err">{err}</p>}
          <div className="np-tpl-acts">
            <button type="button" className="btn" disabled={busy || !dirty} onClick={saveTpl}>{busy ? '저장 중…' : '기본 사후업무 저장'}</button>
            {dirty && <button type="button" className="btn ghost" onClick={() => { setRows(base); setErr('') }}>되돌리기</button>}
            {dirty && <span className="np-dirty">저장하지 않은 변경이 있습니다</span>}
          </div>
        </div>
      )}
    </>
  )
}
