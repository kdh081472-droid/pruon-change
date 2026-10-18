import { useEffect, useState } from 'react'
import { ORDER, SHORT } from './supabase.js'
import { useApp, Person, ICON } from './ctx.jsx'
import { DAY, add, dd, ddLabel, iso, md, norm, parse, todayMid, stamp } from './util.js'

function useWidth() {
  const [w, setW] = useState(window.innerWidth)
  useEffect(() => {
    let t
    const on = () => { clearTimeout(t); t = setTimeout(() => setW(window.innerWidth), 120) }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

function matches(c, q) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = norm([c.title, c.itemsText, c.description, c.reason, c.created_by_dept].join(' '))
  return words.every(w => hay.includes(norm(w)))
}

export default function TimelineTab() {
  const { db, ui, setUi } = useApp()
  const searching = ui.q.trim().length > 0
  const list = db.changes.filter(c => (searching || c.status === '진행중') && matches(c, ui.q))
  return (
    <>
      <div className="tool">
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="search" placeholder="제품 검색 (예: 만두 포장지)" value={ui.q} autoComplete="off" aria-label="제품 검색"
            onChange={e => setUi(u => ({ ...u, q: e.target.value }))} />
        </div>
        <div className="seg" role="tablist">
          <button type="button" role="tab" className={ui.view === 'timeline' ? 'on' : ''} onClick={() => setUi(u => ({ ...u, view: 'timeline' }))}>타임라인</button>
          <button type="button" role="tab" className={ui.view === 'calendar' ? 'on' : ''} onClick={() => setUi(u => ({ ...u, view: 'calendar' }))}>달력</button>
        </div>
      </div>
      {ui.view === 'calendar' ? <Calendar list={list} searching={searching} /> : <TimelineList list={list} searching={searching} />}
    </>
  )
}

function TimelineList({ list, searching }) {
  const { db, ui, setUi } = useApp()
  const sorted = [...list].sort((a, b) => (a.status === b.status ? 0 : a.status === '진행중' ? -1 : 1) || parse(a.target_date) - parse(b.target_date))
  const closed = db.changes.filter(c => c.status === '종결').sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)))
  return (
    <>
      {!searching && <LateBlock />}
      {searching
        ? <div className="sec-t"><h2>검색 결과 {list.length}건 (종결 포함)</h2><button type="button" onClick={() => setUi(u => ({ ...u, q: '' }))}>지우기</button></div>
        : <div className="sec-t"><h2>제품별 일정</h2></div>}
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

function LateBlock() {
  const { db, C, isLate, openTask } = useApp()
  const lt = db.tasks.filter(isLate).sort((a, b) => parse(a.due_date) - parse(b.due_date))
  if (!lt.length) return <div className="late-box ok">지연된 할 일이 없습니다.</div>
  const by = {}
  lt.forEach(t => { (by[t.department] = by[t.department] || []).push(t) })
  return (
    <div className="late-box">
      <div className="lb-h">지연 중인 할 일 <b>{lt.length}</b></div>
      {ORDER.filter(d => by[d]).map(d => (
        <div className="lb-d" key={d}>
          <span className="lb-dn">{d}</span>
          <div className="lb-list">
            {by[d].map(t => (
              <button type="button" key={t.id} className="lb-i" onClick={() => openTask(t.id)}>
                <span className="lb-t">{t.title}</span>
                <span className="lb-m">{C(t.change_id).short} · <b>{-dd(t.due_date)}일 지연</b></span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- 제품 카드 ---------- */
function scale(dates, pad) {
  const s = add(new Date(Math.min(...dates)), -pad)
  const e = add(new Date(Math.max(...dates)), pad)
  const tot = (e - s) / DAY
  return { s, e, tot, P: x => (((x - s) / DAY) / tot) * 100 }
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

function ProductCard({ c }) {
  const { db, me, viewer, ui, setUi, tOf, isLate, sheet, openTask, openSheet, openReport } = useApp()
  const width = useWidth()
  const ts = tOf(c.id)
  const left = ts.filter(t => t.status === '대기')
  const late = ts.filter(isLate)
  const mine = left.filter(t => t.department === me.department).length
  const isOpen = !!ui.open[c.id]
  const closed = c.status === '종결'
  const stopped = closed && c.close_type === '중단'
  const byD = {}
  ts.forEach(t => { (byD[t.department] = byD[t.department] || []).push(t) })
  const tlogs = db.changeLogs.filter(x => x.change_id === c.id && x.action === '전환일 변경')
  const toggle = () => setUi(u => ({ ...u, open: { ...u.open, [c.id]: !u.open[c.id] } }))
  const stop = fn => e => { e.stopPropagation(); fn() }
  const n = dd(c.target_date)

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
        <button type="button" className="pill" onClick={stop(() => openSheet('target', c.id))}>전환일 변경</button>
        <button type="button" className="pill stop" onClick={stop(() => openSheet('stop', c.id))}>중단 종결</button>
        <button type="button" className="pill" onClick={stop(() => openSheet('assign', c.id))}>+ 할 일 배정</button>
      </span>
    )
  }

  const head = (
    <div className="p-h" role="button" tabIndex={0} aria-expanded={isOpen} onClick={toggle}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggle() } }}>
      <span className="p-title"><ChatMini c={c} /><span className="chev">▶</span>{c.title}</span>
      {acts}
      <span className={'dday' + (closed ? ' closed' : '') + (stopped ? ' stopped' : '')}>
        <b>{closed ? (stopped ? '중단 종결' : '종결') : n >= 0 ? 'D-' + n : 'D+' + -n}</b>
        <span>전환 {md(c.target_date)}</span>
      </span>
      <span className="p-sub">
        {stopped && <><span className="stopr">중단 사유: {c.close_reason} · <Person id={c.closed_by} /></span><br /></>}
        {tlogs.length > 0 && <><span className="chg">전환일 변경됨</span> · </>}
        {ts.length}건 중 {ts.length - left.length}건 처리 · {left.length ? left.length + (stopped ? '건 중단' : '건 남음') : '모두 처리'}
        {late.length > 0 && <> · <span className="late">지연 {late.length}건</span></>}
        {mine > 0 && !closed && !viewer && <> · <span className="mine">우리 부서 {mine}건</span></>}
      </span>
      {isOpen && (
        <span className="relay">
          {ORDER.map(d => {
            const xs = byD[d] || []
            const cls = !xs.length ? '' : xs.some(isLate) ? 'late' : xs.every(t => t.status !== '대기') ? 'ok' : 'ing'
            return <div key={d} className={cls} title={d}><i /><span>{SHORT[d]}</span></div>
          })}
        </span>
      )}
    </div>
  )
  if (!isOpen) return <div className="card" id={'p' + c.id}>{head}</div>

  const today = todayMid()
  const target = parse(c.target_date)
  const sc = scale(ts.map(t => +parse(t.due_date)).concat([+today, +target]), 5)
  const P = sc.P
  const at = x => { const v = P(x); return { left: v + '%', transform: v < 7 ? 'none' : v > 93 ? 'translateX(-100%)' : undefined } }
  const lw = width < 480 ? 128 : 170
  const avail = Math.min(width, 760) - lw - 60
  const step = (avail / sc.tot) * 7 < 44 ? 14 : 7
  const ticks = []
  let last = null
  for (let x = new Date(sc.s); x <= sc.e; x = add(x, 1)) {
    if (x.getDay() === 1 && (!last || Math.round((x - last) / DAY) >= step)) {
      const v = P(x)
      if (v > 4 && v < 96) ticks.push(<span key={+x} className="tk" style={{ left: v + '%' }}>{md(x)}</span>)
      last = x
    }
  }
  const marks = <><span className="tcol" style={{ left: P(today) + '%' }} /><span className="target" style={{ left: P(target) + '%' }} /></>
  const extras = ts.filter(t => t.is_extra).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  return (
    <div className="card open" id={'p' + c.id}>
      {head}
      <div className="p-b">
        <div className="p-info">
          <span>발의 <Person id={c.created_by} fallback={c.created_by_dept} /></span>
          <span>대상 <b>{c.itemsText}</b></span>
          {c.description && <span>{c.description}</span>}
          {c.reason && <span>사유 <b>{c.reason}</b></span>}
        </div>
        {extras.length > 0 && (
          <div className="hist asg-h">
            <h3>할 일 배정 이력 {extras.length}</h3>
            <ol>
              {extras.map(t => (
                <li key={t.id}>
                  <b>[{t.department}] {t.title}</b> · 마감 {md(t.due_date)}<br />
                  <span className="why">사유: {t.assign_reason}</span> — <Person id={t.assigned_by} />, {stamp(t.created_at)}
                </li>
              ))}
            </ol>
          </div>
        )}
        {tlogs.length > 0 && (
          <div className="hist">
            <h3>전환일 변경 이력</h3>
            <ol>
              {tlogs.map(x => (
                <li key={x.id}>{md(x.old_date)} → <b>{md(x.new_date)}</b> · {x.memo} — <Person id={x.user_id} />, {stamp(x.created_at)}</li>
              ))}
            </ol>
          </div>
        )}
        <div className="g" style={{ '--lw': lw + 'px' }}>
          <div className="axis">
            {ticks}
            <span className="tcol head" style={{ left: P(today) + '%' }} />
            <span className="tlabel" style={at(today)}>오늘 {md(today)}</span>
            <span className="glabel" style={at(target)}>전환 {md(target)}</span>
          </div>
          {ORDER.filter(d => byD[d]).map(d => {
            const xs = [...byD[d]].sort((a, b) => parse(a.due_date) - parse(b.due_date))
            const op = xs.filter(t => t.status === '대기').length
            const lt = xs.filter(isLate).length
            const isMine = d === me.department
            return (
              <section key={d} className={'dept' + (lt ? ' has-late' : '') + (isMine ? ' mine' : '')}>
                <div className="grp">
                  <span className="dn">{d}</span>
                  {isMine && <span className="me">우리 부서</span>}
                  <span className={'st' + (lt ? ' late' : '')}>
                    {stopped && op ? `중단 ${op} / ${xs.length}` : op === 0 ? '✓ 모두 완료' : `${lt ? '지연 ' + lt + ' · ' : ''}남은 ${op} / ${xs.length}`}
                  </span>
                </div>
                {xs.map((t, i) => {
                  const cls = isLate(t) ? 'late' : t.status === '완료' ? 'done' : t.status === '해당없음' ? 'na' : ''
                  const on = sheet && sheet.kind === 'task' && sheet.tid === t.id
                  const due = parse(t.due_date)
                  return (
                    <button type="button" key={t.id} className={'r' + (t.status !== '대기' ? ' fin' : '') + (on ? ' on' : '')} onClick={() => openTask(t.id)}
                      aria-label={`${t.title}, 마감 ${md(due)}, ${t.status === '대기' ? ddLabel(dd(due)) : t.status}`}>
                      <span className={'no ' + cls}>{t.status === '완료' ? '✓' : i + 1}</span>
                      <span className="rl">{t.is_extra && <span className="asg" title={(t.assigned_dept || '') + ' 부서가 추가 배정'}>배정</span>}{t.title}</span>
                      <span className="rt">
                        {marks}
                        <span className="rail" />
                        {isLate(t) && <span className="lead" style={{ left: P(due) + '%', width: P(today) - P(due) + '%' }} />}
                        <span className={'pt ' + cls} style={{ left: P(due) + '%' }} />
                        <span className={'pd' + (isLate(t) ? ' late' : '')} style={at(due)}>{md(due)}</span>
                      </span>
                    </button>
                  )
                })}
              </section>
            )
          })}
          <div className="g-foot">
            <span><i style={{ background: 'var(--accent)' }} />대기</span>
            <span><i style={{ background: 'var(--late)' }} />지연</span>
            <span><i style={{ background: 'var(--done)' }} />완료</span>
            <span><i style={{ boxShadow: 'inset 0 0 0 1.5px var(--done)' }} />해당없음</span>
            <span>┊ 전환일</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- 달력 ---------- */
function Calendar({ list, searching }) {
  const { me, viewer, ui, setUi, tOf, isLate, openTask, goChange, C } = useApp()
  const ids = new Set(list.map(c => c.id))
  const mineOnly = ui.calMine && !viewer
  const ts = list.flatMap(c => tOf(c.id)).filter(t => ids.has(t.change_id) && (!mineOnly || t.department === me.department))
  const m0 = parse(ui.calMonth)
  const y = m0.getFullYear(), m = m0.getMonth()
  const startDow = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate()
  const todayIso = iso(todayMid())
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(<span key={'b' + i} className="cell blank" />)
  for (let d = 1; d <= days; d++) {
    const key = iso(new Date(y, m, d))
    const dayTs = ts.filter(t => t.due_date === key)
    const tgs = list.filter(c => c.target_date === key)
    const lateN = dayTs.filter(isLate).length
    const openN = dayTs.filter(t => t.status === '대기' && !isLate(t)).length
    const doneN = dayTs.length - lateN - openN
    const sun = new Date(y, m, d).getDay() === 0
    cells.push(
      <button type="button" key={key}
        className={'cell' + (tgs.length ? ' tgt' : '') + (ui.calSel === key ? ' sel' : '') + (key === todayIso ? ' today' : '') + (sun ? ' sun' : '')}
        tabIndex={dayTs.length || tgs.length ? 0 : -1}
        onClick={() => setUi(u => ({ ...u, calSel: u.calSel === key ? null : key }))}>
        <span className="dn">{d}</span>
        {tgs.length > 0 && <span className="tgl"><em>전환</em>{tgs.map(c => <span key={c.id}>{c.short}</span>)}</span>}
        {dayTs.length > 0 && (
          <>
            <span className="dots">{lateN > 0 && <i className="dl" />}{openN > 0 && <i className="do" />}{doneN > 0 && <i className="dd" />}<em>{dayTs.length}</em></span>
            <span className="names">
              {dayTs.slice(0, 2).map(t => (
                <span key={t.id} className={'cn' + (isLate(t) ? ' late' : t.status !== '대기' ? ' fin' : '')}>{SHORT[t.department]} {t.title.slice(0, 10)}</span>
              ))}
              {dayTs.length > 2 && <span className="cn more">+{dayTs.length - 2}</span>}
            </span>
          </>
        )}
      </button>
    )
  }
  const moveMonth = k => setUi(u => ({ ...u, calMonth: iso(new Date(y, m + k, 1)), calSel: null }))
  const sel = ui.calSel
  const selDate = sel ? parse(sel) : null
  const selTs = sel ? ts.filter(t => t.due_date === sel).sort((a, b) => ORDER.indexOf(a.department) - ORDER.indexOf(b.department)) : []
  const selTgs = sel ? list.filter(c => c.target_date === sel) : []
  return (
    <>
      <div className="card cal-card">
        <div className="cal-top">
          <button type="button" className="nav" onClick={() => moveMonth(-1)} aria-label="이전 달">‹</button>
          <b>{y}년 {m + 1}월</b>
          <button type="button" className="nav" onClick={() => moveMonth(1)} aria-label="다음 달">›</button>
          <span className="cal-f">
            {viewer ? <span className="chipb on">전체 부서</span> : (
              <>
                <button type="button" className={'chipb' + (ui.calMine ? ' on' : '')} onClick={() => setUi(u => ({ ...u, calMine: true }))}>우리 부서</button>
                <button type="button" className={'chipb' + (!ui.calMine ? ' on' : '')} onClick={() => setUi(u => ({ ...u, calMine: false }))}>전체 부서</button>
              </>
            )}
          </span>
        </div>
        {searching && <p className="cal-q">검색: "{ui.q}" · 제품 {list.length}건</p>}
        <div className="cal-g">
          {['일', '월', '화', '수', '목', '금', '토'].map((w, i) => <span key={w} className={'dow' + (i === 0 ? ' sun' : '')}>{w}</span>)}
          {cells}
        </div>
        <div className="g-foot">
          <span><i style={{ background: 'var(--late)' }} />지연</span>
          <span><i style={{ background: 'var(--accent)' }} />대기</span>
          <span><i style={{ background: 'var(--done)' }} />완료</span>
          <span><i style={{ borderRadius: 3, boxShadow: 'inset 0 0 0 2px var(--late)', background: 'var(--late-soft)' }} />전환일</span>
          <span>숫자 = 그날 마감 건수</span>
        </div>
      </div>
      {sel ? (
        <div className="card day-card">
          <div className="m-h">
            <span className="t">{selDate.getMonth() + 1}월 {selDate.getDate()}일 ({['일', '월', '화', '수', '목', '금', '토'][selDate.getDay()]})</span>
            <span className="d">{mineOnly ? me.department + ' 부서' : '전체 부서'}</span>
          </div>
          {selTgs.map(c => {
            const cts = tOf(c.id), dn = cts.filter(t => t.status !== '대기').length
            const stx = c.status === '종결' ? (c.close_type === '중단' ? '중단 종결' : '종결') : `${cts.length}건 중 ${dn}건 처리 · ${cts.length - dn}건 남음`
            return (
              <div className="tg-box" key={c.id}>
                <div className="tg-h"><span className="tg-b">전환일</span><b>{c.title}</b></div>
                <dl className="tg-dl">
                  <dt>변경 내용</dt><dd>{c.description || '-'}</dd>
                  <dt>변경 사유</dt><dd>{c.reason || '-'}</dd>
                  <dt>대상 품목</dt><dd>{c.itemsText}</dd>
                  <dt>진행</dt><dd>{stx}</dd>
                </dl>
                <button type="button" className="link tg-go" onClick={() => goChange(c.id)}>타임라인에서 보기 ›</button>
              </div>
            )
          })}
          {!selTs.length && <div className="empty" style={{ padding: 18 }}>이날 마감인 할 일이 없습니다.</div>}
          {selTs.map(t => {
            const st = t.status === '대기' ? ddLabel(dd(t.due_date)) : t.status
            return (
              <button type="button" key={t.id} className="m-i" onClick={() => openTask(t.id)}>
                <span className={'cal' + (isLate(t) ? ' late' : '')}><b>{SHORT[t.department]}</b></span>
                <span><span className="tt">{t.title}</span><span className={'when' + (isLate(t) ? ' late' : '')}>{C(t.change_id).short} · {st}</span></span>
                <span className="arr">›</span>
              </button>
            )
          })}
        </div>
      ) : <p className="hint" style={{ margin: '4px 4px 0' }}>날짜를 누르면 그날 마감인 할 일이 아래에 나옵니다.</p>}
    </>
  )
}
