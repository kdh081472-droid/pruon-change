import { useApp, Person } from './ctx.jsx'
import { DBadge } from './Timeline.jsx'
import { md, parse, snip, stamp } from './util.js'

/* ---------- 내 할 일 (제품별, 전환일이 가까운 순) · 처리한 일 ---------- */
export function MineTab() {
  const { db, me, C, isLate, overdue, openTask, goChange, ui, setUi } = useApp()
  const list = db.tasks.filter(t => t.department === me.department && t.status === '대기' && C(t.change_id) && C(t.change_id).status === '진행중')
  const done = db.tasks.filter(t => t.department === me.department && t.status !== '대기' && C(t.change_id))
  const late = list.filter(isLate).length
  const view = ui.mineView || 'todo'
  const head = (
    <>
      <div className="seg mine-seg" role="tablist">
        <button type="button" role="tab" className={view === 'todo' ? 'on' : ''} onClick={() => setUi(u => ({ ...u, mineView: 'todo' }))}>처리할 일 {list.length}</button>
        <button type="button" role="tab" className={view === 'done' ? 'on' : ''} onClick={() => setUi(u => ({ ...u, mineView: 'done' }))}>처리한 일 {done.length}</button>
      </div>
      {late > 0 && view === 'todo' && <div className="late-band">전환일이 지난 할 일 {late}건 — 바로 처리해주세요</div>}
    </>
  )
  if (view === 'done') {
    if (!done.length) return <>{head}<div className="card empty">아직 {me.department} 부서가 처리한 일이 없습니다.</div></>
    const by = {}
    done.forEach(t => { (by[t.change_id] = by[t.change_id] || []).push(t) })
    const cids = Object.keys(by).sort((a, b) => {
      const ca = C(a), cb = C(b)
      return (ca.status === cb.status ? 0 : ca.status === '진행중' ? -1 : 1) || parse(cb.target_date) - parse(ca.target_date)
    })
    return (
      <>
        {head}
        <p className="hint" style={{ margin: '0 4px 10px' }}>눌러서 확인 메모·처리 이력을 보고, 잘못 처리한 건은 <b>확인 취소</b>할 수 있습니다.</p>
        {cids.map(cid => {
          const c = C(cid)
          return (
            <div className="card done-card" key={cid}>
              <button type="button" className="mg-h" onClick={() => goChange(cid)}><span className="t">{c.title}</span><span className="d">전환 {md(c.target_date)} <DBadge c={c} /></span></button>
              {by[cid].sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))).map(t => {
                const na = t.status === '해당없음'
                return (
                  <button type="button" key={t.id} className="m-i dn-i" onClick={() => openTask(t.id)}>
                    <span className={'cal ok' + (na ? ' na' : '')}><b>{na ? '–' : '✓'}</b><span>{na ? '해당없음' : '완료'}</span></span>
                    <span>
                      <span className="tt">{t.title}</span>
                      <span className="memo-l">“{t.memo}”</span>
                      <span className="when"><Person id={t.done_by} /> · {stamp(t.done_at)}</span>
                    </span>
                    <span className="arr">›</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </>
    )
  }
  if (!list.length) return <>{head}<div className="card empty">지금 {me.department} 부서가 처리할 일이 없습니다.</div></>
  const by = {}
  list.forEach(t => { (by[t.change_id] = by[t.change_id] || []).push(t) })
  const cids = Object.keys(by).sort((a, b) => parse(C(a).target_date) - parse(C(b).target_date))
  return (
    <>
      {head}
      {cids.map(cid => {
        const c = C(cid), od = overdue(c)
        return (
          <div className={'card mg' + (od ? ' od' : '')} key={cid}>
            <button type="button" className="mg-h" onClick={() => goChange(cid)}><span className="t">{c.title}</span><span className="d">전환 {md(c.target_date)} <DBadge c={c} /></span></button>
            {od && <p className="mg-warn">전환일이 지났습니다. 남은 할 일을 바로 처리해주세요.</p>}
            {by[cid].map(t => (
              <button type="button" key={t.id} className={'t2' + (od ? ' late' : '')} onClick={() => openTask(t.id)}>
                <span className={'tc2 ' + (od ? 'late' : 'wait')}>{od ? '전환일 지남' : '대기'}</span>
                <span className="t2-tx"><span className="t2-t">{t.is_extra && <span className="asg">배정</span>}{t.title}</span></span>
                <span className="arr">›</span>
              </button>
            ))}
          </div>
        )
      })}
    </>
  )
}

/* ---------- 새 대화 (안 읽은 글이 있는 제품) ---------- */
export function NewChatBlock({ emptyText }) {
  const { db, me, unread, mentionsMe, openChat } = useApp()
  const rows = db.changes.map(c => ({ c, u: unread(c.id) })).filter(x => x.u.length)
  if (!rows.length) return emptyText ? <div className="empty">{emptyText}</div> : null
  return (
    <div className="card nc">
      <div className="m-h"><span className="t">새 대화</span><span className="d">안 읽은 글이 있는 제품</span></div>
      {rows.map(({ c, u }) => {
        const last = u[u.length - 1]
        return (
          <button type="button" key={c.id} className="m-i" onClick={() => openChat(c.id)}>
            <span className="ub big">{u.length}</span>
            <span>
              <span className="tt">{c.title}{u.some(mentionsMe) && <> <span className="at me">@{me.name}</span></>}</span>
              <span className="when"><Person id={last.user_id} /> {snip(last.body, 34)}</span>
            </span>
            <span className="arr">›</span>
          </button>
        )
      })}
    </div>
  )
}
