import { ORDER } from './supabase.js'
import { useApp, Person } from './ctx.jsx'
import { dd, ddLabel, md, parse, snip, stamp } from './util.js'

function DateBox({ date, late }) {
  const d = parse(date)
  return (
    <span className={'cal' + (late ? ' late' : '')}>
      <b>{d.getDate()}</b><span>{d.getMonth() + 1}월</span>
    </span>
  )
}

/* ---------- 내 할 일 (제품별) · 처리한 일 ---------- */
export function MineTab() {
  const { db, me, C, isLate, openTask, ui, setUi } = useApp()
  const list = db.tasks.filter(t => t.department === me.department && t.status === '대기' && C(t.change_id) && C(t.change_id).status === '진행중')
  const done = db.tasks.filter(t => t.department === me.department && t.status !== '대기' && C(t.change_id))
  const late = list.filter(isLate).length
  const view = ui.mineView || 'todo'
  const head = (
    <>
      <div className="stats two">
        <div className="stat"><div className="k">남은 할 일</div><div className="v">{list.length}</div></div>
        <div className={'stat' + (late ? ' alert' : '')}><div className="k">지연</div><div className="v">{late}</div></div>
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
          const c = C(cid), closed = c.status === '종결'
          return (
            <div className="card done-card" key={cid}>
              <div className="m-h"><span className="t">{c.title}</span><span className={'d' + (closed ? ' cl' : '')}>{closed ? (c.close_type === '중단' ? '중단 종결' : '종결') : '진행중 · 전환 ' + md(c.target_date)}</span></div>
              {by[cid].sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))).map(t => {
                const na = t.status === '해당없음'
                return (
                  <button type="button" key={t.id} className="m-i dn-i" onClick={() => openTask(t.id)}>
                    <span className={'cal ok' + (na ? ' na' : '')}><b>{na ? '–' : '✓'}</b><span>{na ? '해당없음' : '완료'}</span></span>
                    <span>
                      <span className="tt">{t.title}</span>
                      <span className="memo-l">“{t.memo}”</span>
                      <span className="when"><Person id={t.done_by} /> · {stamp(t.done_at)} · 마감 {md(t.due_date)}</span>
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
        const c = C(cid)
        return (
          <div className="card" key={cid}>
            <div className="m-h"><span className="t">{c.title}</span><span className="d">전환 {md(c.target_date)}</span></div>
            {by[cid].sort((a, b) => parse(a.due_date) - parse(b.due_date)).map(t => {
              const n = dd(t.due_date)
              return (
                <button type="button" key={t.id} className="m-i" onClick={() => openTask(t.id)}>
                  <DateBox date={t.due_date} late={n < 0} />
                  <span><span className="tt">{t.title}</span><span className={'when' + (n < 0 ? ' late' : '')}>{ddLabel(n)}</span></span>
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

/* ---------- 지연 현황 (임원) ---------- */
export function LateTab() {
  const { db, C, tOf, isLate, openTask, goChange } = useApp()
  const live = db.changes.filter(c => c.status === '진행중')
  const lt = db.tasks.filter(isLate).sort((a, b) => parse(a.due_date) - parse(b.due_date))
  const soon = db.tasks.filter(t => { const n = dd(t.due_date); return t.status === '대기' && C(t.change_id) && C(t.change_id).status === '진행중' && n >= 0 && n <= 7 })
    .sort((a, b) => parse(a.due_date) - parse(b.due_date))
  const lateC = live.filter(c => tOf(c.id).some(isLate)).length
  const by = {}
  lt.forEach(t => { (by[t.department] = by[t.department] || []).push(t) })
  const closedN = db.changes.filter(c => c.status === '종결').length
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="k">진행 중 변경</div><div className="v">{live.length}</div></div>
        <div className={'stat' + (lt.length ? ' alert' : '')}><div className="k">지연 할 일</div><div className="v">{lt.length}</div></div>
        <div className="stat"><div className="k">7일 이내 마감</div><div className="v">{soon.length}</div></div>
      </div>
      <div className="sec-t"><h2>지연 중인 할 일{lateC ? ' · 제품 ' + lateC + '건' : ''}</h2></div>
      {!lt.length ? <div className="late-box ok">지연된 할 일이 없습니다.</div> : (
        <div className="late-box">
          {ORDER.filter(d => by[d]).map(d => (
            <div className="lb-d" key={d}>
              <span className="lb-dn">{d}<small>{by[d].length}건</small></span>
              <div className="lb-list">
                {by[d].map(t => (
                  <button type="button" key={t.id} className="lb-i" onClick={() => openTask(t.id)}>
                    <span className="lb-t">{t.title}</span>
                    <span className="lb-m">{C(t.change_id).short} · 마감 {md(t.due_date)} · <b>{-dd(t.due_date)}일 지연</b></span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="sec-t"><h2>7일 이내 마감</h2></div>
      {!soon.length ? <div className="card empty">7일 안에 마감되는 할 일이 없습니다.</div> : (
        <div className="card">
          {soon.map(t => (
            <button type="button" key={t.id} className="m-i" onClick={() => openTask(t.id)}>
              <DateBox date={t.due_date} />
              <span><span className="tt">{t.title}</span><span className="when">{t.department} · {C(t.change_id).short} · {ddLabel(dd(t.due_date))}</span></span>
              <span className="arr">›</span>
            </button>
          ))}
        </div>
      )}
      <div className="sec-t"><h2>제품별 진행</h2></div>
      {!live.length ? <div className="card empty">진행 중인 변경이 없습니다.</div> : (
        <div className="card">
          {[...live].sort((a, b) => parse(a.target_date) - parse(b.target_date)).map(c => {
            const ts = tOf(c.id), dn = ts.filter(t => t.status !== '대기').length, ln = ts.filter(isLate).length
            const pct = ts.length ? Math.round((dn / ts.length) * 100) : 0
            return (
              <button type="button" key={c.id} className="pv" onClick={() => goChange(c.id)}>
                <span className="pv-t"><b>{c.title}</b><span className="pv-d">D-{dd(c.target_date)} · 전환 {md(c.target_date)}</span></span>
                <span className="pv-bar"><i style={{ width: pct + '%' }} /></span>
                <span className="pv-m">{ts.length}건 중 {dn}건 처리 · {ts.length - dn}건 남음{ln ? <> · <span className="late">지연 {ln}건</span></> : null}</span>
              </button>
            )
          })}
        </div>
      )}
      {closedN > 0 && <p className="hint" style={{ margin: '10px 4px 0' }}>종결된 변경 {closedN}건과 결과 보고서는 타임라인 탭에서 검색하거나 "종결된 변경 보기"로 볼 수 있습니다.</p>}
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
