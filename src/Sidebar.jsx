import { useState } from 'react'
import { useApp, Person, ICON } from './ctx.jsx'
import OrgTree from './Org.jsx'
import { NewChatBlock } from './Mine.jsx'

// PC 넓은 화면의 왼쪽: 계정 · 조직도 · 메뉴 (제품은 요약·달력·내 할 일에서 고름)
export default function Sidebar({ tab, setTab, sel, onSelect, myOpenN, chatN, isAdmin, onAdmin, helpOpen, onHelp }) {
  const { db, me, viewer } = useApp()
  const [orgOpen, setOrgOpen] = useState(false)
  // 메뉴: 내 할 일 / 전체 일정(달력·요약) / 변경 등록  — 휴대폰 '전체 일정' 탭과 같은 이름
  const navTop = viewer ? [] : [['mine', '내 할 일', 'mine']]
  const navAll = [['timeline', '달력', 'timeline'], ['summary', '요약', 'table']]
  const navEnd = [['chat', '대화', 'chat'], ...(viewer ? [] : [['new', '변경 등록', 'new']])]
  return (
    <aside className="sidebar" aria-label="메뉴">
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
          <button key={x[0]} type="button" className={'sn' + (navAll.some(n => n[0] === x[0]) ? ' sub' : '') + (tab === x[0] || ((tab === 'product' || tab === 'group') && x[0] === 'summary') ? ' on' : '')} onClick={() => setTab(x[0])}>
            {ICON[x[2]]}<span>{x[1]}</span>
            {x[0] === 'mine' && myOpenN > 0 && <span className="n">{myOpenN}</span>}
            {x[0] === 'chat' && chatN > 0 && <span className="n">{chatN > 999 ? '999+' : chatN}</span>}
          </button>
        ))}
      </nav>
      <div className="sd-help">
        <button type="button" className={'sn' + (helpOpen ? ' on' : '')} onClick={onHelp} aria-expanded={!!helpOpen}>{ICON.help}<span>사용법 물어보기</span></button>
      </div>
      <div className="sd-fill" />
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
      <div className="ch-h"><div><span className="s-tag">제품 대화</span><b>요약이나 내 할 일에서 제품을 고르면<br />그 제품의 대화가 여기에 뜹니다</b></div></div>
      <div className="ch-list"><NewChatBlock emptyText="안 읽은 대화가 없습니다." /></div>
    </div>
  )
}
