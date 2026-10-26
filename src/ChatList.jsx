import { useState } from 'react'
import { useApp, ICON } from './ctx.jsx'
import { dd, parse, snip, stamp } from './util.js'

// 휴대폰 '대화' 탭: 제품 목록 → 누르면 대화방
export default function ChatList() {
  const { db, unread, mentionsMe, openChat } = useApp()
  const [showClosed, setShowClosed] = useState(false)
  const lastOf = cid => {
    const ms = db.messages.filter(m => m.change_id === cid && !m.deleted)
    return ms.length ? ms[ms.length - 1] : null
  }
  const order = (a, b) => {
    const la = lastOf(a.id), lb = lastOf(b.id)
    if (la && lb) return lb.id - la.id
    if (la) return -1
    if (lb) return 1
    return parse(a.target_date) - parse(b.target_date)
  }
  const live = db.changes.filter(c => c.status === '진행중').sort(order)
  const closed = db.changes.filter(c => c.status === '종결').sort(order)

  const row = c => {
    const u = unread(c.id)
    const last = lastOf(c.id)
    const p = last && db.people[last.user_id]
    const isClosed = c.status === '종결'
    const n = dd(c.target_date)
    return (
      <button type="button" key={c.id} className={'cl-i' + (isClosed ? ' closed' : '')} onClick={() => openChat(c.id)}>
        <span className="cl-ic">{ICON.chat}</span>
        <span className="cl-b">
          <span className="cl-t">{c.group && <span className="g-chip g-in">{c.group.title.length > 12 ? c.group.title.slice(0, 12) + '…' : c.group.title}</span>}{c.title}</span>
          <span className="cl-m">{last ? <>{p ? p.name : '알 수 없음'}: {snip(last.body, 30)}</> : <span className="faint">아직 대화가 없습니다</span>}</span>
        </span>
        <span className="cl-r">
          <span className="cl-d">{last ? stamp(last.created_at).slice(0, 5) : ''}</span>
          {u.length > 0 ? <span className="ub">{u.some(mentionsMe) ? '@' : ''}{u.length}</span>
            : <span className="cl-s">{isClosed ? (c.close_type === '중단' ? '중단' : '종결') : n >= 0 ? 'D-' + n : 'D+' + -n}</span>}
        </span>
      </button>
    )
  }

  return (
    <>
      <div className="card cl">
        <div className="m-h"><span className="t">진행 중 제품</span><span className="d">{live.length}건</span></div>
        {live.length ? live.map(row) : <div className="empty" style={{ padding: 18 }}>진행 중인 변경이 없습니다.</div>}
      </div>
      {closed.length > 0 && (
        <>
          <button type="button" className="closed-t" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? '종결된 제품 숨기기' : `종결된 제품 ${closed.length}건 보기`}
          </button>
          {showClosed && <div className="card cl" style={{ marginTop: 12 }}>{closed.map(row)}</div>}
        </>
      )}
    </>
  )
}
