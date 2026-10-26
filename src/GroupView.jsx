import { useState } from 'react'
import { ORDER } from './supabase.js'
import { useApp, Person } from './ctx.jsx'
import { dd, md, stamp, snip } from './util.js'

// 묶음(품목별 관리) 계산: 상태·처리·전환일 범위·남은 부서
export function groupStats(g, overdue) {
  const kids = g.kids
  const open = kids.filter(k => k.status === '진행중')
  const stopN = kids.filter(k => k.status === '종결' && k.close_type === '중단').length
  const doneN = kids.length - open.length - stopN
  const lateN = open.filter(k => overdue(k)).length
  let total = 0, done = 0
  kids.forEach(k => { total += k.tasks.length; done += k.tasks.filter(t => t.status !== '대기').length })
  const ds = kids.map(k => k.target_date).sort()
  const openDs = open.map(k => k.target_date).sort()
  const rem = {}
  open.forEach(k => k.tasks.forEach(t => { if (t.status === '대기') rem[t.department] = (rem[t.department] || 0) + 1 }))
  const remList = ORDER.filter(x => rem[x]).concat(Object.keys(rem).filter(x => !ORDER.includes(x))).map(x => [x, rem[x]])
  const closedAt = open.length ? '' : kids.map(k => k.closed_at || '').sort().pop()
  return {
    open, openN: open.length, doneN, stopN, lateN, total, done, pct: total ? Math.round((done / total) * 100) : 0,
    from: ds[0], to: ds[ds.length - 1], next: openDs[0] || null, remList, closedAt,
    status: open.length ? (lateN ? '전환일 지남' : '진행 중') : stopN === kids.length ? '중단 종결' : '종결',
  }
}
export const rangeTxt = (a, b) => (a === b ? md(a) : md(a) + '~' + md(b))
export const dTxt = n => (n === 0 ? 'D-day' : n > 0 ? 'D-' + n : 'D+' + -n)
export const kidStatus = (k, overdue) => (k.status === '종결' ? (k.close_type === '중단' ? '중단 종결' : '종결') : overdue(k) ? '전환일 지남' : '진행 중')
const SCLS = { '진행 중': 'live', '전환일 지남': 'late', 종결: 'done', '중단 종결': 'stop' }

/* ---------- 묶음 화면 ---------- */
export default function GroupView({ gid }) {
  const { db, me, viewer, wide, isAdmin, overdue, unread, goChange, goSummary, setSheet } = useApp()
  const [logOpen, setLogOpen] = useState(false)
  const g = db.groupMap[gid]
  if (!g || !g.kids.length) return <div className="card empty">묶음을 찾을 수 없습니다. 요약에서 다시 골라주세요.</div>
  const s = groupStats(g, overdue)
  const canWork = !viewer && s.openN > 0
  const canEdit = canWork && (me.department === g.created_by_dept || isAdmin)
  const processed = k => k.tasks.some(t => t.status !== '대기') || db.taskLogs.some(l => l.change_id === k.id && ['완료', '해당없음', '확인 취소'].includes(l.action))

  return (
    <div className="card gv">
      <div className="gv-h">
        <div className="gv-top">
          <button type="button" className="back-sum" onClick={goSummary}>← 요약으로</button>
          <span className="g-chip">묶음 · 품목 {g.kids.length}</span>
          <h2 className="gv-t">{g.title}</h2>
          {canWork && (
            <span className="p-acts">
              {canEdit && <button type="button" className="pill" onClick={() => setSheet({ kind: 'gedit', gid })}>내용 수정</button>}
              <button type="button" className="pill" onClick={() => setSheet({ kind: 'gtarget', gid })}>전환일 일괄 변경</button>
              <button type="button" className="pill add" onClick={() => setSheet({ kind: 'gadd', gid })}>+ 품목 추가</button>
              <button type="button" className="pill stop" onClick={() => setSheet({ kind: 'gstop', gid })}>묶음 중단 종결</button>
            </span>
          )}
        </div>
        <dl className="kv2 gv-kv">
          <div><dt>전환일</dt><dd className="mono">{rangeTxt(s.from, s.to)}{s.next && <span className={'gv-d' + (dd(s.next) < 0 ? ' late' : '')}> · {dTxt(dd(s.next))}</span>}</dd></div>
          {g.description && <div><dt>변경 내용 (공통)</dt><dd>{g.description}</dd></div>}
          {g.reason && <div><dt>변경 사유 (공통)</dt><dd>{g.reason}</dd></div>}
          <div><dt>진행</dt><dd><span className="spg"><i><em style={{ width: s.pct + '%' }} /></i>{s.done}/{s.total}</span> <small className="gv-sn">진행 {s.openN} · 종결 {s.doneN}{s.stopN ? ' · 중단 ' + s.stopN : ''}</small></dd></div>
          <div><dt>등록</dt><dd><Person id={g.created_by} fallback={g.created_by_dept} /></dd></div>
        </dl>
      </div>

      {wide ? (
        <div className="gv-tw">
          <table className="gv-table">
            <thead><tr><th className="n">#</th><th className="l">품목</th><th>상태</th><th>처리</th><th>전환일</th><th className="l">남은 부서</th><th>새 대화</th>{canWork && <th />}</tr></thead>
            <tbody>
              {g.kids.map(k => {
                const st = kidStatus(k, overdue), n = k.tasks.length, d = k.tasks.filter(t => t.status !== '대기').length
                const u = unread(k.id), live = k.status === '진행중'
                const rem = ORDER.filter(x => k.tasks.some(t => t.department === x && t.status === '대기'))
                return (
                  <tr key={k.id} className={live ? '' : 'fin'} onClick={() => goChange(k.id)}>
                    <td className="n mono">{k.kidNo}</td>
                    <td className="l"><b>{k.title}</b>{k.target_date !== s.from && live && <span className="own-d">전환일 따로</span>}</td>
                    <td className="ctr"><span className={'sst ' + SCLS[st]}>{st}</span></td>
                    <td><span className={'spg' + (st === '전환일 지남' ? ' late' : '') + (live ? '' : ' fin')}><i><em style={{ width: (n ? (d / n) * 100 : 0) + '%' }} /></i>{d}/{n}</span></td>
                    <td className="ctr mono">{md(k.target_date)}{live && <span className={'tdd' + (dd(k.target_date) <= 7 ? ' hot' : '')}>{dTxt(dd(k.target_date))}</span>}</td>
                    <td className="l rem">{live ? (rem.length === ORDER.length ? '전 부서' : rem.join('·') || '-') : '-'}</td>
                    <td className="ctr">{u.length > 0 && <span className="tdot">{u.length}</span>}</td>
                    {canWork && (
                      <td className="ctr act" onClick={e => e.stopPropagation()}>
                        {live && (processed(k)
                          ? <button type="button" className="gv-x" title="처리된 할 일이 있어 뺄 수 없습니다. 이 품목만 중단 종결합니다." onClick={() => setSheet({ kind: 'stop', cid: k.id })}>중단</button>
                          : <button type="button" className="gv-x" title="아직 아무 부서도 처리하지 않은 품목은 묶음에서 뺄 수 있습니다" onClick={() => setSheet({ kind: 'gremove', cid: k.id })}>빼기</button>)}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="gv-list">
          {g.kids.map(k => {
            const st = kidStatus(k, overdue), n = k.tasks.length, d = k.tasks.filter(t => t.status !== '대기').length
            const u = unread(k.id), live = k.status === '진행중'
            return (
              <div key={k.id} className={'gv-li' + (live ? '' : ' fin')}>
                <button type="button" className="gv-lb" onClick={() => goChange(k.id)}>
                  <span className="gv-ln mono">{k.kidNo}</span>
                  <span className="gv-lt"><b>{k.title}</b>{u.length > 0 && <span className="tdot">{u.length}</span>}
                    <small><span className={'sst ' + SCLS[st]}>{st}</span> {d}/{n} 처리 · 전환 {md(k.target_date)}{live && ' ' + dTxt(dd(k.target_date))}</small></span>
                  <span className="arr">›</span>
                </button>
                {canWork && live && (processed(k)
                  ? <button type="button" className="gv-x" onClick={() => setSheet({ kind: 'stop', cid: k.id })}>중단</button>
                  : <button type="button" className="gv-x" onClick={() => setSheet({ kind: 'gremove', cid: k.id })}>빼기</button>)}
              </div>
            )
          })}
        </div>
      )}
      {canWork && <p className="note gv-note">품목을 누르면 그 품목의 할 일·대화 화면으로 갑니다. <b>빼기</b>는 아직 아무 부서도 처리하지 않은 품목만 되고, 처리된 품목은 <b>중단</b>(이 품목만 중단 종결)으로 정리합니다.</p>}

      {g.logs.length > 0 && (
        <div className={'hist-mini gv-log' + (logOpen ? ' all' : '')}>
          <b>묶음 이력 {g.logs.length}</b>
          {logOpen
            ? <ol>{g.logs.slice().reverse().map(l => <li key={l.id}><b>{l.action}</b> · {String(l.detail || '').split('\n').join(' / ')}{l.memo ? ' · ' + l.memo : ''} — <Person id={l.user_id} />, {stamp(l.created_at)}</li>)}</ol>
            : <span className="hm-last">최근: <b>{g.logs[g.logs.length - 1].action}</b> · {snip(String(g.logs[g.logs.length - 1].detail || '').split('\n').join(' / '), 60)} — <Person id={g.logs[g.logs.length - 1].user_id} />, {stamp(g.logs[g.logs.length - 1].created_at)}</span>}
          <button type="button" onClick={() => setLogOpen(v => !v)}>{logOpen ? '접기 ▴' : '전체 보기 ▾'}</button>
        </div>
      )}
    </div>
  )
}

/* ---------- PC 오른쪽 칸: 묶음 화면에서는 새 대화가 있는 품목 ---------- */
export function GroupDock({ gid }) {
  const { db, unread, mentionsMe, goChange } = useApp()
  const g = db.groupMap[gid]
  const rows = g ? g.kids.map(k => ({ k, u: unread(k.id) })).filter(x => x.u.length) : []
  return (
    <div className="chat docked dock-empty">
      <div className="ch-h"><div><span className="s-tag">품목 대화</span><b>대화는 품목마다 따로 있어요.<br />품목을 누르면 그 품목 대화가 열립니다.</b></div></div>
      <div className="ch-list">
        {rows.length ? (
          <div className="card nc">
            <div className="m-h"><span className="t">새 대화가 있는 품목</span></div>
            {rows.map(({ k, u }) => (
              <button type="button" key={k.id} className="m-i" onClick={() => goChange(k.id)}>
                <span className="ub big">{u.length}</span>
                <span><span className="tt">{k.title}{u.some(mentionsMe) && <> <span className="at me">@</span></>}</span><span className="when"><Person id={u[u.length - 1].user_id} /> {snip(u[u.length - 1].body, 30)}</span></span>
                <span className="arr">›</span>
              </button>
            ))}
          </div>
        ) : <div className="empty">이 묶음에 안 읽은 대화가 없습니다.</div>}
      </div>
    </div>
  )
}

/* ---------- 품목 화면 위: 묶음 경로 · 이전/다음 품목 ---------- */
export function GroupCrumb({ c }) {
  const { goChange, goGroup } = useApp()
  const g = c.group
  if (!g) return null
  const i = g.kids.findIndex(k => k.id === c.id)
  const prev = g.kids[i - 1], next = g.kids[i + 1]
  return (
    <div className="g-crumb">
      <button type="button" className="g-back" onClick={() => goGroup(g.id)}>← 묶음으로</button>
      <span className="g-chip">묶음</span>
      <button type="button" className="g-name" onClick={() => goGroup(g.id)}>{g.title}</button>
      <span className="g-sep">›</span>
      <b className="g-no">품목 {i + 1} / {g.kids.length}</b>
      <span className="g-nav">
        <button type="button" className="pill" disabled={!prev} onClick={() => prev && goChange(prev.id)} title={prev ? prev.title : ''}>‹ 이전 품목</button>
        <button type="button" className="pill" disabled={!next} onClick={() => next && goChange(next.id)} title={next ? next.title : ''}>다음 품목 ›</button>
      </span>
    </div>
  )
}
