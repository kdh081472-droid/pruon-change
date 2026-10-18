import { ORDER } from './supabase.js'
import { useApp, Person } from './ctx.jsx'
import { dd, ddLabel, md, parse, snip } from './util.js'

function DateBox({ date, late }) {
  const d = parse(date)
  return (
    <span className={'cal' + (late ? ' late' : '')}>
      <b>{d.getDate()}</b><span>{d.getMonth() + 1}월</span>
    </span>
  )
}

/* ---------- 내 할 일 (제품별) ---------- */
export function MineTab() {
  const { db, me, C, isLate, openTask } = useApp()
  const list = db.tasks.filter(t => t.department === me.department && t.status === '대기' && C(t.change_id) && C(t.change_id).status === '진행중')
  if (!list.length) return <div className="card empty">지금 {me.department} 부서가 처리할 일이 없습니다.</div>
  const late = list.filter(isLate).length
  const soon = list.filter(t => { const n = dd(t.due_date); return n >= 0 && n <= 7 }).length
  const by = {}
  list.forEach(t => { (by[t.change_id] = by[t.change_id] || []).push(t) })
  const cids = Object.keys(by).sort((a, b) => parse(C(a).target_date) - parse(C(b).target_date))
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="k">남은 할 일</div><div className="v">{list.length}</div></div>
        <div className={'stat' + (late ? ' alert' : '')}><div className="k">지연</div><div className="v">{late}</div></div>
        <div className="stat"><div className="k">7일 이내</div><div className="v">{soon}</div></div>
      </div>
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
export function NewChatBlock() {
  const { db, me, unread, mentionsMe, openChat } = useApp()
  const rows = db.changes.map(c => ({ c, u: unread(c.id) })).filter(x => x.u.length)
  if (!rows.length) return null
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
