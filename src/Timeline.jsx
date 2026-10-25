import { useEffect, useState } from 'react'
import { ORDER } from './supabase.js'
import { useApp, Person, ICON } from './ctx.jsx'
import Summary from './Summary.jsx'
import { dd, iso, md, norm, parse, todayMid, stamp, snip } from './util.js'

function matches(c, q) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = norm([c.title, c.itemsText, c.description, c.reason, c.created_by_dept].join(' '))
  return words.every(w => hay.includes(norm(w)))
}

// D-day 배지: 진행 중 = D-n / 전환일 지남 / 종결
export function DBadge({ c }) {
  const { overdue } = useApp()
  if (c.status === '종결') return <span className="dd2 fin">{c.close_type === '중단' ? '중단 종결' : '종결'}</span>
  const n = dd(c.target_date)
  if (n < 0) return overdue(c) ? <span className="dd2 late">전환일 지남 D+{-n}</span> : <span className="dd2">D+{-n}</span>
  return <span className={'dd2' + (n <= 7 ? ' soon' : '')}>{n === 0 ? 'D-day' : 'D-' + n}</span>
}

export default function TimelineTab() {
  const { db, ui, setUi } = useApp()
  const searching = ui.q.trim().length > 0
  const list = db.changes.filter(c => (searching || c.status === '진행중') && matches(c, ui.q))
  return (
    <>
      <div className={'tool' + (ui.view === 'summary' ? ' tool-sum' : '')}>
        {ui.view !== 'summary' && <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="search" placeholder="제품 검색 (예: 곰곰 교자만두)" value={ui.q} autoComplete="off" aria-label="제품 검색"
            onChange={e => setUi(u => ({ ...u, q: e.target.value }))} />
        </div>}
        <div className="seg" role="tablist">
          <button type="button" role="tab" className={ui.view === 'timeline' ? 'on' : ''} onClick={() => setUi(u => ({ ...u, view: 'timeline' }))}>제품별</button>
          <button type="button" role="tab" className={ui.view === 'calendar' ? 'on' : ''} onClick={() => setUi(u => ({ ...u, view: 'calendar' }))}>달력</button>
          <button type="button" role="tab" className={ui.view === 'summary' ? 'on' : ''} onClick={() => setUi(u => ({ ...u, view: 'summary' }))}>요약</button>
        </div>
      </div>
      {ui.view === 'summary' ? <Summary /> : ui.view === 'calendar'
        ? <Calendar list={searching ? list : db.changes} searching={searching} />
        : <TimelineList list={list} searching={searching} />}
    </>
  )
}

function TimelineList({ list, searching }) {
  const { db, ui, setUi } = useApp()
  const sorted = [...list].sort((a, b) => (a.status === b.status ? 0 : a.status === '진행중' ? -1 : 1) || parse(a.target_date) - parse(b.target_date))
  const closed = db.changes.filter(c => c.status === '종결').sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)))
  return (
    <>
      {searching
        ? <div className="sec-t"><h2>검색 결과 {list.length}건 (종결 포함)</h2><button type="button" onClick={() => setUi(u => ({ ...u, q: '' }))}>지우기</button></div>
        : <div className="sec-t"><h2>진행 중 {list.length}건 · 전환일이 가까운 순</h2></div>}
      {searching && !list.length && <div className="card empty">"{ui.q}"에 맞는 제품이 없습니다.<br />단어를 줄이거나 다른 단어로 찾아보세요.</div>}
      {!searching && !list.length && <div className="card empty">진행 중인 변경이 없습니다.</div>}
      {sorted.map(c => <ProductCard key={c.id} c={c} />)}
      {!searching && closed.length > 0 && (
        <>
          <button type="button" className="closed-t" onClick={() => setUi(u => ({ ...u, showClosed: !u.showClosed }))}>
            {ui.showClosed ? '종결된 변경 숨기기' : `종결된 변경 ${closed.length}건 보기`}
          </button>
          {ui.showClosed && closed.map(c => <div key={c.id} style={{ marginTop: 12 }}><ProductCard c={c} /></div>)}
        </>
      )}
    </>
  )
}

export function ChatMini({ c }) {
  const { db, unread, mentionsMe, openChat } = useApp()
  const u = unread(c.id)
  const n = db.messages.filter(m => m.change_id === c.id && !m.deleted).length
  return (
    <button type="button" className={'chat-mini' + (u.length ? ' new' : '')}
      aria-label={`제품 대화 ${n}개${u.length ? ', 새 글 ' + u.length + '개' : ''}`}
      onClick={e => { e.stopPropagation(); openChat(c.id) }}>
      {ICON.chat}대화
      {u.length ? <span className="ub">{u.some(mentionsMe) ? '@' : ''}{u.length}</span> : n ? <span className="cn0">{n}</span> : null}
    </button>
  )
}

/* ---------- 제품 카드: 위에 요약, 펼치면 부서별 할 일 목록 ---------- */
export function ProductCard({ c, forceOpen }) {
  const { db, me, viewer, wide, ui, setUi, tOf, isLate, overdue, sheet, openTask, openSheet, openReport, isAdmin, run, toast } = useApp()
  const pcView = !!forceOpen && wide        // PC 제품 화면: 버튼은 제목 줄 오른쪽, 대화 버튼 없음
  const [openDept, setOpenDept] = useState({})
  const [ord, setOrd] = useState(null)        // 우리 부서 할 일 순서 (저장되기 전 화면에 먼저 반영)
  const [drag, setDrag] = useState(null)
  const ts = tOf(c.id)
  useEffect(() => { setOrd(null) }, [ts])
  const left = ts.filter(t => t.status === '대기')
  const mine = left.filter(t => t.department === me.department).length
  const isOpen = !!ui.open[c.id] || !!forceOpen
  const closed = c.status === '종결'
  const stopped = closed && c.close_type === '중단'
  const od = overdue(c)
  const pct = ts.length ? Math.round(((ts.length - left.length) / ts.length) * 100) : 0
  const tlogs = db.changeLogs.filter(x => x.change_id === c.id && x.action === '전환일 변경')
  const clogs = db.changeLogs.filter(x => x.change_id === c.id && (x.action === '전환일 변경' || x.action === '내용 수정'))
  const canEdit = !viewer && !closed && (me.department === c.created_by_dept || isAdmin)
  const toggle = () => { if (!forceOpen) setUi(u => ({ ...u, open: { ...u.open, [c.id]: !u.open[c.id] } })) }
  const stop = fn => e => { e.stopPropagation(); fn() }

  let acts = null
  if (viewer) {
    if (closed) acts = <span className="p-acts"><button type="button" className="pill rep" onClick={stop(() => openReport(c.id))}>결과 보고서 PDF</button></span>
  } else if (closed) {
    acts = (
      <span className="p-acts">
        {stopped && isOpen && <button type="button" className="pill" onClick={stop(() => openSheet('resume', c.id))}>다시 진행</button>}
        <button type="button" className="pill rep" onClick={stop(() => openReport(c.id))}>결과 보고서 PDF</button>
      </span>
    )
  } else if (isOpen) {
    acts = (
      <span className="p-acts">
        {canEdit && <button type="button" className="pill" onClick={stop(() => openSheet('edit', c.id))}>내용 수정</button>}
        <button type="button" className="pill" onClick={stop(() => openSheet('target', c.id))}>전환일 변경</button>
        <button type="button" className="pill" onClick={stop(() => openSheet('assign', c.id))}>+ 할 일 배정</button>
        <button type="button" className="pill stop" onClick={stop(() => openSheet('stop', c.id))}>중단 종결</button>
      </span>
    )
  }

  const head = (
    <div className={'p-h2' + (forceOpen ? ' fixed' : '') + (pcView ? ' pcv' : '')} role={forceOpen ? undefined : 'button'} tabIndex={forceOpen ? undefined : 0} aria-expanded={forceOpen ? undefined : isOpen} onClick={toggle}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggle() } }}>
      <div className="p2-top">
        <span className="p-title">{!pcView && <ChatMini c={c} />}{!forceOpen && <span className="chev">▶</span>}{c.title}</span>
        {pcView && acts}
        <span className="dd-big"><DBadge c={c} /></span>
      </div>
      <div className="p2-meta">
        {!pcView && <span className="mono">전환 {md(c.target_date)}</span>}
        {tlogs.length > 0 && <span className="chg">전환일 변경됨</span>}
        {clogs.length > tlogs.length && <span className="chg">내용 수정됨</span>}
        <span>{ts.length - left.length}/{ts.length} 처리</span>
        {left.length > 0 && <span className={od ? 'late' : ''}>{stopped ? '중단 ' + left.length + '건' : '남은 ' + left.length + '건'}</span>}
        {mine > 0 && !closed && !viewer && <span className="mine">우리 부서 {mine}건</span>}
      </div>
      <span className={'bar2' + (od ? ' late' : '')}><i style={{ width: pct + '%' }} /></span>
      {!isOpen && !closed && left.length > 0 && (
        <span className="rem-ch">
          {ORDER.filter(d => left.some(t => t.department === d)).map(d => <span key={d} className={'sdp' + (od ? ' late' : '')}>{d} {left.filter(t => t.department === d).length}</span>)}
        </span>
      )}
      {!pcView && acts}
      {stopped && <span className="stopr">중단 사유: {c.close_reason} · <Person id={c.closed_by} /></span>}
    </div>
  )
  if (!isOpen) return <div className={'card pc2' + (od ? ' od' : '')} id={'p' + c.id}>{head}</div>

  // 부서별로 묶고, 남은 할 일이 있는 부서를 위로
  const groups = ORDER.map(d => ({ d, xs: ts.filter(t => t.department === d) }))
    .concat([...new Set(ts.map(t => t.department))].filter(d => !ORDER.includes(d)).map(d => ({ d, xs: ts.filter(t => t.department === d) })))
    .filter(g => g.xs.length)
  // 남은 할 일 있는 우리 부서 → 남은 할 일 있는 부서 → 모두 처리한 부서
  const rank = g => (g.xs.some(t => t.status === '대기') ? (g.d === me.department && !viewer ? 0 : 1) : 2)
  groups.sort((a, b) => rank(a) - rank(b))
  const canOrder = !viewer && !closed
  const mineIds = ts.filter(t => t.department === me.department).map(t => t.id)
  const curOrd = ord || mineIds
  const saveOrd = async ids => {
    setOrd(ids)
    const r = await run('reorder_tasks', { p_change: c.id, p_ids: ids })
    if (r.error) { setOrd(null); toast(r.error) }
  }
  const moveTo = (from, to) => {
    if (to < 0 || to >= curOrd.length || from === to) return
    const ids = curOrd.slice(); const [x] = ids.splice(from, 1); ids.splice(to, 0, x); saveOrd(ids)
  }
  const extras = ts.filter(t => t.is_extra).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  return (
    <div className={'card pc2 open' + (od ? ' od' : '')} id={'p' + c.id}>
      {head}
      <div className="p-b">
        <dl className="kv2">
          <div><dt>전환일</dt><dd className="mono">{c.target_date.replace(/-/g, '.')}</dd></div>
          <div><dt>대상</dt><dd>{c.itemsText}</dd></div>
          {c.description && <div><dt>변경 내용</dt><dd>{c.description}</dd></div>}
          {c.reason && <div><dt>변경 사유</dt><dd>{c.reason}</dd></div>}
          <div><dt>등록</dt><dd><Person id={c.created_by} fallback={c.created_by_dept} /></dd></div>
        </dl>
        {od && <div className="od-band">전환일이 {-dd(c.target_date)}일 지났는데 남은 할 일이 {left.length}건 있습니다. 변경 전 상태로 생산·출고되지 않도록 바로 확인해주세요.</div>}
        {clogs.length > 0 && (
          <div className="hist">
            <h3>변경 이력</h3>
            <ol>
              {clogs.map(x => (
                <li key={x.id}>
                  {x.action === '전환일 변경'
                    ? <>전환일 {md(x.old_date)} → <b>{md(x.new_date)}</b> · {x.memo}</>
                    : <><b>내용 수정</b><span className="ch-d">{x.detail}</span></>}
                  {' '}— <Person id={x.user_id} />, {stamp(x.created_at)}
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="dg-grid">
        {groups.map(({ d, xs }) => {
          const r = xs.filter(t => t.status === '대기').length
          const open = r > 0 || !!openDept[d]
          const isMine = d === me.department
          return (
            <section key={d} className={'dg2' + (r && od ? ' od' : '') + (isMine ? ' mine' : '') + (r ? '' : ' done')}>
              <button type="button" className="dg2-h" disabled={r > 0} aria-expanded={open} onClick={() => setOpenDept(o => ({ ...o, [d]: !o[d] }))}>
                <b>{d}</b>{isMine && !viewer && <span className="me">우리 부서</span>}{isMine && canOrder && r > 0 && xs.length > 1 && <span className="ord-h">{wide ? '끌어서 순서 변경' : '▲▼로 순서 변경'}</span>}
                <span className="sp" />
                {r > 0
                  ? <span className="dg2-n">{stopped ? '중단 ' + r + '건' : '남은 ' + r + '건'}</span>
                  : <><span className="dg2-ok">✓ {xs.length}건 모두 처리</span><span className="caret">{open ? '▾' : '▸'}</span></>}
              </button>
              {open && (isMine && canOrder ? xs.slice().sort((p, q) => curOrd.indexOf(p.id) - curOrd.indexOf(q.id)) : xs).map((t, i) => {
                const late = isLate(t)
                const on = sheet && sheet.kind === 'task' && sheet.tid === t.id
                const movable = isMine && canOrder && xs.length > 1
                const idx = movable ? curOrd.indexOf(t.id) : i
                return (
                  <div key={t.id} className={'t2row' + (movable ? ' mv' : '') + (drag && drag.over === idx && drag.from !== idx ? ' over' : '') + (drag && drag.from === idx ? ' dragging' : '')}
                    draggable={movable && wide}
                    onDragStart={movable ? e => { try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id) } catch (_) {} setDrag({ from: idx, over: idx }) } : undefined}
                    onDragOver={movable ? e => { e.preventDefault(); if (drag && drag.over !== idx) setDrag({ ...drag, over: idx }) } : undefined}
                    onDrop={movable ? e => { e.preventDefault(); if (drag) moveTo(drag.from, idx); setDrag(null) } : undefined}
                    onDragEnd={movable ? () => setDrag(null) : undefined}>
                    {movable && wide && <span className="grip" aria-hidden="true">⋮⋮</span>}
                    <span className="tno">{i + 1}</span>
                    <button type="button" className={'t2' + (late ? ' late' : '') + (on ? ' on' : '')} onClick={() => openTask(t.id)}>
                      <span className={'tc2 ' + (t.status === '완료' ? 'ok' : t.status === '해당없음' ? 'na' : late ? 'late' : stopped ? 'na' : 'wait')}>
                        {t.status === '완료' ? '확인완료' : t.status === '해당없음' ? '해당없음' : late ? '전환일 지남' : stopped ? '중단' : '대기'}
                      </span>
                      <span className="t2-tx">
                        <span className="t2-t">{t.is_extra && <span className="asg" title={(t.assigned_dept || '') + ' 부서가 추가 배정'}>배정</span>}{t.title}</span>
                        {t.status !== '대기' && <span className="t2-who"><Person id={t.done_by} /> · {stamp(t.done_at)} · “{snip(t.memo, 40)}”</span>}
                      </span>
                      <span className="arr">›</span>
                    </button>
                    {movable && (
                      <span className="t2-mv">
                        <button type="button" aria-label="위로" disabled={idx === 0} onClick={() => moveTo(idx, idx - 1)}>▲</button>
                        <button type="button" aria-label="아래로" disabled={idx === curOrd.length - 1} onClick={() => moveTo(idx, idx + 1)}>▼</button>
                      </span>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}
        </div>
        {extras.length > 0 && (
          <div className="hist asg-h">
            <h3>할 일 배정 이력 {extras.length}</h3>
            <ol>
              {extras.map(t => (
                <li key={t.id}>
                  <b>[{t.department}] {t.title}</b><br />
                  <span className="why">사유: {t.assign_reason}</span> — <Person id={t.assigned_by} />, {stamp(t.created_at)}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- 달력: 이번 달 + 다음 달, 전환일만 ---------- */
export function Calendar({ list, searching, title }) {
  const { ui, setUi, overdue, tOf, goChange } = useApp()
  const m0 = parse(ui.calMonth)
  const months = [m0, new Date(m0.getFullYear(), m0.getMonth() + 1, 1)]
  const byDate = {}
  list.forEach(c => { (byDate[c.target_date] = byDate[c.target_date] || []).push(c) })
  const todayIso = iso(todayMid())
  const move = k => setUi(u => ({ ...u, calMonth: iso(new Date(m0.getFullYear(), m0.getMonth() + k, 1)), calSel: null }))
  const thisMonth = () => { const t = todayMid(); setUi(u => ({ ...u, calMonth: iso(new Date(t.getFullYear(), t.getMonth(), 1)), calSel: null })) }
  const sel = ui.calSel && byDate[ui.calSel] ? ui.calSel : null
  const selDate = sel ? parse(sel) : null
  const evCls = c => (overdue(c) ? 'late' : c.status === '종결' ? 'fin' : 'live')
  const label = c => { const p = c.title.split('_'); return p.length >= 3 ? p[1] : c.short }

  const grid = m => {
    const y = m.getFullYear(), mo = m.getMonth()
    const startDow = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < startDow; i++) cells.push(<span key={'b' + i} className="c2 blank" />)
    for (let d = 1; d <= days; d++) {
      const key = iso(new Date(y, mo, d)), cs = byDate[key] || []
      const sun = new Date(y, mo, d).getDay() === 0
      const cls = 'c2' + (key === todayIso ? ' today' : '') + (sel === key ? ' sel' : '') + (cs.length ? ' has' : '')
      cells.push(cs.length ? (
        <button type="button" key={key} className={cls} onClick={() => setUi(u => ({ ...u, calSel: u.calSel === key ? null : key }))}>
          <span className={'dn' + (sun ? ' sun' : '')}>{d}</span>
          {cs.map(c => <span key={c.id} className={'ev2 ' + evCls(c)}>{label(c)}</span>)}
        </button>
      ) : (
        <span key={key} className={cls}><span className={'dn' + (sun ? ' sun' : '')}>{d}</span></span>
      ))
    }
    return (
      <div className="card mon2" key={y + '-' + mo}>
        <h3>{y}년 {mo + 1}월</h3>
        <div className="g7">{['일', '월', '화', '수', '목', '금', '토'].map((w, i) => <span key={w} className={'dow' + (i === 0 ? ' sun' : '')}>{w}</span>)}</div>
        <div className="g7">{cells}</div>
      </div>
    )
  }

  return (
    <>
      <div className="cal2-top">
        {title && <h1 className="page-t">{title}</h1>}
        <span className="cal2-nav">
          <button type="button" className="chipb" onClick={() => move(-1)} aria-label="이전 달">◀</button>
          <button type="button" className="chipb" onClick={thisMonth}>이번 달</button>
          <button type="button" className="chipb" onClick={() => move(1)} aria-label="다음 달">▶</button>
        </span>
        <span className="g-foot cal2-legend">
          <span><i style={{ background: 'var(--accent)' }} />진행 중</span>
          <span><i style={{ background: 'var(--late)' }} />전환일 지남 (남은 할 일 있음)</span>
          <span><i style={{ background: 'var(--done)' }} />종결</span>
        </span>
        {searching && <span className="cal-q">검색: "{ui.q}" · 제품 {list.length}건</span>}
      </div>
      <div className="cal2">{months.map(grid)}</div>
      {sel ? (
        <div className="card day-card">
          <div className="m-h">
            <span className="t">{selDate.getMonth() + 1}월 {selDate.getDate()}일 ({['일', '월', '화', '수', '목', '금', '토'][selDate.getDay()]}) 전환</span>
          </div>
          {byDate[sel].map(c => {
            const cts = tOf(c.id), dn = cts.filter(t => t.status !== '대기').length
            return (
              <div className="tg-box" key={c.id}>
                <div className="tg-h"><b>{c.title}</b><DBadge c={c} /></div>
                <dl className="tg-dl">
                  <dt>변경 내용</dt><dd>{c.description || '-'}</dd>
                  <dt>변경 사유</dt><dd>{c.reason || '-'}</dd>
                  <dt>대상 품목</dt><dd>{c.itemsText}</dd>
                  <dt>진행</dt><dd>{cts.length}건 중 {dn}건 처리</dd>
                </dl>
                <button type="button" className="link tg-go" onClick={() => goChange(c.id)}>제품 열기 ›</button>
              </div>
            )
          })}
        </div>
      ) : <p className="hint" style={{ margin: '4px 4px 0' }}>전환일이 있는 날짜를 누르면 변경 내용과 사유가 아래에 나옵니다.</p>}
    </>
  )
}
