import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isViewDept } from './supabase.js'
import { useAppData } from './data.js'
import { Ctx, Person, ICON, useWidth, WIDE, useApp as useAppCtx } from './ctx.jsx'
import { dd, iso, todayMid, errText } from './util.js'
import { MineTab, NewChatBlock } from './Mine.jsx'
import TimelineTab, { Calendar, ProductCard } from './Timeline.jsx'
import Admin from './Admin.jsx'
import Summary from './Summary.jsx'
import HelpBot from './HelpBot.jsx'
import Sidebar, { DockEmpty } from './Sidebar.jsx'
import Sheet from './Sheets.jsx'
import NewChange, { emptyForm } from './NewChange.jsx'
import Chat from './Chat.jsx'
import Report from './Report.jsx'
import Settings from './Settings.jsx'
import GroupView, { GroupDock } from './GroupView.jsx'
import ChatTab, { RoomList } from './Rooms.jsx'

export default function Dashboard({ session }) {
  const uid = session.user.id
  const { db, err, reload, markReadLocal } = useAppData(uid)
  const [tab, setTab] = useState(null)
  const [sheet, setSheet] = useState(null)       // {kind:'task', tid} | {kind:'target'|'stop'|'resume'|'assign', cid}
  const [chatCid, setChatCid] = useState(null)   // 휴대폰 대화 창: 방(room)
  const [chatJump, setChatJump] = useState(null) // 휴대폰 대화 검색에서 고른 글 { q, mid, t }
  const [reportCid, setReportCid] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastT = useRef(null)
  const t0 = todayMid()
  const [ui, setUi] = useState({
    view: 'timeline', q: '', calMonth: iso(new Date(t0.getFullYear(), t0.getMonth(), 1)),
    calMine: true, calSel: iso(t0), open: {}, showClosed: false,
  })
  const [nf, setNf] = useState(null)
  const [sel, setSel] = useState(null)          // PC 넓은 화면에서 고른 제품
  const [selGroup, setSelGroup] = useState(null) // 고른 묶음 (품목별 관리)
  const wide = useWidth() >= WIDE
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminMode, setAdminMode] = useState(false)

  const me = db && db.people[uid]
  const viewer = !!me && (isViewDept(me.department) || !!me.left_at)
  // 관리자 여부는 본인만 확인 가능 (다른 사람 화면에는 표시 안 됨)
  useEffect(() => {
    if (!me) return
    supabase.rpc('my_is_admin').then(({ data }) => { setIsAdmin(!!data); if (!data) setAdminMode(false) })
  }, [me && me.department, me && me.left_at, db])
  // 마지막 접속 시각 기록: 앱을 열 때 + 앱 화면으로 돌아올 때 (서버에서 10분에 한 번만 저장)
  useEffect(() => {
    if (!me || me.left_at) return
    const touch = () => { if (document.visibilityState === 'visible') supabase.rpc('touch_seen').then(() => {}, () => {}) }
    touch()
    document.addEventListener('visibilitychange', touch)
    return () => document.removeEventListener('visibilitychange', touch)
  }, [me && me.id, me && me.left_at])
  // 퇴사 처리된 계정이면 로그아웃
  useEffect(() => { if (me && me.left_at) { const t = setTimeout(() => supabase.auth.signOut(), 2500); return () => clearTimeout(t) } }, [me && me.left_at])

  useEffect(() => {
    if (me && tab === null) setTab(viewer ? (wide ? 'summary' : 'timeline') : 'mine')
  }, [me, viewer, tab])
  // 부서를 임원↔다른 부서로 바꾼 경우 맞는 탭으로
  useEffect(() => {
    if (!me || tab === null) return
    if (viewer && (tab === 'mine' || tab === 'new' || tab === 'late')) setTab(wide ? 'summary' : 'timeline')
    if (!viewer && tab === 'late') setTab('mine')
    if (viewer) setUi(u => (u.calMine ? { ...u, calMine: false } : u))
  }, [viewer, me, tab, wide, sel])

  // 창 폭이 바뀌어도 보던 화면을 이어서 보여주기 (PC ↔ 휴대폰 화면)
  const prevWide = useRef(wide)
  useEffect(() => {
    if (prevWide.current === wide || !me || tab === null) { prevWide.current = wide; return }
    prevWide.current = wide
    if (!wide) {
      // PC → 좁은 화면: 제품 화면은 '제품별'에서 그 제품을 펼친 채로, PC 달력은 '달력'으로
      if (tab === 'product') {
        setTab('timeline')
        setUi(u => ({ ...u, view: 'timeline', q: '', open: sel ? { ...u.open, [sel]: true } : u.open }))
        if (sel) setTimeout(() => { const el = document.getElementById('p' + sel); el && el.scrollIntoView({ block: 'start' }) }, 80)
      } else if (tab === 'timeline') setUi(u => ({ ...u, view: 'calendar' }))
      else if (tab === 'summary') { setTab('timeline'); setUi(u => ({ ...u, view: 'summary' })) }
    } else if (tab === 'timeline' && ui.view === 'summary') {
      setTab('summary')
    } else if (tab === 'timeline' && ui.view !== 'calendar') {
      // 좁은 화면 '제품별' → PC: 펼친 제품이 있으면 그 제품 화면, 없으면 달력
      const openIds = Object.keys(ui.open).filter(k => ui.open[k] && db && db.changeMap[k])
      if (openIds.length) { setSel(openIds[openIds.length - 1]); setTab('product') }
    }
  }, [wide])

  // 브라우저 탭 제목에 안 읽은 대화 수: (3) 푸르온 변경점 관리
  const baseTitle = useRef(document.title || '푸르온 변경점 관리')
  useEffect(() => {
    if (!db || !uid) return
    const rd = room => db.reads[uid + '|' + room] || 0
    const n = db.messages.filter(m => m.user_id !== uid && !m.deleted && m.id > rd(m.room)).length
    document.title = (n > 0 ? '(' + (n > 999 ? '999+' : n) + ') ' : '') + baseTitle.current
  }, [db, uid])

  const toast = useCallback(m => {
    setToastMsg(m)
    clearTimeout(toastT.current)
    toastT.current = setTimeout(() => setToastMsg(''), 2600)
  }, [])

  const app = useMemo(() => {
    if (!db || !me) return null
    const C = id => db.changeMap[id]
    const tOf = cid => (db.changeMap[cid] ? db.changeMap[cid].tasks : [])
    // 전환일이 지났는데 아직 처리 안 된 할 일 (마감일 기능은 없음)
    const isLate = t => t.status === '대기' && C(t.change_id) && C(t.change_id).status === '진행중' && dd(C(t.change_id).target_date) < 0
    const overdue = c => !!c && c.status === '진행중' && dd(c.target_date) < 0 && c.tasks.some(t => t.status === '대기')
    // 방(room): 변경 id 또는 'g:'+묶음 id
    const myRead = room => db.reads[uid + '|' + room] || 0
    const unread = room => db.messages.filter(m => m.room === room && m.id > myRead(room) && m.user_id !== uid && !m.deleted)
    const mentionsMe = m => (m.mention_users || []).includes(uid) || (m.mention_depts || []).includes(me.department)
    const unreadCnt = m => db.profiles.filter(p => p.id !== m.user_id && (db.reads[p.id + '|' + m.room] || 0) < m.id).length
    // 서버 함수 실행 → 성공하면 다시 불러오기
    const run = async (fn, args, okMsg) => {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) return { error: errText(error) }
      await reload()
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(data) : okMsg)
      return { data }
    }
    const selectProduct = cid => {
      setSel(cid); setTab('product'); setSheet(null)
      setTimeout(() => { const el = document.querySelector('.wide-main'); el && el.scrollTo(0, 0) }, 0)
    }
    const goChange = cid => {
      if (wide) return selectProduct(cid)
      setTab('timeline')
      setUi(u => ({ ...u, view: 'timeline', q: '', open: { ...u.open, [cid]: true }, showClosed: u.showClosed || (C(cid) && C(cid).status === '종결') }))
      setTimeout(() => { const el = document.getElementById('p' + cid); el && el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 80)
    }
    return {
      db, me, uid, viewer, wide, ui, setUi, C, tOf, isLate, overdue, unread, isAdmin, setAdminMode, mentionsMe, unreadCnt, run, reload, toast,
      sheet, setSheet,
      openTask: tid => setSheet({ kind: 'task', tid }),
      openSheet: (kind, cid) => setSheet({ kind, cid }),
      // 대화 열기: PC는 제품 화면(묶음 방은 묶음 화면), 휴대폰은 대화 창
      openChat: (room, jump) => {
        const isG = String(room).startsWith('g:')
        if (wide) { if (isG) { setSelGroup(room.slice(2)); setTab('group'); setSheet(null); return } return selectProduct(room) }
        setSheet(null); setChatJump(jump || null); setChatCid(room)
      },
      // PC 대화 탭에서 그 방 열기
      goChat: room => { setUi(u => ({ ...u, chatRoom: room })); setTab('chat'); setSheet(null) },
      selectProduct,
      openReport: cid => setReportCid(cid),
      goChange, markReadLocal,
      goSummary: () => {
        setSheet(null)
        if (wide) setTab('summary'); else { setTab('timeline'); setUi(u => ({ ...u, view: 'summary' })) }
        setTimeout(() => { const el = document.querySelector('.wide-main'); el ? el.scrollTo(0, 0) : window.scrollTo(0, 0) }, 0)
      },
      goGroup: gid => {
        setSelGroup(gid); setTab('group'); setSheet(null); setChatCid(null)
        setTimeout(() => { const el = document.querySelector('.wide-main'); el ? el.scrollTo(0, 0) : window.scrollTo(0, 0) }, 0)
      },
    }
  }, [db, me, uid, viewer, wide, ui, sheet, reload, toast, markReadLocal, isAdmin])

  if (err && !db) return <Fail msg={'불러오지 못했습니다: ' + err} />
  if (!db) return <div className="auth"><div className="auth-card"><p className="muted">불러오는 중…</p></div></div>
  if (!me) return <Fail msg="프로필이 없습니다. 가입이 제대로 끝나지 않았을 수 있습니다. 로그아웃 후 다시 가입하거나 관리자에게 문의해주세요." />
  if (me.left_at) return <Fail msg="퇴사 처리된 계정입니다. 잠시 후 로그아웃됩니다." />
  if (!app || !tab) return null
  if (adminMode && isAdmin) return <Ctx.Provider value={app}><Admin onExit={() => setAdminMode(false)} />{toastMsg && <div className="toast" role="status">{toastMsg}</div>}</Ctx.Provider>

  const myOpenN = db.tasks.filter(t => t.department === me.department && t.status === '대기' && app.C(t.change_id) && app.C(t.change_id).status === '진행중').length
  const unreadAll = db.changes.reduce((n, c) => n + app.unread(c.id).length, 0) + db.groups.reduce((n, g) => n + app.unread('g:' + g.id).length, 0)
  const tabs = viewer
    ? [['timeline', '전체 일정'], ['chat', '대화']]
    : [['mine', '내 할 일'], ['timeline', '전체 일정'], ['chat', '대화'], ['new', '변경 등록']]
  const title = { chat: wide ? '' : '대화', mine: '내 할 일', timeline: wide ? '달력' : '전체 일정', summary: '요약', new: '변경 등록', settings: '내 정보', product: '', group: wide ? '' : '전체 일정' }[tab]

  const content = (
    <>
      {!wide && tab === 'mine' && <NewChatBlock />}
      {tab === 'mine' && <MineTab />}
      {tab === 'timeline' && (wide ? <Overview /> : <TimelineTab />)}
      {tab === 'summary' && wide && <Summary />}
      {tab === 'group' && <GroupView gid={selGroup} />}
      {tab === 'product' && (sel && db.changeMap[sel] ? <ProductCard c={db.changeMap[sel]} forceOpen /> : <div className="card empty">요약에서 제품을 골라주세요.</div>)}
      {tab === 'new' && !viewer && (
        <NewChange nf={nf || emptyForm(db)} setNf={setNf} onDone={(id, isGroup) => { setNf(null); isGroup ? app.goGroup(id) : app.goChange(id) }} />
      )}
      {tab === 'chat' && (wide ? <ChatTab /> : <RoomList sel={null} onPick={room => app.openChat(room)} onSearchPick={(room, mid, q) => app.openChat(room, { q, mid, t: Date.now() })} />)}
      {tab === 'settings' && <Settings />}
    </>
  )
  const overlays = (
    <>
      {sheet && <Sheet key={sheet.kind + (sheet.tid || sheet.cid || sheet.gid || (sheet.tids || []).join(''))} />}
      {!wide && chatCid && (String(chatCid).startsWith('g:') ? db.groupMap[chatCid.slice(2)] : db.changeMap[chatCid]) && (
        <Chat cid={chatCid} onClose={() => { setChatCid(null); setChatJump(null) }} searchQ={chatJump && chatJump.q} jumpTo={chatJump && chatJump.mid ? chatJump : null} onSearchClose={() => setChatJump(null)} />
      )}
      {reportCid && db.changeMap[reportCid] && <Report cid={reportCid} onClose={() => setReportCid(null)} />}
      {helpOpen && <HelpBot full={!wide} onClose={() => setHelpOpen(false)} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      {err && <div className="netbar">연결이 불안정합니다. 잠시 후 자동으로 다시 시도합니다.</div>}
    </>
  )

  // PC 넓은 화면: 왼쪽 메뉴 · 가운데 작업 · 오른쪽 대화 (달력·요약·등록·내 정보는 대화 칸 없이 넓게)
  const noDock = ['timeline', 'summary', 'new', 'settings', 'chat'].includes(tab)
  if (wide) {
    return (
      <Ctx.Provider value={app}>
        <div className={'wide-wrap' + (noDock ? ' no-dock' : '')}>
          <Sidebar tab={tab} setTab={k => { setTab(k); setSheet(null) }} sel={sel} onSelect={app.selectProduct} myOpenN={myOpenN} chatN={unreadAll} isAdmin={isAdmin} onAdmin={() => { setSheet(null); setAdminMode(true) }} helpOpen={helpOpen} onHelp={() => setHelpOpen(v => !v)} />
          <div className="wide-main">
            <div className={'wide-in' + (tab === 'timeline' || tab === 'summary' || tab === 'new' ? ' full' : '') + (tab === 'chat' ? ' full chat-in' : '')}>
              {tab !== 'product' && tab !== 'timeline' && tab !== 'group' && tab !== 'chat' && <h1 className="page-t wide-t">{title}</h1>}
              {content}
            </div>
          </div>
          {noDock ? null : tab === 'product' && sel && db.changeMap[sel] ? <Chat key={sel} cid={sel} docked onClose={() => {}} /> : tab === 'group' ? <GroupDock gid={selGroup} /> : <DockEmpty />}
        </div>
        {overlays}
      </Ctx.Provider>
    )
  }

  return (
    <Ctx.Provider value={app}>
      <div className="app">
        <div className="top">
          <div>
            <div className="brand">푸르온 변경점 관리</div>
            <h1 className="page-t">{title}</h1>
          </div>
          <div className="top-r">
            <button type="button" className="org-btn help-btn" onClick={() => setHelpOpen(true)} aria-label="사용법 물어보기">{ICON.help}</button>
            <button type="button" className="org-btn" onClick={() => setSheet({ kind: 'org' })} aria-label="조직도">{ICON.org}<span>조직도</span></button>
            <button type="button" className={'me-chip' + (tab === 'settings' ? ' on' : '')} onClick={() => setTab(tab === 'settings' ? (viewer ? 'timeline' : 'mine') : 'settings')} aria-label="내 정보">
              <Person id={uid} />
              {viewer && <small className="ro-t">보기 전용</small>}
              <span className="gear">{ICON.settings}</span>
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="화면 전환">
          <div className="tabs-in">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" className={'tab' + (tab === k || (k === 'timeline' && tab === 'group') ? ' on' : '')} onClick={() => { setTab(k); setSheet(null); window.scrollTo(0, 0) }}>
                {ICON[k]}<span>{label}</span>
                {k === 'mine' && myOpenN > 0 && <span className="n">{myOpenN}</span>}
                {k === 'chat' && unreadAll > 0 && <span className="n">{unreadAll}</span>}
              </button>
            ))}
          </div>
        </nav>
        <main>{content}</main>
      </div>
      {overlays}
    </Ctx.Provider>
  )
}

// 넓은 화면의 "전체 일정 › 달력": 두 달 달력 (전환일만)
function Overview() {
  const app = useAppCtx()
  return <Calendar list={app.db.changes} searching={false} title="달력" />
}

function Fail({ msg }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <p className="err">{msg}</p>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>로그아웃</button>
      </div>
    </div>
  )
}

