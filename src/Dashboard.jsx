import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, ORDER, VIEWER } from './supabase.js'
import { useAppData } from './data.js'
import { Ctx, Person, ICON, useWidth, WIDE, useApp as useAppCtx } from './ctx.jsx'
import { dd, iso, todayMid, errText } from './util.js'
import { MineTab, LateTab, NewChatBlock } from './Mine.jsx'
import TimelineTab, { LateBlock, Calendar, ProductCard } from './Timeline.jsx'
import Sidebar, { DockEmpty } from './Sidebar.jsx'
import Sheet from './Sheets.jsx'
import NewChange, { emptyForm } from './NewChange.jsx'
import Chat from './Chat.jsx'
import Report from './Report.jsx'
import Settings from './Settings.jsx'

export default function Dashboard({ session }) {
  const uid = session.user.id
  const { db, err, reload, markReadLocal } = useAppData(uid)
  const [tab, setTab] = useState(null)
  const [sheet, setSheet] = useState(null)       // {kind:'task', tid} | {kind:'target'|'stop'|'resume'|'assign', cid}
  const [chatCid, setChatCid] = useState(null)
  const [reportCid, setReportCid] = useState(null)
  const [toastMsg, setToastMsg] = useState('')
  const toastT = useRef(null)
  const t0 = todayMid()
  const [ui, setUi] = useState({
    view: 'timeline', q: '', calMonth: iso(new Date(t0.getFullYear(), t0.getMonth(), 1)),
    calMine: true, calSel: iso(t0), open: {}, showClosed: false,
  })
  const [nf, setNf] = useState(null)
  const [sel, setSel] = useState(null)          // PC 넓은 화면에서 고른 제품
  const wide = useWidth() >= WIDE

  const me = db && db.people[uid]
  const viewer = !!me && me.department === VIEWER

  useEffect(() => {
    if (me && tab === null) setTab(viewer ? 'late' : 'mine')
  }, [me, viewer, tab])
  // 부서를 임원↔다른 부서로 바꾼 경우 맞는 탭으로
  useEffect(() => {
    if (!me || tab === null) return
    if (viewer && (tab === 'mine' || tab === 'new')) setTab('late')
    if (!wide && tab === 'product') { setTab('timeline'); if (sel) setUi(u => ({ ...u, open: { ...u.open, [sel]: true } })) }
    if (!viewer && tab === 'late') setTab('mine')
    if (viewer) setUi(u => (u.calMine ? { ...u, calMine: false } : u))
  }, [viewer, me, tab, wide, sel])

  const toast = useCallback(m => {
    setToastMsg(m)
    clearTimeout(toastT.current)
    toastT.current = setTimeout(() => setToastMsg(''), 2600)
  }, [])

  const app = useMemo(() => {
    if (!db || !me) return null
    const C = id => db.changeMap[id]
    const tOf = cid => (db.changeMap[cid] ? db.changeMap[cid].tasks : [])
    const isLate = t => t.status === '대기' && C(t.change_id) && C(t.change_id).status === '진행중' && dd(t.due_date) < 0
    const myRead = cid => db.reads[uid + '|' + cid] || 0
    const unread = cid => db.messages.filter(m => m.change_id === cid && m.id > myRead(cid) && m.user_id !== uid && !m.deleted)
    const mentionsMe = m => (m.mention_users || []).includes(uid) || (m.mention_depts || []).includes(me.department)
    const unreadCnt = m => db.profiles.filter(p => p.id !== m.user_id && (db.reads[p.id + '|' + m.change_id] || 0) < m.id).length
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
      db, me, uid, viewer, wide, ui, setUi, C, tOf, isLate, unread, mentionsMe, unreadCnt, run, reload, toast,
      sheet, setSheet,
      openTask: tid => setSheet({ kind: 'task', tid }),
      openSheet: (kind, cid) => setSheet({ kind, cid }),
      openChat: cid => { if (wide) return selectProduct(cid); setSheet(null); setChatCid(cid) },
      selectProduct,
      openReport: cid => setReportCid(cid),
      goChange, markReadLocal,
    }
  }, [db, me, uid, viewer, wide, ui, sheet, reload, toast, markReadLocal])

  if (err && !db) return <Fail msg={'불러오지 못했습니다: ' + err} />
  if (!db) return <div className="auth"><div className="auth-card"><p className="muted">불러오는 중…</p></div></div>
  if (!me) return <Fail msg="프로필이 없습니다. 가입이 제대로 끝나지 않았을 수 있습니다. 로그아웃 후 다시 가입하거나 관리자에게 문의해주세요." />
  if (!app || !tab) return null

  const myOpenN = db.tasks.filter(t => t.department === me.department && t.status === '대기' && app.C(t.change_id) && app.C(t.change_id).status === '진행중').length
  const tabs = viewer
    ? [['late', '지연 현황'], ['timeline', '타임라인']]
    : [['mine', '내 할 일'], ['timeline', '타임라인'], ['new', '변경 등록']]
  const title = { mine: '내 할 일', late: '지연 현황', timeline: wide ? '전체 일정 · 달력' : '타임라인', new: '변경 등록', settings: '내 정보', product: '' }[tab]

  const content = (
    <>
      {viewer && tab !== 'settings' && tab !== 'product' && (
        <div className="ro"><b>임원 · 보기 전용</b><span>모든 일정과 이력을 볼 수 있고, 처리·수정 버튼은 없습니다 (대화는 쓸 수 있음)</span></div>
      )}
      {!wide && (tab === 'mine' || tab === 'late') && <NewChatBlock />}
      {tab === 'mine' && <MineTab />}
      {tab === 'late' && <LateTab />}
      {tab === 'timeline' && (wide ? <Overview /> : <TimelineTab />)}
      {tab === 'product' && (sel && db.changeMap[sel] ? <ProductCard c={db.changeMap[sel]} forceOpen /> : <div className="card empty">왼쪽 목록에서 제품을 골라주세요.</div>)}
      {tab === 'new' && !viewer && (
        <NewChange nf={nf || emptyForm(db)} setNf={setNf} onDone={cid => { setNf(null); app.goChange(cid) }} />
      )}
      {tab === 'settings' && <Settings />}
    </>
  )
  const overlays = (
    <>
      {sheet && <Sheet key={sheet.kind + (sheet.tid || sheet.cid || '')} />}
      {!wide && chatCid && db.changeMap[chatCid] && <Chat cid={chatCid} onClose={() => setChatCid(null)} />}
      {reportCid && db.changeMap[reportCid] && <Report cid={reportCid} onClose={() => setReportCid(null)} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      {err && <div className="netbar">연결이 불안정합니다. 잠시 후 자동으로 다시 시도합니다.</div>}
    </>
  )

  // PC 넓은 화면: 왼쪽 목록 · 가운데 작업 · 오른쪽 대화
  if (wide) {
    return (
      <Ctx.Provider value={app}>
        <div className="wide-wrap">
          <Sidebar tab={tab} setTab={k => { setTab(k); setSheet(null) }} sel={sel} onSelect={app.selectProduct} myOpenN={myOpenN} />
          <div className="wide-main">
            <div className="wide-in">
              {tab !== 'product' && <h1 className="page-t wide-t">{title}</h1>}
              {content}
            </div>
          </div>
          {tab === 'product' && sel && db.changeMap[sel] ? <Chat key={sel} cid={sel} docked onClose={() => {}} /> : <DockEmpty />}
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
            <button type="button" className="org-btn" onClick={() => setSheet({ kind: 'org' })} aria-label="조직도">{ICON.org}<span>조직도</span></button>
            <button type="button" className={'me-chip' + (tab === 'settings' ? ' on' : '')} onClick={() => setTab(tab === 'settings' ? (viewer ? 'late' : 'mine') : 'settings')} aria-label="내 정보">
              <Person id={uid} />
              {viewer && <small className="ro-t">보기 전용</small>}
              <span className="gear">{ICON.settings}</span>
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="화면 전환">
          <div className="tabs-in">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" className={'tab' + (tab === k ? ' on' : '')} onClick={() => { setTab(k); setSheet(null); window.scrollTo(0, 0) }}>
                {ICON[k]}<span>{label}</span>
                {k === 'mine' && myOpenN > 0 && <span className="n">{myOpenN}</span>}
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

// 넓은 화면의 '전체 일정 · 달력': 지연 목록 + 달력
function Overview() {
  const app = useAppCtx()
  const live = app.db.changes.filter(c => c.status === '진행중')
  return (
    <>
      <LateBlock />
      <div className="sec-t"><h2>달력</h2></div>
      <Calendar list={live} searching={false} />
    </>
  )
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

