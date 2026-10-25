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
export default function Sidebar({ tab, setTab, sel, onSelect, myOpenN, isAdmin, onAdmin }) {
  const { db, me, viewer, tOf, overdue, unread, mentionsMe, ui, setUi } = useApp()
  const [q, setQ] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [orgOpen, setOrgOpen] = useState(false)
  // 메뉴: 내 할 일 / 전체 일정(달력·요약) / 변경 등록  — 휴대폰 '전체 일정' 탭과 같은 이름
  const navTop = viewer ? [] : [['mine', '내 할 일', 'mine']]
  const navAll = [['timeline', '달력', 'timeline'], ['summary', '요약', 'table']]
  const navEnd = viewer ? [] : [['new', '변경 등록', 'new']]
  const slim = tab === 'summary' && !ui.sumList          // 요약 화면: 표를 넓게 보도록 제품 목록 접기
  const onlyMine = !viewer && !!ui.onlyMine               // 우리 부서 남은 할 일이 있는 것만
  const searching = q.trim().length > 0
  const hasMine = c => tOf(c.id).some(t => t.department === me.department && t.status === '대기')
  const liveAll = db.changes.filter(c => c.status === '진행중' && matches(c, q))
  const mineN = liveAll.filter(hasMine).length
  const live = liveAll.filter(c => !onlyMine || hasMine(c)).sort((a, b) => parse(a.target_date) - parse(b.target_date))
  const done = db.changes.filter(c => c.status === '종결' && matches(c, q)).sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)))

  const item = c => {
    const ts = tOf(c.id)
    const dn = ts.filter(t => t.status !== '대기').length
    const od = overdue(c)
    const mineN = ts.filter(t => t.department === me.department && t.status === '대기').length
    const u = unread(c.id)
    const closed = c.status === '종결'
    const stopped = closed && c.close_type === '중단'
    const pct = ts.length ? Math.round((dn / ts.length) * 100) : 0
    const n = dd(c.target_date)
    return (
      <button type="button" key={c.id} className={'si' + (tab === 'product' && sel === c.id ? ' on' : '') + (closed ? ' closed' : '') + (od ? ' od' : '')} onClick={() => onSelect(c.id)}>
        <span className="si-t">{c.title}</span>
        <span className="si-m">
          <b className={od ? 'odb' : !closed && n <= 7 ? 'soon' : ''}>{closed ? (stopped ? '중단 종결' : '종결') : od ? '전환일 지남 D+' + -n : n >= 0 ? 'D-' + n : 'D+' + -n}</b> · 전환 {md(c.target_date)}
          {u.length > 0 && <span className="ub">{u.some(mentionsMe) ? '@' : ''}{u.length}</span>}
        </span>
        <span className={'si-bar' + (od ? ' late' : '')}><i style={{ width: pct + '%' }} /></span>
        <span className="si-s">
          {dn}/{ts.length} 처리
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
        <button type="button" className="sd-h tog sd-org" aria-expanded={orgOpen} onClick={() => setOrgOpen(!orgOpen)}>
          {orgOpen ? '▾' : '▸'} 조직도 <b>{db.profiles.length}명</b>
        </button>
        {orgOpen && <div className="sd-orgbox"><OrgTree /></div>}
      </div>
      <nav className="sd-nav">
        {[...navTop, null, ...navAll, ...navEnd].map(x => x === null ? <div key="g" className="sn-g">전체 일정</div> : (
          <button key={x[0]} type="button" className={'sn' + (navAll.some(n => n[0] === x[0]) ? ' sub' : '') + (tab === x[0] ? ' on' : '')} onClick={() => setTab(x[0])}>
            {ICON[x[2]]}<span>{x[1]}</span>
            {x[0] === 'mine' && myOpenN > 0 && <span className="n">{myOpenN}</span>}
          </button>
        ))}
      </nav>
      {slim ? (
        <button type="button" className="sd-expand" onClick={() => setUi(u => ({ ...u, sumList: true }))}>▸ 제품 목록 펼치기</button>
      ) : (<>
      {tab === 'summary' && <button type="button" className="sd-expand fold" onClick={() => setUi(u => ({ ...u, sumList: false }))}>◂ 제품 목록 접기 (표 넓게)</button>}
      <div className="search sd-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input type="search" placeholder="제품 검색 (종결 포함)" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" aria-label="제품 검색" />
      </div>
      {!viewer && (
        <div className="seg sd-only" role="tablist" aria-label="목록 보기">
          <button type="button" role="tab" className={onlyMine ? '' : 'on'} onClick={() => setUi(u => ({ ...u, onlyMine: false }))}>전체 {liveAll.length}</button>
          <button type="button" role="tab" className={onlyMine ? 'on' : ''} onClick={() => setUi(u => ({ ...u, onlyMine: true }))}>우리 부서 남은 것 {mineN}</button>
        </div>
      )}
      <div className="sd-list">
        <div className="sd-h">진행 중 <b>{live.length}</b>{onlyMine && ' · 우리 부서 할 일 있는 것'}</div>
        {live.length ? live.map(item) : <p className="hint" style={{ padding: '6px 10px' }}>{searching ? '맞는 제품이 없습니다' : onlyMine ? '우리 부서가 처리할 일이 없습니다' : '진행 중인 변경이 없습니다'}</p>}
        <button type="button" className="sd-h tog" onClick={() => setShowClosed(!showClosed)}>
          {showClosed || searching ? '▾' : '▸'} 종결 <b>{done.length}</b>
        </button>
        {(showClosed || searching) && done.map(item)}
      </div>
      </>)}
      {isAdmin && (
        <div className="sd-admin">
          <button type="button" className="admin-btn" onClick={onAdmin}>{ICON.key}관리자 모드</button>
        </div>
      )}
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
