import { useState } from 'react'
import { useApp, Person } from './ctx.jsx'
import { rangeTxt } from './GroupView.jsx'
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
              <button type="button" className="mg-h" onClick={() => goChange(cid)}><span className="t">{c.group && <span className="g-chip g-in">{c.group.title.length > 12 ? c.group.title.slice(0, 12) + '…' : c.group.title}</span>}{c.title}</span><span className="d">전환 {md(c.target_date)} <DBadge c={c} /></span></button>
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
  const by = {}, byG = {}
  list.forEach(t => {
    const c = C(t.change_id)
    if (c.group) (byG[c.group.id] = byG[c.group.id] || []).push(t)
    else (by[t.change_id] = by[t.change_id] || []).push(t)
  })
  // 단품 변경과 묶음을 전환일이 가까운 순으로 함께
  const entries = [
    ...Object.keys(by).map(cid => ({ cid, d: C(cid).target_date })),
    ...Object.keys(byG).map(gid => ({ gid, d: byG[gid].map(t => C(t.change_id).target_date).sort()[0] })),
  ].sort((a, b) => parse(a.d) - parse(b.d))
  return (
    <>
      {head}
      {entries.map(({ cid, gid }) => {
        if (gid) return <GroupMine key={'g' + gid} gid={gid} ts={byG[gid]} />
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
              <span className="tt">{c.group && <span className="g-chip g-in">{c.group.title.length > 12 ? c.group.title.slice(0, 12) + '…' : c.group.title}</span>}{c.title}{u.some(mentionsMe) && <> <span className="at me">@{me.name}</span></>}</span>
              <span className="when"><Person id={last.user_id} /> {snip(last.body, 34)}</span>
            </span>
            <span className="arr">›</span>
          </button>
        )
      })}
    </div>
  )
}

/* ---------- 내 할 일 · 묶음: 같은 할 일끼리 모아서 품목을 골라 한 번에 처리 ---------- */
function GroupMine({ gid, ts }) {
  const { db, C, overdue, openTask, goGroup, setSheet, ui, setUi } = useApp()
  const g = db.groupMap[gid]
  const view = (ui.gView && ui.gView[gid]) || 'task'
  const setView = v => setUi(u => ({ ...u, gView: { ...(u.gView || {}), [gid]: v } }))
  const [open, setOpen] = useState(() => ({}))
  const [pick, setPick] = useState(() => ({}))          // { taskId: false } 체크 해제한 것만
  const ds = ts.map(t => C(t.change_id).target_date).sort()
  // 할 일 제목별로 묶음 (묶음의 할 일 세트 순서, 나중에 추가 배정된 건 뒤로)
  const order = (g.tasks || []).map(x => x.title)
  const titles = [...new Set(ts.map(t => t.title))].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b)
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib)
  })
  const kidsOf = title => ts.filter(t => t.title === title).sort((a, b) => C(a.change_id).kidNo - C(b.change_id).kidNo)
  const odAny = ts.some(t => overdue(C(t.change_id)))
  return (
    <div className={'card mg gm' + (odAny ? ' od' : '')}>
      <button type="button" className="mg-h" onClick={() => goGroup(gid)}>
        <span className="t"><span className="g-chip">묶음 · 품목 {g.kids.length}</span> {g.title}</span>
        <span className="d">전환 {rangeTxt(ds[0], ds[ds.length - 1])} · 우리 부서 남은 {ts.length}건</span>
      </button>
      <div className="gm-seg" role="tablist">
        <button type="button" role="tab" className={view === 'task' ? 'on' : ''} onClick={() => setView('task')}>할 일별로 보기</button>
        <button type="button" role="tab" className={view === 'item' ? 'on' : ''} onClick={() => setView('item')}>품목별로 보기</button>
      </div>
      {view === 'task' ? titles.map((title, i) => {
        const xs = kidsOf(title)
        const isOpen = open[title] !== undefined ? open[title] : i === 0
        const sel = xs.filter(t => pick[t.id] !== false)
        const late = xs.some(t => overdue(C(t.change_id)))
        return (
          <div key={title} className={'gm-t' + (isOpen ? ' open' : '') + (late ? ' late' : '')}>
            <button type="button" className="gm-th" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [title]: !isOpen })}>
              <span className="tno">{i + 1}</span><b>{title}</b><span className={'tc2 ' + (late ? 'late' : 'wait')}>{xs.length}개 품목 남음</span><span className="sp" /><span className="gm-c">{isOpen ? '접기 ▴' : '펼치기 ▾'}</span>
            </button>
            {isOpen && (
              <div className="gm-b">
                <div className="gm-all"><label><input type="checkbox" checked={sel.length === xs.length} onChange={e => setPick({ ...pick, ...Object.fromEntries(xs.map(t => [t.id, e.target.checked])) })} /> 모두 선택</label></div>
                <div className="gm-items">
                  {xs.map(t => {
                    const c = C(t.change_id), on = pick[t.id] !== false
                    return (
                      <span key={t.id} className={'gm-i' + (on ? ' on' : '') + (overdue(c) ? ' late' : '')}>
                        <input type="checkbox" checked={on} aria-label={c.title + ' 선택'} onChange={e => setPick({ ...pick, [t.id]: e.target.checked })} />
                        <button type="button" onClick={() => openTask(t.id)} title={c.title + ' · 이 품목만 따로 처리'}>{c.title}{c.target_date !== ds[0] && <small> {md(c.target_date)}</small>}</button>
                      </span>
                    )
                  })}
                </div>
                <div className="gm-go">
                  <b>{sel.length}개 선택</b>
                  <button type="button" className="btn sm" disabled={!sel.length} onClick={() => setSheet({ kind: 'bulk', tids: sel.map(t => t.id) })}>선택한 품목 한 번에 처리</button>
                  <span className="hint">품목 이름을 누르면 그 품목만 따로 처리</span>
                </div>
              </div>
            )}
          </div>
        )
      }) : g.kids.filter(k => ts.some(t => t.change_id === k.id)).map(k => (
        <div key={k.id} className="gm-k">
          <div className="gm-kh"><span className="mono">{k.kidNo}</span> <b>{k.title}</b> <small>전환 {md(k.target_date)}</small></div>
          {ts.filter(t => t.change_id === k.id).map(t => (
            <button type="button" key={t.id} className={'t2' + (overdue(k) ? ' late' : '')} onClick={() => openTask(t.id)}>
              <span className={'tc2 ' + (overdue(k) ? 'late' : 'wait')}>{overdue(k) ? '전환일 지남' : '대기'}</span>
              <span className="t2-tx"><span className="t2-t">{t.is_extra && <span className="asg">배정</span>}{t.title}</span></span>
              <span className="arr">›</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
