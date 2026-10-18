import { useState } from 'react'
import { useApp, Person, ICON } from './ctx.jsx'
import { dd, md, norm, parse } from './util.js'
import OrgTree from './Org.jsx'
import { NewChatBlock } from './Mine.jsx'

function matches(c, q) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = norm([c.title, c.itemsText, c.description, c.reason, c.created_by_dept].join(' '))
  return words.every(w => hay.includes(norm(w)))
}

// PC 넓은 화면의 왼쪽: 계정 · 메뉴 · 검색 · 조직도 · 제품 목록
export default function Sidebar({ tab, setTab, sel, onSelect, myOpenN }) {
  const { db, me, viewer, tOf, isLate, unread, mentionsMe } = useApp()
  const [q, setQ] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [orgOpen, setOrgOpen] = useState(false)
  const nav = viewer
    ? [['late', '지연 현황', 'late'], ['timeline', '전체 일정 · 달력', 'timeline']]
    : [['mine', '내 할 일', 'mine'], ['timeline', '전체 일정 · 달력', 'timeline'], ['new', '변경 등록', 'new']]
  const searching = q.trim().length > 0
  const live = db.changes.filter(c => c.status === '진행중' && matches(c, q)).sort((a, b) => parse(a.target_date) - parse(b.target_date))
  const done = db.changes.filter(c => c.status === '종결' && matches(c, q)).sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)))

  const item = c => {
    const ts = tOf(c.id)
    const dn = ts.filter(t => t.status !== '대기').length
    const lt = ts.filter(isLate).length
    const mineN = ts.filter(t => t.department === me.department && t.status === '대기').length
    const u = unread(c.id)
    const closed = c.status === '종결'
    const stopped = closed && c.close_type === '중단'
    const pct = ts.length ? Math.round((dn / ts.length) * 100) : 0
    const n = dd(c.target_date)
    return (
      <button type="button" key={c.id} className={'si' + (tab === 'product' && sel === c.id ? ' on' : '') + (closed ? ' closed' : '')} onClick={() => onSelect(c.id)}>
        <span className="si-t">{c.title}</span>
        <span className="si-m">
          <b className={!closed && n <= 7 ? 'soon' : ''}>{closed ? (stopped ? '중단 종결' : '종결') : n >= 0 ? 'D-' + n : 'D+' + -n}</b> · 전환 {md(c.target_date)}
          {u.length > 0 && <span className="ub">{u.some(mentionsMe) ? '@' : ''}{u.length}</span>}
        </span>
        <span className="si-bar"><i style={{ width: pct + '%' }} /></span>
        <span className="si-s">
          {dn}/{ts.length} 처리
          {lt > 0 && <> · <span className="late">지연 {lt}</span></>}
          {mineN > 0 && !closed && !viewer && <> · <span className="mine">우리 {mineN}</span></>}
        </span>
      </button>
    )
  }

  return (
    <aside className="sidebar" aria-label="제품 목록">
      <div className="sd-top">
        <div className="brand">푸르온 변경점 관리</div>
        <button type="button" className={'me-chip' + (tab === 'settings' ? ' on' : '')} onClick={() => setTab('settings')} aria-label="내 정보">
          <Person id={me.id} />
          {viewer && <small className="ro-t">보기 전용</small>}
          <span className="gear">{ICON.settings}</span>
        </button>
      </div>
      <nav className="sd-nav">
        {nav.map(([k, label, ic]) => (
          <button key={k} type="button" className={'sn' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            {ICON[ic]}<span>{label}</span>
            {k === 'mine' && myOpenN > 0 && <span className="n">{myOpenN}</span>}
          </button>
        ))}
      </nav>
      <div className="search sd-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input type="search" placeholder="제품 검색 (종결 포함)" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" aria-label="제품 검색" />
      </div>
      <div className="sd-list">
        <button type="button" className="sd-h tog" aria-expanded={orgOpen} onClick={() => setOrgOpen(!orgOpen)}>
          {orgOpen ? '▾' : '▸'} 조직도 <b>{db.profiles.length}명</b>
        </button>
        {orgOpen && <OrgTree />}
        <div className="sd-h">진행 중 <b>{live.length}</b></div>
        {live.length ? live.map(item) : <p className="hint" style={{ padding: '6px 10px' }}>{searching ? '맞는 제품이 없습니다' : '진행 중인 변경이 없습니다'}</p>}
        <button type="button" className="sd-h tog" onClick={() => setShowClosed(!showClosed)}>
          {showClosed || searching ? '▾' : '▸'} 종결 <b>{done.length}</b>
        </button>
        {(showClosed || searching) && done.map(item)}
      </div>
    </aside>
  )
}

// 오른쪽 대화칸: 제품을 고르기 전
export function DockEmpty() {
  return (
    <div className="chat docked dock-empty">
      <div className="ch-h"><div><span className="s-tag">제품 대화</span><b>왼쪽 목록에서 제품을 고르면<br />그 제품의 대화가 여기에 뜹니다</b></div></div>
      <div className="ch-list"><NewChatBlock emptyText="안 읽은 대화가 없습니다." /></div>
    </div>
  )
}
