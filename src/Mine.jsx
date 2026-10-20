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
      <div className="stats two">
        <div className="stat"><div className="k">남은 할 일</div><div className="v">{list.length}</div></div>
        <div className={'stat' + (late ? ' alert' : '')}><div className="k">전환일 지남</div><div className="v">{late}</div></div>
      </div>
      <div className="seg mine-seg" role="tablist">
        <button type="button" role="tab" className={view === 'todo' ? 'on' : ''} onClick={() => setUi(u => ({ ...u, mineView: 'todo' }))}>할 일 {list.length}</button>
        <button type="button" role="tab" className={view === 'done' ? 'on' : ''} onClick={() => setUi(u => ({ ...u, mineView: 'done' }))}>처리한 일 {done.length}</button>
      </div>
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
            {by[cid].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map(t => (
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

/* ---------- 진행 현황 (보기 전용 부서 첫 화면) ---------- */
export function StatusTab() {
  const { db, tOf, overdue, goChange } = useApp()
  const live = db.changes.filter(c => c.status === '진행중').sort((a, b) => parse(a.target_date) - parse(b.target_date))
  const odN = live.filter(overdue).length
  const closedN = db.changes.filter(c => c.status === '종결').length
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="k">진행 중 변경</div><div className="v">{live.length}</div></div>
        <div className={'stat' + (odN ? ' alert' : '')}><div className="k">전환일 지남</div><div className="v">{odN}</div></div>
        <div className="stat"><div className="k">종결</div><div className="v">{closedN}</div></div>
      </div>
      {!live.length ? <div className="card empty">진행 중인 변경이 없습니다.</div> : (
        <div className="sgrid2">
          {live.map(c => {
            const ts = tOf(c.id), left = ts.filter(t => t.status === '대기'), od = overdue(c)
            const pct = ts.length ? Math.round(((ts.length - left.length) / ts.length) * 100) : 0
            const rem = {}
            left.forEach(t => { rem[t.department] = (rem[t.department] || 0) + 1 })
            return (
              <button type="button" key={c.id} className={'card sc2' + (od ? ' od' : '')} onClick={() => goChange(c.id)}>
                <span className="sc2-h"><b>{c.title}</b><DBadge c={c} /></span>
                <span className="sc2-m">전환 {md(c.target_date)} · {ts.length - left.length}/{ts.length} 처리 ({pct}%)</span>
                <span className={'bar2' + (od ? ' late' : '')}><i style={{ width: pct + '%' }} /></span>
                <span className="sc2-m">{left.length ? '아직 안 끝난 부서' : '모든 부서 처리 완료'}</span>
                {left.length > 0 && <span className="chips2">{Object.entries(rem).map(([d, n]) => <span key={d} className={'dc2' + (od ? ' late' : '')}>{d} {n}</span>)}</span>}
              </button>
            )
          })}
        </div>
      )}
      {closedN > 0 && <p className="hint" style={{ margin: '10px 4px 0' }}>종결된 변경 {closedN}건과 결과 보고서는 타임라인에서 검색하거나 "종결된 변경 보기"로 볼 수 있습니다.</p>}
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
