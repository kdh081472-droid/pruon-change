import { Fragment, useEffect, useRef, useState } from 'react'
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

// 남은 사후업무가 있는 진행 중 신제품 / 그중 내 담당(담당자이거나 남은 업무를 맡음)
const hasLeft = p => p.status === '진행중' && p.steps.some(t => t.status === '대기')
const isMineNp = (p, uid) => p.owner === uid || p.steps.some(t => t.status === '대기' && t.assignee === uid)
// 신제품 탭 빨간 숫자: 내 할 일(내 담당 · 남은 사후업무 있는 신제품) + 안 읽은 신제품 대화
export function npBadge(db, uid, me) {
  if (!db || !db.np) return 0
  const editor = me && me.department === NP_DEPT && !me.left_at
  const due = editor ? db.np.filter(p => hasLeft(p) && isMineNp(p, uid)).length : 0
  const rd = room => db.reads[uid + '|' + room] || 0
  const unread = db.npMessages.filter(m => m.user_id !== uid && !m.deleted && m.id > rd(m.room)).length
  return due + unread
}

function TeamChip({ team }) {
  if (!team) return null
  return <span className={'np-team ' + teamCls(team)}>{team}</span>
}
// 신제품의 담당 팀 (파트장이 담당이면 '파트장' 표시를 함께)
function ProdTeam({ p }) {
  return <>{p.team ? <TeamChip team={p.team} /> : <span className="np-team none">팀 미정</span>}{p.byLead && <span className="np-team npl">파트장</span>}</>
}
// 담당자가 실무자(1팀·2팀)가 아니면 담당 팀을 따로 골라야 함
const needTeam = (db, id) => !!id && !['1팀', '2팀'].includes(db.npMembers[id])
function TeamPick({ value, onChange }) {
  return (
    <div className="np-tpick" role="group" aria-label="담당 팀">
      {['1팀', '2팀'].map(t => <button key={t} type="button" className={'np-tpb ' + teamCls(t) + (value === t ? ' on' : '')} aria-pressed={value === t} onClick={() => onChange(t)}>{t}</button>)}
    </div>
  )
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
  // 처리 버튼: 메모 필요 없는 사후업무는 바로 완료(5초 되돌리기), 메모 필요·생산 점검은 창
  const [undo, setUndo] = useState(null)        // { tid, msg }
  const doTask = async (t, p) => {
    if (!editor || !t || t.status !== '대기') return
    if (t.kind === 'check') return setSheet(t.prod_date ? { kind: 'task', tid: t.id } : { kind: 'date', tid: t.id })
    if (t.need_memo) return setSheet({ kind: 'task', tid: t.id })
    const { error } = await supabase.rpc('np_task_done', { p_task: t.id, p_status: '완료', p_memo: null, p_report: false })
    if (error) return toast(errText(error) + (/메모/.test(error.message || '') ? ' (upgrade23.sql을 실행했는지 확인해주세요)' : ''))
    await reload()
    setUndo({ tid: t.id, msg: `✓ ${p.steps.indexOf(t) + 1} ${t.title} 완료 · ${p.name}`, at: Date.now() })
  }
  useEffect(() => { if (!undo) return; const tm = setTimeout(() => setUndo(null), 5000); return () => clearTimeout(tm) }, [undo])
  const undoNow = async () => {
    const u = undo
    setUndo(null)
    const { error } = await supabase.rpc('np_task_cancel', { p_task: u.tid, p_reason: '되돌리기' })
    if (error) return toast(errText(error))
    await reload(); toast('되돌렸습니다 · 다시 대기로 돌아갔습니다')
  }
  // 확인 취소: 사유 없이 바로 대기로 (취소 전 메모는 서버 기록에 남음)
  const cancelTask = t => run('np_task_cancel', { p_task: t.id, p_reason: null }, '확인을 취소했습니다 · 다시 대기로 돌아갔습니다')
  const npApp = { ...app, openNpTask, npRun: run, npOpen: open, npGo: go, npEditor: editor, setNpSheet: setSheet, npDo: doTask, npCancel: cancelTask }
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
      {undo && <div className="np-undo-toast" role="status">{undo.msg}<button type="button" onClick={undoNow}>되돌리기</button></div>}
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
// 내 할 일 (개발팀) — 신제품마다 접힌 한 줄 · 펼치면 사후업무·생산 점검을 바로 처리
function NpMine() {
  const { db, uid, ui, setUi } = useApp()
  const myTeam = db.npMembers[uid] || ''
  const view = ui.npView || (myTeam === '파트장' ? 'all' : 'me')
  const live = db.np.filter(hasLeft)     // 남은 사후업무가 있는 신제품만 (생산 점검은 요약·달력에서)
  const isMine = p => isMineNp(p, uid)
  const inTeam = p => (myTeam === '1팀' || myTeam === '2팀' ? p.team === myTeam || !p.team : true)
  const lists = { me: live.filter(isMine), team: live.filter(inTeam), all: live }
  const list = [...lists[view]].sort((a, b) => (staleDays(b) >= STALE) - (staleDays(a) >= STALE) || String(b.sample_date).localeCompare(String(a.sample_date)))
  const teamLbl = myTeam === '1팀' || myTeam === '2팀' ? `우리 팀(${myTeam})` : '우리 팀'
  const open = ui.npOpen || {}
  const allOpen = list.length > 0 && list.every(p => open[p.id])
  return (
    <>
      <div className="np-viewbar">
        <div className="seg sm">
          {[['me', '내 담당'], ['team', teamLbl], ['all', '전체']].map(([k, l]) => <button key={k} type="button" className={view === k ? 'on' : ''} onClick={() => setUi(u => ({ ...u, npView: k }))}>{l} {lists[k].length}</button>)}
        </div>
        {list.length > 0 && <button type="button" className="link np-allt" onClick={() => setUi(u => ({ ...u, npOpen: Object.fromEntries(list.map(p => [p.id, !allOpen])) }))}>{allOpen ? '모두 접기' : '모두 펼치기'}</button>}
        {!myTeam && <small className="muted">팀이 아직 지정되지 않았습니다 (관리자 모드 › 신제품 설정)</small>}
      </div>
      <div className="np-rows">{list.map(p => <NpRow key={p.id} p={p} />)}</div>
      {!list.length && <div className="card empty">{view === 'me' ? '내가 담당하는 신제품 중 남은 사후업무가 없습니다.' : '남은 사후업무가 있는 신제품이 없습니다.'} <small className="muted">생산 점검은 요약·달력에서 봅니다</small></div>}
    </>
  )
}

function NpRow({ p }) {
  const { db, ui, setUi, npOpen } = useApp()
  const isOpen = !!(ui.npOpen || {})[p.id]
  const toggle = () => setUi(u => ({ ...u, npOpen: { ...(u.npOpen || {}), [p.id]: !isOpen } }))
  const st = staleDays(p)
  const left = p.steps.filter(t => t.status === '대기').length
  return (
    <div className={'card np-row' + (isOpen ? ' open' : '')}>
      <div className="np-rh" role="button" tabIndex={0} aria-expanded={isOpen} onClick={toggle} onKeyDown={e => { if (e.key === 'Enter') toggle() }}>
        <span className="np-car">{isOpen ? '▾' : '▸'}</span>
        <span className="np-rt">
          <b>{p.name}</b>
          <small>{[p.customer, nameOf(db, p.owner)].filter(Boolean).join(' · ')} <ProdTeam p={p} />{p.launch && <> · 출시 {md(p.launch)}</>}</small>
        </span>
        <span className="np-rm">
          {st >= STALE && <span className="np-stale">{st}일째 그대로</span>}
          <Prog p={p} />
          <span className="np-left">남은 <b>{left}</b>건</span>
        </span>
      </div>
      {isOpen && (
        <div className="np-rb">
          <NpSteps p={p} compact hideDone />
          <div className="np-rbf"><button type="button" className="link" onClick={() => npOpen(p.id)}>상세·대화 열기 ›</button></div>
        </div>
      )}
    </div>
  )
}

// 사후업무 목록 (상세 · 내 할 일 펼침 공용) — 줄 간격 좁게, 메모는 처리자 옆 한 줄
function NpSteps({ p, compact, hideDone }) {
  const { db, npEditor, npDo, npCancel, setNpSheet } = useApp()
  const [showDone, setShowDone] = useState(false)
  const live = p.status === '진행중'
  const doneN = p.steps.filter(t => t.status !== '대기').length
  const hide = hideDone && !showDone
  return (
    <div className={'np-steps' + (compact ? ' compact' : '')}>
      {p.steps.map((t, i) => {
        if (hide && t.status !== '대기') return null
        const cur = p.next && p.next.id === t.id
        return (
          <div key={t.id} className={'np-st' + (t.status !== '대기' ? ' dn' : '') + (cur ? ' cur' : '')}>
            <span className="np-no">{i + 1}</span>
            <span className="nm">
              {t.title}{t.need_memo && <i className="np-mi" title="메모 필요">✎</i>}
              {cur && <span className="np-nexttag">다음</span>}{t.status === '해당없음' && <span className="np-na">해당없음</span>}
            </span>
            <span className="by" title={t.memo || ''}>
              {t.status === '대기' ? '대기' : <>{t.status === '완료' ? '✓' : '–'} {nameOf(db, t.done_by)} · {md(new Date(t.done_at))}{t.memo && <span className="np-mm"> · {t.memo}</span>}</>}
            </span>
            <span className="as">
              {npEditor && live && t.status === '대기'
                ? <button type="button" className="link" onClick={() => setNpSheet({ kind: 'assign', tid: t.id })}>{nameOf(db, t.assignee)} ▾</button>
                : nameOf(db, t.assignee)}
            </span>
            <span className="ac">
              {npEditor && live && t.status === '대기' && (
                <>
                  <button type="button" className="np-nalink" onClick={() => setNpSheet({ kind: 'na', tid: t.id })}>해당없음</button>
                  <button type="button" className={'btn sm' + (cur ? ' np-btn' : ' ghost')} onClick={() => npDo(t, p)}>{t.need_memo ? '처리' : '완료'}</button>
                </>
              )}
              {npEditor && live && t.status !== '대기' && <button type="button" className="np-undo" onClick={() => npCancel(t)}>확인 취소</button>}
            </span>
          </div>
        )
      })}
      {!p.steps.length && <div className="empty">사후업무가 없습니다.</div>}
      {hideDone && doneN > 0 && <button type="button" className="np-donet" onClick={() => setShowDone(v => !v)}>{showDone ? '처리한 업무 숨기기 ▴' : `처리한 업무 ${doneN}건 보기 ▾`}</button>}
    </div>
  )
}

// =============================================================
// 요약 — 노션 표처럼 사후업무 칸을 눌러 바로 처리
function NpSummary() {
  const { db, ui, setUi, uid, npEditor } = useApp()
  const st = ui.npSum || { chips: ['진행 중', '생산 점검 중'], team: '', q: '', sort: { k: 'reg', dir: 'desc' } }
  const set = o => setUi(u => ({ ...u, npSum: { ...st, ...o } }))
  const cnt = s => db.np.filter(p => p.stage === s).length
  const toggle = s => set({ chips: st.chips.includes(s) ? st.chips.filter(x => x !== s) : [...st.chips, s] })
  let list = db.np.filter(p => (!st.chips.length || st.chips.includes(p.stage)) && (!st.team || (st.team === 'me' ? isMineNp(p, uid) : p.team === st.team)))
  if (st.q.trim()) list = list.filter(p => hasAll([p.name, p.customer, p.spec, nameOf(db, p.owner), p.team, p.next && p.next.title].join(' '), st.q))
  const val = (p, k) => ({ name: p.name, customer: p.customer || '', owner: nameOf(db, p.owner), prog: p.stepsDone / (p.steps.length || 1), reg: p.sample_date, launch: p.launch || '9999', stage: STAGES.indexOf(p.stage) }[k])
  list = [...list].sort((a, b) => { const x = val(a, st.sort.k), y = val(b, st.sort.k); return (x > y ? 1 : x < y ? -1 : 0) * (st.sort.dir === 'asc' ? 1 : -1) })
  const H = ({ k, children, cls }) => (
    <th className={cls}><button type="button" className="np-th" onClick={() => set({ sort: { k, dir: st.sort.k === k && st.sort.dir === 'asc' ? 'desc' : 'asc' } })}>{children}{st.sort.k === k ? (st.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
  )
  return (
    <>
      <div className="np-chips">
        {STAGES.map(s => <button key={s} type="button" className={'np-chip' + (st.chips.includes(s) ? ' on' : '')} onClick={() => toggle(s)}>{s} {cnt(s)}</button>)}
        <span className="np-div" aria-hidden="true" />
        <div className="seg sm">{[...(npEditor ? [['me', '내 담당']] : []), ['', '전체'], ['1팀', '1팀'], ['2팀', '2팀']].map(([k, l]) => <button key={l} type="button" className={st.team === k ? 'on' : ''} onClick={() => set({ team: k })}>{l}</button>)}</div>
        <input className="np-q" value={st.q} onChange={e => set({ q: e.target.value })} placeholder="검색 (제품·고객사·담당)" aria-label="신제품 검색" />
      </div>
      {list.length > 0 && <NpTable list={list} H={H} />}
      {!list.length && <div className="card empty">{db.np.length ? '조건에 맞는 신제품이 없습니다.' : '아직 등록된 신제품이 없습니다.'}</div>}
    </>
  )
}

// 표: 행 = 신제품, 열 = 기본 사후업무 + (추가 업무) + 생산 점검 1~3차
function NpTable({ list, H }) {
  const { db, npOpen, npEditor, npRun, npCancel, setNpSheet, toast } = useApp()
  const [pop, setPop] = useState(null)       // { tid, x, y }
  const [memo, setMemo] = useState('')
  const [report, setReport] = useState(false)
  const [date, setDate] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const wrap = useRef(null)
  const cols = db.npTemplates.map(t => ({ title: t.title, need_memo: t.need_memo }))
  const colSet = new Set(cols.map(c => c.title))
  const hasExtra = list.some(p => p.steps.some(t => !colSet.has(t.title)))
  useEffect(() => {
    if (!pop) return
    const onKey = e => { if (e.key === 'Escape') setPop(null) }
    const onDown = e => { if (!e.target.closest('.np-pop') && !e.target.closest('.np-cell')) setPop(null) }
    document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [pop])
  const found = pop && db.np.flatMap(p => [...p.steps, ...p.checks].map(t => ({ t, p }))).find(x => x.t.id === pop.tid)
  const openPop = (e, t, p) => {
    const r = e.currentTarget.getBoundingClientRect(), w = wrap.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(r.left - w.left - 120, w.width - 350)), y = r.bottom - w.top + 4
    setMemo(t.status === '완료' ? lastMemo(p, t, ['해당없음']) : t.status === '대기' ? lastMemo(p, t, ['완료', '해당없음']) : ''); setReport(false); setErr(''); setDate(t.prod_date ? String(t.prod_date).slice(0, 10) : '')
    // ✎ 없는 사후업무: 누를 때마다 대기 → 완료 → 해당없음(사유 입력) → 대기
    if (quick(t, p)) {
      if (t.status === '완료') return setPop({ tid: t.id, x, y, na: true })
      setPop(null)
      return cycle(t)
    }
    setPop({ tid: t.id, x, y })
  }
  const quick = (t, p) => npEditor && t.kind === 'step' && !t.need_memo && p.status === '진행중'
  // 칸에 마우스를 올리면 그 열(옅은 세로 띠)과 그 줄을 표시 — 마우스가 있는 기기만
  const guide = useRef({ cells: [], row: null })
  const clearGuide = () => { guide.current.cells.forEach(x => x.classList.remove('colhl')); if (guide.current.row) guide.current.row.classList.remove('rowhl'); guide.current = { cells: [], row: null } }
  const hoverGuide = e => {
    if (typeof window === 'undefined' || !window.matchMedia || !window.matchMedia('(hover: hover)').matches) return
    const cell = e.target.closest('td, th'); const table = e.currentTarget
    if (!cell || !table.contains(cell)) return
    const idx = cell.cellIndex, tr = cell.parentElement
    const col = ['np-c', 'pk', 'sh', 'ck'].some(k => cell.classList.contains(k))
    if (guide.current.row === tr && guide.current.idx === idx) return
    clearGuide()
    if (!col) return
    const cells = [...table.rows].map(r => r.cells[idx]).filter(Boolean)
    cells.forEach(x => x.classList.add('colhl'))
    if (tr.parentElement.tagName === 'TBODY') tr.classList.add('rowhl')
    guide.current = { cells, row: tr, idx }
  }
  const [cBusy, setCBusy] = useState(null)
  const cycle = async t => {
    if (cBusy) return
    setCBusy(t.id)
    const r = t.status === '대기'
      ? await npRun('np_task_done', { p_task: t.id, p_status: '완료', p_memo: null, p_report: false })
      : await npRun('np_task_cancel', { p_task: t.id, p_reason: null })
    setCBusy(null)
    if (r.error) toast(r.error)
  }
  const save = async (fn, args, ok) => {
    if (busy) return
    setBusy(true); setErr('')
    const r = await npRun(fn, args, ok)
    setBusy(false)
    if (r.error) return setErr(r.error)
    setPop(null)
  }
  const cell = (t, p) => {
    if (!t) return <td className="np-c none"><span className="np-dot">·</span></td>
    const cur = p.next && p.next.id === t.id
    const cls = t.status === '완료' ? 'ok' : t.status === '해당없음' ? 'na' : cur ? 'pend nx' : 'pend'
    return (
      <td className={'np-c ' + cls + (pop && pop.tid === t.id ? ' on' : '') + (cBusy === t.id ? ' busy' : '')}>
        <button type="button" className="np-cell" disabled={cBusy === t.id} title={`${t.title} · ${t.status}${t.status !== '대기' ? ` · ${nameOf(db, t.done_by)} ${t.done_at ? md(new Date(t.done_at)) : ''}${t.memo ? ' · ' + t.memo : ''}` : ' · 담당 ' + nameOf(db, t.assignee)}${quick(t, p) ? '\n누르면 → ' + { 대기: '완료', 완료: '해당없음(사유) 또는 대기로 되돌리기', 해당없음: '대기' }[t.status] : ''}`} onClick={e => openPop(e, t, p)}>
          <span className="np-box">{t.status === '완료' ? '✓' : t.status === '해당없음' ? '–' : ''}</span>
        </button>
      </td>
    )
  }
  const ckCell = (c, p) => {
    const s = checkState(c)
    return (
      <td className={'np-c pk ' + s + (pop && pop.tid === c.id ? ' on' : '')}>
        <button type="button" className="np-cell" onClick={e => openPop(e, c, p)}>
          <span className="dd">{s === 'ok' ? '✓ ' : ''}{s === 'na' ? '해당없음' : c.prod_date ? md(c.prod_date) : '미정'}</span>
          {c.round === 1 && c.report_done && <small>보고서 ✓</small>}
        </button>
      </td>
    )
  }
  let popBody = null
  if (found) {
    const { t, p } = found
    const live = p.status === '진행중'
    const isC = t.kind === 'check'
    const head = <div className="np-poph">{isC ? `${t.round}차 생산 점검` : `${p.steps.indexOf(t) + 1} ${t.title}`} · {p.name}{(t.need_memo && !isC) && <span className="np-mtag">✎ 메모 필요</span>}</div>
    if (pop.na && t.status === '완료') {
      const na = () => { if (!memo.trim()) return setErr('해당없음 사유를 입력해주세요.'); save('np_task_na', { p_task: t.id, p_memo: memo }, '해당없음으로 바꿨습니다') }
      popBody = (
        <>
          {head}
          <label className="np-popl" htmlFor="np-na">해당없음 사유 (필수)</label>
          <textarea id="np-na" rows={2} autoFocus value={memo} placeholder="예: 고객사에서 진행" onChange={e => { setMemo(e.target.value); setErr('') }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); na() } }} />
          {err && <p className="nf-err">{err}</p>}
          <div className="np-popa">
            <button type="button" className="btn sm np-btn" disabled={busy} onClick={na}>해당없음으로 저장</button>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => save('np_task_cancel', { p_task: t.id, p_reason: null }, '대기로 되돌렸습니다')}>↩ 대기로 되돌리기</button>
            <span className="np-poph2">Enter 저장 · Esc 닫기 (완료로 남음)</span>
          </div>
        </>
      )
    } else if (t.status !== '대기') {
      popBody = (
        <>
          {head}
          <div className="np-popi">{t.status === '완료' ? '✓' : '–'} {nameOf(db, t.done_by)} · {md(new Date(t.done_at))} {t.status === '해당없음' ? '해당없음' : '처리'}{isC && t.prod_date ? ` · 생산일 ${md(t.prod_date)}` : ''}{t.memo ? <><br />“{t.memo}”</> : null}</div>
          {npEditor && live && <div className="np-popa"><button type="button" className="btn sm ghost" onClick={() => { setPop(null); npCancel(t) }}>확인 취소</button>{!isC && <button type="button" className="link" onClick={() => npOpen(p.id)}>상세 ›</button>}</div>}
        </>
      )
    } else if (!npEditor || !live) {
      popBody = <>{head}<div className="np-popi">대기 · 담당 {nameOf(db, t.assignee)}{isC ? ` · 생산일 ${t.prod_date ? md(t.prod_date) : '미정'}` : ''}</div></>
    } else if (isC && !t.prod_date) {
      popBody = (
        <>
          {head}
          <label className="np-popl" htmlFor="np-pd">생산일 (생산계획에 나온 날짜)</label>
          <input id="np-pd" type="date" value={date} autoFocus onChange={e => setDate(e.target.value)} />
          {err && <p className="nf-err">{err}</p>}
          <div className="np-popa"><button type="button" className="btn sm np-btn" disabled={busy || !date} onClick={() => save('np_set_date', { p_task: t.id, p_date: date }, `${t.round}차 생산일을 ${md(date)}로 정했습니다`)}>저장</button></div>
        </>
      )
    } else {
      const done = () => {
        if (!memo.trim()) return setErr('메모를 입력해주세요.')
        if (isC && t.round === 1 && !report) return setErr('초도생산 보고서를 체크해야 1차 점검을 완료할 수 있습니다.')
        save('np_task_done', { p_task: t.id, p_status: '완료', p_memo: memo, p_report: report }, isC ? `${t.round}차 점검을 완료했습니다` : '확인완료로 저장했습니다')
      }
      popBody = (
        <>
          {head}
          {isC && t.round === 1 && <label className="np-ck"><input type="checkbox" checked={report} onChange={e => setReport(e.target.checked)} /> <b>초도생산 보고서 작성</b></label>}
          <textarea rows={2} autoFocus value={memo} placeholder={isC ? '점검 메모 (필수)' : '처리 메모 (필수)'} onChange={e => { setMemo(e.target.value); setErr('') }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); done() } }} />
          {err && <p className="nf-err">{err}</p>}
          <div className="np-popa">
            <button type="button" className="btn sm np-btn" disabled={busy} onClick={done}>{isC ? `${t.round}차 점검 완료` : '확인완료'}</button>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => { if (!memo.trim()) return setErr('해당없음 사유를 메모에 입력해주세요.'); save('np_task_done', { p_task: t.id, p_status: '해당없음', p_memo: memo, p_report: false }, '해당없음으로 저장했습니다') }}>해당없음</button>
            {isC && <button type="button" className="link" onClick={() => { setPop(null); setNpSheet({ kind: 'date', tid: t.id }) }}>생산일 바꾸기</button>}
            <span className="np-poph2">Enter 저장 · Esc 닫기</span>
          </div>
        </>
      )
    }
  }
  return (
    <div className="np-tw" ref={wrap}>
      <div className="np-tsc" onScroll={() => pop && setPop(null)}>
        <table className="np-mx" onMouseOver={hoverGuide} onMouseLeave={clearGuide}>
          <thead>
            <tr>
              <H k="name" cls="pn">제품</H><H k="reg" cls="dt">등록일</H><H k="launch" cls="dt">출시일</H>
              {cols.map((c, i) => <th key={c.title} className="sh" title={c.title + (c.need_memo ? ' · 메모 필요' : '')}><span className="sn2">{i + 1}</span><span className="st2">{c.title}</span>{c.need_memo && <i className="np-mi">✎</i>}</th>)}
              {hasExtra && <th className="sh"><span className="sn2">+</span><span className="st2">추가 업무</span></th>}
              {[1, 2, 3].map(r => <th key={r} className="sh ck"><span className="sn2">{r}차</span><span className="st2">생산 점검</span></th>)}
            </tr>
          </thead>
          <tbody>
            {list.map(p => {
              const extra = p.steps.filter(t => !colSet.has(t.title))
              return (
                <tr key={p.id} className={p.stage === '완료' || p.stage === '중단' ? 'fin' : ''}>
                  <td className="pn"><button type="button" className="np-pnb" onClick={() => npOpen(p.id)}><b>{p.name}</b><span>{[p.customer, nameOf(db, p.owner)].filter(Boolean).join(' · ')} <ProdTeam p={p} />{p.stage === '중단' && <span className="np-stt stp">중단</span>}</span></button></td>
                  <td className="dt">{md(p.sample_date)}</td>
                  <td className={'dt' + (p.launch ? '' : ' tbd')}>{p.launch ? md(p.launch) : '미정'}</td>
                  {cols.map(c => <Fragment key={c.title}>{cell(p.steps.find(t => t.title === c.title), p)}</Fragment>)}
                  {hasExtra && (
                    <td className="np-c ex">
                      {extra.length ? <button type="button" className="np-cell np-exb" title={extra.map(t => t.title + ' · ' + t.status).join('\n')} onClick={() => npOpen(p.id)}>{extra.filter(t => t.status !== '대기').length}/{extra.length}</button> : <span className="np-dot">·</span>}
                    </td>
                  )}
                  {p.checks.map(c => <Fragment key={c.id}>{ckCell(c, p)}</Fragment>)}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pop && found && <div className="np-pop" style={{ left: pop.x, top: pop.y }}>{popBody}</div>}
      <div className="np-lg">
        <span><span className="np-box ok">✓</span>완료</span><span><span className="np-box na">–</span>해당없음</span><span><span className="np-box nx" />다음 할 일</span><span><span className="np-box" />대기</span>
        <span><span className="np-dot">·</span>이 제품엔 없는 업무</span><span><i className="np-mi">✎</i>메모 필요 (관리자 설정)</span>
        <span className="np-lgr">{npEditor ? '□ 누르기 = 완료 · ✓ 누르기 = 해당없음(사유) 또는 대기로 되돌리기 · – 누르기 = 대기 · ✎ 업무·생산 점검은 입력창' : '칸을 누르면 처리 내용을 볼 수 있습니다'}</span>
      </div>
    </div>
  )
}

// =============================================================
// 달력: 변경점 달력처럼 이번 달 + 다음 달 · 등록일 · 생산 점검 생산일 · 완료일
function NpCalendar() {
  const { db, ui, setUi, npOpen } = useApp()
  const t0 = todayMid()
  const m0 = parse(ui.npMonth || iso(new Date(t0.getFullYear(), t0.getMonth(), 1)))
  const months = [m0, new Date(m0.getFullYear(), m0.getMonth() + 1, 1)]
  const team = ui.npCalTeam || ''
  const sel = ui.npCalSel || null
  const move = k => setUi(u => ({ ...u, npMonth: iso(new Date(m0.getFullYear(), m0.getMonth() + k, 1)), npCalSel: null }))
  const thisMonth = () => setUi(u => ({ ...u, npMonth: null, npCalSel: null }))
  const evs = {}
  const push = (d, e) => { (evs[d] = evs[d] || []).push(e) }
  db.np.filter(p => !team || p.team === team).forEach(p => {
    p.checks.forEach(c => {
      if (!c.prod_date) return
      const s = checkState(c)
      push(String(c.prod_date).slice(0, 10), { p, cls: s === 'ok' || s === 'na' ? 'fin' : s === 'late' || s === 'today' ? 'late' : 'live', t: `${p.name} ${c.round}차 점검${c.round === 1 ? '(출시)' : ''}${s === 'na' ? ' · 해당없음' : ''}`, k: `${c.round}차 생산 점검${c.round === 1 ? ' · 출시(초도생산)' : ''} · ${{ ok: '완료', na: '해당없음', tbd: '', today: '오늘', late: '점검 지남', sch: '예정' }[s]}` })
    })
    if (p.status === '완료' && p.closed_at) push(iso(new Date(p.closed_at)), { p, cls: 'fin', t: `${p.name} 완료`, k: '완료' })
  })
  const todayIso = iso(t0)
  const grid = m => {
    const y = m.getFullYear(), mo = m.getMonth()
    const startDow = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < startDow; i++) cells.push(<span key={'b' + i} className="c2 blank" />)
    for (let d = 1; d <= days; d++) {
      const key = iso(new Date(y, mo, d)), es = evs[key] || []
      const sun = new Date(y, mo, d).getDay() === 0
      const cls = 'c2' + (key === todayIso ? ' today' : '') + (sel === key ? ' sel' : '') + (es.length ? ' has' : '')
      cells.push(es.length ? (
        <button type="button" key={key} className={cls} onClick={() => setUi(u => ({ ...u, npCalSel: u.npCalSel === key ? null : key }))}>
          <span className={'dn' + (sun ? ' sun' : '')}>{d}</span>
          {es.map((e, i) => <span key={i} className={'ev2 ' + e.cls} title={e.t}>{e.t}</span>)}
        </button>
      ) : <span key={key} className={cls}><span className={'dn' + (sun ? ' sun' : '')}>{d}</span></span>)
    }
    return (
      <div className="card mon2" key={y + '-' + mo}>
        <h3>{y}년 {mo + 1}월</h3>
        <div className="g7">{['일', '월', '화', '수', '목', '금', '토'].map((w, i) => <span key={w} className={'dow' + (i === 0 ? ' sun' : '')}>{w}</span>)}</div>
        <div className="g7">{cells}</div>
      </div>
    )
  }
  const sd = sel ? parse(sel) : null
  return (
    <>
      <div className="cal2-top">
        <span className="cal2-nav">
          <button type="button" className="chipb" onClick={() => move(-1)} aria-label="이전 달">◀</button>
          <button type="button" className="chipb" onClick={thisMonth}>이번 달</button>
          <button type="button" className="chipb" onClick={() => move(1)} aria-label="다음 달">▶</button>
        </span>
        <span className="g-foot cal2-legend">
          <span><i style={{ background: 'var(--accent)' }} />생산 점검 예정</span>
          <span><i style={{ background: 'var(--late)' }} />오늘·점검 지남</span>
          <span><i style={{ background: 'var(--done)' }} />완료</span>
        </span>
        <span className="np-sp" />
        <div className="seg sm">{[['', '전체'], ['1팀', '1팀'], ['2팀', '2팀']].map(([k, l]) => <button key={l} type="button" className={team === k ? 'on' : ''} onClick={() => setUi(u => ({ ...u, npCalTeam: k }))}>{l}</button>)}</div>
      </div>
      <div className="cal2">{months.map(grid)}</div>
      {sel && evs[sel] && (
        <div className="card day-card np-dayc">
          <div className="m-h"><span className="t">{sd.getMonth() + 1}월 {sd.getDate()}일 ({'일월화수목금토'[sd.getDay()]})</span></div>
          {evs[sel].map((e, i) => (
            <button key={i} type="button" className="np-dayr" onClick={() => npOpen(e.p.id)}>
              <b>{e.p.name}</b><span>{e.k}</span><span className="np-who">{nameOf(db, e.p.owner)} <ProdTeam p={e.p} /></span><span className="np-go">열기 ›</span>
            </button>
          ))}
        </div>
      )}
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
  const { db, uid, npRun, npOpen, ui, setUi } = useApp()
  const mkSteps = () => db.npTemplates.map((t, i) => ({ k: 't' + i, tid: t.id, t: t.title, m: !!t.need_memo, on: true }))
  const mkF = () => ({ name: '', customer: '', launch: '', owner: devPeople(db).some(p => p.id === uid) ? uid : '', team: '', spec: '', memo: '' })
  // 작성 중인 내용 보관: 창 크기를 바꿔 화면 구성이 바뀌거나, 다른 탭에 다녀오거나, 새로고침해도 남아 있게
  const DK = 'pruon-np-draft-' + uid
  const [d0] = useState(() => {
    if (ui.npDraft) return ui.npDraft
    try { const d = JSON.parse(localStorage.getItem(DK) || 'null'); if (d && d.f && Array.isArray(d.steps)) return d } catch (e) { /* 저장 불가 브라우저 */ }
    return null
  })
  const [f, setF] = useState(() => (d0 ? { ...mkF(), ...d0.f } : mkF()))
  const [steps, setSteps] = useState(() => (d0 ? d0.steps : mkSteps()))
  const [nt, setNt] = useState(() => (d0 ? d0.nt || '' : ''))
  const hasDraft = !!(f.name || f.customer || f.launch || f.spec || f.memo || nt || JSON.stringify(steps) !== JSON.stringify(mkSteps()))
  useEffect(() => {
    const d = hasDraft ? { f, steps, nt } : null
    setUi(u => ({ ...u, npDraft: d }))
    try { d ? localStorage.setItem(DK, JSON.stringify(d)) : localStorage.removeItem(DK) } catch (e) { /* 저장 불가 브라우저 */ }
  }, [f, steps, nt]) // eslint-disable-line react-hooks/exhaustive-deps
  const clearDraft = () => { setF(mkF()); setSteps(mkSteps()); setNt(''); setErr('') }
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const drag = useRef(null)
  const set = o => { setF({ ...f, ...o }); setErr('') }
  const onN = steps.filter(s => s.on && s.t.trim()).length
  const move = (from, to) => { if (from === to || from == null) return; const a = [...steps]; const [x] = a.splice(from, 1); a.splice(to, 0, x); setSteps(a) }
  async function submit() {
    if (!f.name.trim()) return setErr('제품명을 입력해주세요.')
    if (!f.owner) return setErr('담당자를 골라주세요.')
    const needT = needTeam(db, f.owner)
    if (needT && !f.team) return setErr('담당 팀(1팀/2팀)을 골라주세요.')
    setBusy(true)
    const r = await npRun('np_create', { p_name: f.name, p_customer: f.customer, p_spec: f.spec, p_memo: f.memo, p_owner: f.owner, p_team: needT ? f.team : null, p_launch: f.launch || null, p_steps: steps.filter(s => s.on && s.t.trim()).map(s => ({ tpl_id: s.tid || null, title: s.t.trim(), need_memo: s.m })) }, '신제품을 등록했습니다')
    setBusy(false)
    if (r.error) return setErr(r.error + (/np_create|function/i.test(r.error) ? ' (upgrade23·upgrade24 SQL을 실행했는지 확인해주세요)' : ''))
    setUi(u => ({ ...u, npDraft: null }))
    try { localStorage.removeItem(DK) } catch (e) { /* 저장 불가 브라우저 */ }
    npOpen(r.data)
  }
  let no = 0
  return (
    <div className="np-new">
      <div className="nf np-form">
        {hasDraft && <div className="np-draft">작성 중인 내용이 자동으로 보관됩니다 <button type="button" className="link" onClick={clearDraft}>지우고 새로 쓰기</button></div>}
        <label htmlFor="np-name">제품명 <span className="req">*필수</span></label>
        <input id="np-name" value={f.name} onChange={e => set({ name: e.target.value })} maxLength={100} placeholder="예: 새우 딤섬 500g" />
        <label htmlFor="np-cus">고객사</label>
        <input id="np-cus" value={f.customer} onChange={e => set({ customer: e.target.value })} maxLength={60} placeholder="예: 가나식품 / 자체 개발" />
        <label htmlFor="np-owner">담당자 <span className="req">*필수</span></label>
        <OwnerSelect id="np-owner" value={f.owner} onChange={v => set({ owner: v })} />
        {needTeam(db, f.owner) && (
          <>
            <label>담당 팀 <span className="req">*필수</span> <span className="np-opt">파트장이 담당이면 어느 팀 일인지 고르기</span></label>
            <TeamPick value={f.team} onChange={v => set({ team: v })} />
          </>
        )}
        <label htmlFor="np-launch">출시일 (초도생산일) <span className="np-opt">선택 · 모르면 비워 두고 나중에 넣기</span></label>
        <input id="np-launch" type="date" value={f.launch} onChange={e => set({ launch: e.target.value })} />
        <label htmlFor="np-spec">품목·규격</label>
        <input id="np-spec" value={f.spec} onChange={e => set({ spec: e.target.value })} maxLength={100} placeholder="예: 1kg × 10입 / 박스" />
        <label htmlFor="np-memo">메모</label>
        <textarea id="np-memo" rows={3} value={f.memo} onChange={e => set({ memo: e.target.value })} placeholder="스펙 요약, 참고 사항 등" />
        <p className="note">등록일이 샘플 확정일로 기록됩니다 · 출시일은 1차 생산 점검 생산일로 들어갑니다 · 팀은 담당자를 따라 자동으로 붙습니다(파트장이 담당이면 직접 고름) · 등록하면 신제품 대화방이 함께 만들어집니다</p>
      </div>
      <div className="np-steps-w">
        <div className="np-fl">사후업무 <span>· 담당자에게 모두 배정 · ⋮⋮ 끌어서 순서 · 체크를 끄면 빠짐 · ✎ = 메모 필요 (눌러서 바꾸기)</span></div>
        <div className="np-tl">
          {steps.map((s, i) => {
            if (s.on) no++
            return (
              <div key={s.k} className={'np-tr' + (s.on ? '' : ' off')} draggable onDragStart={() => { drag.current = i }} onDragOver={e => e.preventDefault()} onDrop={() => { move(drag.current, i); drag.current = null }}>
                <span className="h" title="끌어서 순서 바꾸기">⋮⋮</span>
                <input type="checkbox" checked={s.on} aria-label={s.t + ' 넣기'} onChange={() => setSteps(steps.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} />
                <span className="np-no">{s.on ? no : ''}</span>
                <span className="tt">{s.t}</span>
                <button type="button" className={'np-mt' + (s.m ? ' on' : '')} title={s.m ? '메모 필요 (누르면 끄기)' : '메모 없이 바로 완료 (누르면 메모 필요로)'} onClick={() => setSteps(steps.map((x, j) => (j === i ? { ...x, m: !x.m } : x)))}>✎</button>
                <span className="mv">
                  <button type="button" aria-label="위로" disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                  <button type="button" aria-label="아래로" disabled={i === steps.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                  <button type="button" aria-label="빼기" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>✕</button>
                </span>
              </div>
            )
          })}
          <form className="np-add" onSubmit={e => { e.preventDefault(); if (nt.trim()) { setSteps([...steps, { k: 'n' + Date.now(), t: nt.trim(), m: false, on: true }]); setNt('') } }}>
            <input value={nt} onChange={e => setNt(e.target.value)} placeholder="+ 할 일 직접 추가 (Enter)" maxLength={100} aria-label="할 일 직접 추가" />
          </form>
        </div>
        <div className="np-fl">생산 점검 <span>· 자동으로 붙음</span></div>
        <div className="np-pc np-pc-new"><span className="np-pill tbd">1차{f.launch ? ' ' + md(f.launch) : ''} · 초도생산 보고서</span><span className="np-pill tbd">2차</span><span className="np-pill tbd">3차</span></div>
        {err && <p className="nf-err">{err}</p>}
        <button type="button" className="btn np-go" disabled={busy} onClick={submit}>{busy ? '등록 중…' : `신제품 등록 · 사후업무 ${onN}건`}</button>
      </div>
    </div>
  )
}

// =============================================================
// 상세
function NpDetail({ p, onChat, unread }) {
  const { db, wide, npEditor, setNpSheet, npDo } = useApp()
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
            <span>등록일<b>{md(p.sample_date)} · {nameOf(db, p.created_by)}</b></span>
            <span>출시일<b>{p.launch ? md(p.launch) : '미정'}</b></span>
            <span>담당<b>{nameOf(db, p.owner)}</b> <ProdTeam p={p} />{!p.team && npEditor && <button type="button" className="link np-tlink" onClick={() => S('owner')}>팀 정하기</button>}</span>
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
      <NpSteps p={p} />

      <div className="np-sec">생산 점검 <span>· 1차 = 출시(초도생산) · 생산계획이 나오면 날짜를 넣음 · 3차까지 끝나면 완료</span></div>
      <div className="np-chk">
        {p.checks.map(c => {
          const s = checkState(c)
          return (
            <div key={c.id} className={'np-cb ' + s}>
              <div className="h">{c.round}차{c.round === 1 ? ' · 출시' : ''} <span className={'np-tag ' + s}>{{ ok: '완료', na: '해당없음', tbd: '날짜 미정', today: '오늘', late: '점검 지남', sch: '예정' }[s]}</span></div>
              <div className="d">생산일 {c.prod_date ? md(c.prod_date) + ' (' + '일월화수목금토'[parse(c.prod_date).getDay()] + ')' : '—'}</div>
              {c.round === 1 && <div className="sub">{c.report_done ? '☑' : '☐'} 초도생산 보고서 (1차 점검과 함께)</div>}
              {c.status !== '대기' && <div className="sub">{c.status === '완료' ? '✓' : '–'} {nameOf(db, c.done_by)} · {md(new Date(c.done_at))}{c.memo ? ' · “' + c.memo + '”' : ''}</div>}
              {npEditor && live && (
                <div className="acts">
                  {c.status === '대기' && <button type="button" className="btn sm ghost" onClick={() => setNpSheet({ kind: 'date', tid: c.id })}>{c.prod_date ? '생산일 바꾸기' : '생산일 넣기'}</button>}
                  {c.status === '대기' && c.prod_date && <button type="button" className={'btn sm' + (s === 'today' || s === 'late' ? ' np-btn' : ' ghost')} onClick={() => npDo(c, p)}>점검 처리</button>}
                  {c.status !== '대기' && <button type="button" className="np-undo" onClick={() => npCancel(c)}>확인 취소</button>}
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

// 이 업무에 마지막으로 남긴 메모 — 대기로 되돌린 뒤 다시 처리할 때 미리 채워 둠
const lastMemo = (p, t, acts) => {
  if (!p || !t) return ''
  const ls = (p.logs || []).filter(l => l.task_id === t.id && l.memo && acts.includes(l.action)).sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0) || String(a.created_at).localeCompare(String(b.created_at)))
  const l = ls[ls.length - 1]
  return l ? String(l.memo).replace(/ \(완료에서 바꿈\)$/, '') : ''
}

// =============================================================
// 처리 창들
function NpSheet({ sheet, close }) {
  const { db, npRun, npGo, toast } = useApp()
  const tk = sheet.tid ? db.np.flatMap(p => [...p.steps, ...p.checks].map(t => ({ t, p }))).find(x => x.t.id === sheet.tid) : null
  const p = tk ? tk.p : db.npMap[sheet.id]
  const t = tk ? tk.t : null
  const [memo, setMemo] = useState(() => (sheet.kind === 'na' ? lastMemo(p, t, ['해당없음']) : sheet.kind === 'task' ? lastMemo(p, t, ['완료', '해당없음']) : ''))
  const [report, setReport] = useState(false)
  const [date, setDate] = useState(t && t.prod_date ? String(t.prod_date).slice(0, 10) : '')
  const [f, setF] = useState(() => (p ? { name: p.name, customer: p.customer || '', spec: p.spec || '', memo: p.memo || '', launch: p.launch ? String(p.launch).slice(0, 10) : '' } : {}))
  const [owner, setOwner] = useState(p ? p.owner : '')
  const [team, setTeam] = useState(p ? p.team || '' : '')
  const [moveT, setMoveT] = useState(true)
  const [who, setWho] = useState(t ? t.assignee : (p ? p.owner : ''))
  const [title, setTitle] = useState('')
  const [needM, setNeedM] = useState(false)
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
  } else if (sheet.kind === 'na') {
    head = `해당없음 · ${t.title}`
    body = (
      <>
        <label htmlFor="np-na-r">해당없음 사유 <span className="req">*필수</span></label>
        <textarea id="np-na-r" rows={2} autoFocus value={memo} onChange={e => { setMemo(e.target.value); setErr('') }} placeholder="예: 이번 제품은 영양성분 표시 대상 아님" />
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className="btn np-btn" disabled={busy || !memo.trim()} onClick={() => go('np_task_done', { p_task: t.id, p_status: '해당없음', p_memo: memo, p_report: false }, '해당없음으로 저장했습니다')}>해당없음으로 저장</button><button type="button" className="btn ghost" onClick={close}>취소</button></div>
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
        <label htmlFor="ne-s">출시일 (초도생산일 = 1차 생산일) <span className="np-opt">선택</span></label>
        <input id="ne-s" type="date" value={f.launch} disabled={p.checks[0] && p.checks[0].status !== '대기'} onChange={e => s({ launch: e.target.value })} />
        {p.checks[0] && p.checks[0].status !== '대기' && <p className="note">1차 점검이 끝나 출시일은 바꿀 수 없습니다 (확인 취소 후 변경)</p>}
        <label htmlFor="ne-p">품목·규격</label><input id="ne-p" value={f.spec} onChange={e => s({ spec: e.target.value })} maxLength={100} />
        <label htmlFor="ne-m">메모</label><textarea id="ne-m" rows={3} value={f.memo} onChange={e => s({ memo: e.target.value })} />
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className="btn np-btn" disabled={busy} onClick={async () => {
          const c1 = p.checks[0]
          const dChanged = c1 && c1.status === '대기' && (f.launch || null) !== (p.launch ? String(p.launch).slice(0, 10) : null)
          if (dChanged) {
            const r = await npRun('np_set_date', { p_task: c1.id, p_date: f.launch || null })
            if (r.error) return setErr(r.error)
          }
          go('np_update', { p_id: p.id, p_name: f.name, p_customer: f.customer, p_spec: f.spec, p_memo: f.memo, p_sample: String(p.sample_date).slice(0, 10) }, '내용을 고쳤습니다')
        }}>저장</button><button type="button" className="btn ghost" onClick={close}>취소</button></div>
      </>
    )
  } else if (sheet.kind === 'owner') {
    head = '담당 바꾸기'
    body = (
      <>
        <label htmlFor="no-o">새 담당자</label>
        <OwnerSelect id="no-o" value={owner} onChange={setOwner} />
        {needTeam(db, owner) && (
          <>
            <label>담당 팀 <span className="np-opt">파트장이 담당이면 어느 팀 일인지 고르기</span></label>
            <TeamPick value={team} onChange={setTeam} />
          </>
        )}
        <label className="np-ck"><input type="checkbox" checked={moveT} onChange={e => setMoveT(e.target.checked)} /> 남은 할 일도 새 담당자에게 넘기기 <small>(다른 사람에게 따로 맡긴 할 일은 그대로)</small></label>
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className="btn np-btn" disabled={busy || !owner || (needTeam(db, owner) && !team) || (owner === p.owner && (!needTeam(db, owner) || team === p.team))} onClick={() => go('np_set_owner', { p_id: p.id, p_owner: owner, p_move: moveT, p_team: needTeam(db, owner) ? team : null }, owner === p.owner ? '담당 팀을 정했습니다' : '담당을 바꿨습니다')}>바꾸기</button><button type="button" className="btn ghost" onClick={close}>취소</button></div>
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
        <label className="np-ck"><input type="checkbox" checked={needM} onChange={e => setNeedM(e.target.checked)} /> 메모 필요 <small>(끄면 [완료]를 누르는 즉시 완료)</small></label>
        <p className="note">사후업무 맨 끝에 붙습니다</p>
        {err && <p className="nf-err">{err}</p>}
        <div className="s-acts"><button type="button" className="btn np-btn" disabled={busy || !title.trim()} onClick={() => go('np_task_add', { p_id: p.id, p_title: title, p_user: who || null, p_need_memo: needM }, '사후업무를 추가했습니다')}>추가</button><button type="button" className="btn ghost" onClick={close}>취소</button></div>
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
  const [rows, setRows] = useState(() => db.npTemplates.map(t => ({ id: t.id, t: t.title, m: !!t.need_memo })))
  const [ask, setAsk] = useState(false)
  const [nt, setNt] = useState('')
  const [err, setErr] = useState('')
  const base = db.npTemplates.map(t => ({ id: t.id, t: t.title, m: !!t.need_memo }))
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
  // 삭제한 업무가 진행 중 신제품에서 함께 빠지는 규모 (저장 전에 한 번 더 확인)
  const goneIds = base.filter(b => !rows.some(r => r.id === b.id)).map(b => b.id)
  const goneTasks = db.np.filter(p => p.status === '진행중').flatMap(p => p.steps.filter(t => goneIds.includes(t.tpl_id)).map(t => ({ ...t, pname: p.name })))
  const gone = { tasks: goneTasks, prods: new Set(goneTasks.map(t => t.product_id)).size, done: goneTasks.filter(t => t.status !== '대기').length, names: base.filter(b => goneIds.includes(b.id)).map(b => b.t) }
  const saveTpl = async sure => {
    const list = rows.map(r => ({ id: r.id || null, title: r.t.trim(), need_memo: r.m })).filter(r => r.title)
    if (!list.length) return setErr('하나 이상 넣어주세요.')
    if (new Set(list.map(r => r.title)).size !== list.length) return setErr('같은 이름이 두 번 들어 있습니다.')
    if (!sure && gone.tasks.length) return setAsk(true)
    setBusy(true); setErr(''); setAsk(false)
    const { error } = await supabase.rpc('np_tpl_set3', { p_items: list })
    setBusy(false)
    if (error) return setErr(errText(error) + (/np_tpl_set3|function/i.test(errText(error)) ? ' (upgrade25.sql을 실행했는지 확인해주세요)' : ''))
    await reload(); toast('기본 사후업무를 저장했습니다 · 진행 중인 신제품에 바로 반영됐습니다')
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
          <p className="note" style={{ marginTop: 0 }}>순서대로 신제품 등록 화면에 미리 체크되어 나옵니다 · <b>✎ 메모 필요</b>를 켠 업무는 처리할 때 메모를 꼭 쓰고, 끈 업무는 [완료]를 누르는 즉시 완료됩니다(5초 안에 되돌리기 가능) · 해당없음과 생산 점검은 항상 메모를 씁니다 · 저장하면 진행 중인 신제품에 바로 반영됩니다: <b>추가</b>는 순서 자리에 대기로 들어가고, <b>삭제</b>는 처리 여부와 상관없이 기록까지 빠지고, 이름·순서·메모 필요(남은 업무)도 맞춰집니다 · 완료·중단된 신제품은 그대로</p>
          {rows.map((r, i) => (
            <div key={i} className="np-tr">
              <span className="np-no">{i + 1}</span>
              <input value={r.t} onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, t: e.target.value } : x)))} maxLength={100} aria-label={`${i + 1}번 사후업무`} />
              <label className={'np-mck' + (r.m ? ' on' : '')} title="메모 필요: 처리할 때 메모를 꼭 써야 함 · 끄면 [완료]를 누르는 즉시 완료"><input type="checkbox" checked={r.m} onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, m: e.target.checked } : x)))} /> ✎ 메모 필요</label>
              <span className="mv">
                <button type="button" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" aria-label="아래로" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" aria-label="빼기" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
              </span>
            </div>
          ))}
          <form className="np-add" onSubmit={e => { e.preventDefault(); if (nt.trim()) { setRows([...rows, { id: null, t: nt.trim(), m: false }]); setNt('') } }}>
            <input value={nt} onChange={e => setNt(e.target.value)} placeholder="+ 사후업무 추가 (Enter)" maxLength={100} aria-label="사후업무 추가" />
          </form>
          {err && <p className="nf-err">{err}</p>}
          {ask && dirty && gone.tasks.length > 0 && (
            <div className="np-ask">
              <b>진행 중 신제품 {gone.prods}개에서 {gone.names.map(n => `'${n}'`).join(', ')}이(가) 빠집니다{gone.done ? ` (처리한 기록 ${gone.done}건 포함)` : ''}</b>
              <span>빠진 업무와 그 기록은 되살릴 수 없습니다 · 완료·중단된 신제품은 그대로입니다</span>
              <div className="np-popa"><button type="button" className="btn warn" disabled={busy} onClick={() => saveTpl(true)}>그래도 저장</button><button type="button" className="btn ghost" onClick={() => setAsk(false)}>취소</button></div>
            </div>
          )}
          <div className="np-tpl-acts">
            <button type="button" className="btn" disabled={busy || !dirty} onClick={() => saveTpl(false)}>{busy ? '저장 중…' : '기본 사후업무 저장'}</button>
            {dirty && <button type="button" className="btn ghost" onClick={() => { setRows(base); setErr('') }}>되돌리기</button>}
            {dirty && <span className="np-dirty">저장하지 않은 변경이 있습니다</span>}
          </div>
        </div>
      )}
    </>
  )
}
