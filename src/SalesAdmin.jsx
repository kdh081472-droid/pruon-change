import { useState } from 'react'
import { useApp, salesPeople } from './ctx.jsx'

// 관리자 모드 › 영업 담당 설정: 함께 처리하는 사람(겸직자) · 담당 건 넘기기 · 영업 담당 미정 건 정하기 (upgrade28)
export default function SalesAdmin() {
  const { db, run, toast } = useApp()
  const [busy, setBusy] = useState('')
  const [mv, setMv] = useState({ from: '', to: '' })
  const sales = salesPeople(db)
  const helpers = db.salesHelpers || []
  const live = db.changes.filter(c => c.status === '진행중')
  // 진행 중 담당 건수 (묶음은 1건)
  const cnt = id => live.filter(c => !c.group && c.sales_owner === id).length + db.groups.filter(g => g.sales_owner === id && g.kids.some(k => k.status === '진행중')).length
  const owners = [...new Set([...sales.map(p => p.id), ...live.map(c => c.sales_owner).filter(Boolean)])].filter(id => db.people[id])
  const canHelp = db.profiles.filter(p => !p.left_at && p.department && p.department !== '영업' && db.depts.some(d => d.name === p.department && d.kind === '업무'))
    .sort((a, b) => (a.department + a.name).localeCompare(b.department + b.name, 'ko'))
  const undecided = [
    ...live.filter(c => !c.group && !c.sales_owner).map(c => ({ key: c.id, cid: c.id, title: c.title, target: c.target_date })),
    ...db.groups.filter(g => !g.sales_owner && g.kids.some(k => k.status === '진행중')).map(g => ({ key: 'g' + g.id, gid: g.id, title: g.title + ' (묶음 · 품목 ' + g.kids.length + ')', target: g.kids.map(k => k.target_date).sort()[0] })),
  ].sort((a, b) => String(a.target).localeCompare(String(b.target)))

  const call = async (k, fn, args, ok) => {
    if (busy) return
    setBusy(k)
    const r = await run(fn, args, ok)
    setBusy('')
    if (r.error) toast(r.error)
    return r
  }
  const notReady = !('salesHelpers' in db) || db.changes.some(c => !('sales_owner' in c))

  return (
    <>
      <div className="adm-h"><div><h1>영업 담당 설정</h1><p>영업사원별로 일을 함께 처리하는 사람(겸직자)을 정하고, 담당 건을 넘기거나 미정 건의 담당자를 정합니다</p></div></div>
      {notReady && <div className="card empty">upgrade28.sql을 먼저 실행해야 이 화면을 쓸 수 있습니다.</div>}

      <div className="card adm-card sa-card">
        <h2>함께 처리하는 사람</h2>
        <p className="ml-sub">지정된 사람은 그 영업사원이 담당인 변경의 영업 할 일을 내 할 일에서 보고 처리할 수 있습니다. 변경 등록 때 영업 담당자만 고르면 함께 처리하는 사람은 자동으로 따라갑니다.</p>
        {sales.length === 0 ? <p className="ml-sub">영업 부서 가입자가 없습니다.</p> : (
          <table className="adm-t sa-t">
            <thead><tr><th>영업사원</th><th>진행 중 담당</th><th>함께 처리하는 사람</th></tr></thead>
            <tbody>
              {sales.map(p => {
                const hs = helpers.filter(h => h.owner === p.id)
                return (
                  <tr key={p.id}>
                    <td><b>{p.name}</b></td>
                    <td>{cnt(p.id)}건</td>
                    <td>
                      {hs.map(h => { const u = db.people[h.helper]; return (
                        <span key={h.helper} className="sa-chip">{u ? u.name : '-'}{u && <small> · {u.department}{u.left_at ? ' (퇴사)' : ''}</small>}
                          <button type="button" aria-label="빼기" disabled={!!busy} onClick={() => call('h' + p.id, 'admin_sales_helper', { p_owner: p.id, p_helper: h.helper, p_on: false }, '함께 처리하는 사람에서 뺐습니다')}>✕</button>
                        </span>
                      ) })}
                      <select className="sa-add" value="" disabled={!!busy} aria-label={p.name + '의 함께 처리하는 사람 추가'}
                        onChange={e => e.target.value && call('h' + p.id, 'admin_sales_helper', { p_owner: p.id, p_helper: e.target.value, p_on: true }, '함께 처리하는 사람을 추가했습니다')}>
                        <option value="">+ 사람 추가</option>
                        {canHelp.filter(u => !hs.some(h => h.helper === u.id)).map(u => <option key={u.id} value={u.id}>{u.name} · {u.department}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card adm-card sa-card">
        <h2>담당 건 넘기기</h2>
        <p className="ml-sub">퇴사·담당 변경 때 한 사람의 진행 중 담당 건(묶음 포함)을 다른 영업사원에게 한 번에 넘깁니다. 바꾼 기록이 각 변경에 남습니다.</p>
        <div className="sa-mv">
          <select value={mv.from} onChange={e => setMv({ ...mv, from: e.target.value })} aria-label="넘기는 사람">
            <option value="">넘기는 사람</option>
            {owners.map(id => <option key={id} value={id}>{db.people[id].name}{db.people[id].left_at ? ' (퇴사)' : ''} · {cnt(id)}건</option>)}
          </select>
          <span>→</span>
          <select value={mv.to} onChange={e => setMv({ ...mv, to: e.target.value })} aria-label="받는 사람">
            <option value="">받는 사람</option>
            {sales.filter(p => p.id !== mv.from).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" className="btn sm" disabled={!!busy || !mv.from || !mv.to || !cnt(mv.from)}
            onClick={async () => { const r = await call('mv', 'admin_sales_move', { p_from: mv.from, p_to: mv.to }, n => `${n}건을 넘겼습니다`); if (r && !r.error) setMv({ from: '', to: '' }) }}>{busy === 'mv' ? '넘기는 중…' : '넘기기'}</button>
        </div>
      </div>

      <div className="card adm-card sa-card">
        <h2>영업 담당 미정 <small className={undecided.length ? 'sa-n' : ''}>{undecided.length}건</small></h2>
        <p className="ml-sub">영업 담당 기능을 넣기 전에 등록된 진행 중 변경입니다. 담당자를 정하기 전까지는 누구의 내 할 일에도 영업 할 일이 보이지 않습니다 (변경 화면에서 영업 부서가 처리할 수는 있음).</p>
        {undecided.length === 0 ? <p className="ml-sub">모두 정해졌습니다.</p> : (
          <table className="adm-t sa-t">
            <tbody>
              {undecided.map(x => (
                <tr key={x.key}>
                  <td>{x.title}</td>
                  <td className="sa-d">전환 {String(x.target || '').slice(5).replace('-', '/')}</td>
                  <td className="sa-pick">
                    <select value="" disabled={!!busy} aria-label={x.title + ' 영업 담당 고르기'}
                      onChange={e => e.target.value && call(x.key, 'set_sales_owner', { p_change: x.cid || null, p_group: x.gid || null, p_owner: e.target.value }, '영업 담당자를 정했습니다')}>
                      <option value="">영업 담당 고르기</option>
                      {sales.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
