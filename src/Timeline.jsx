import { useEffect, useState } from 'react'
import { supabase, DEPARTMENTS } from './supabase.js'

/* ---------- 날짜 도우미 ---------- */
const DAY = 86400000
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function todayMidnight() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function md(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// 할 일 하나의 상태 → 색 구분
function taskTone(t, today) {
  if (t.status === '완료') return 'done'
  if (t.status === '해당없음') return 'na'
  const n = Math.round((parseDate(t.due_date) - today) / DAY)
  if (n < 0) return 'late'
  if (n <= 3) return 'soon'
  return 'wait'
}

// 같은 날짜의 할 일은 점 하나로 묶고, 가장 급한 상태의 색을 씀
const TONE_RANK = { late: 4, soon: 3, wait: 2, na: 1, done: 0 }
function groupByDate(ts, today) {
  const map = {}
  ts.forEach(t => { (map[t.due_date] = map[t.due_date] || []).push(t) })
  return Object.entries(map).map(([date, items]) => ({
    date,
    items,
    tone: items.map(t => taskTone(t, today)).sort((a, b) => TONE_RANK[b] - TONE_RANK[a])[0],
  }))
}

/* ---------- 변경 1건의 부서별 일정 막대 ---------- */
const TONE_LABEL = { done: '확인완료', na: '해당없음', wait: '대기', soon: '3일 이내', late: '지연' }

export function ChangeTimeline({ change, tasks, compact = false }) {
  const [sel, setSel] = useState(null) // { dept, date }
  const today = todayMidnight()
  const target = parseDate(change.target_date)
  const dates = tasks.map(t => parseDate(t.due_date))
  if (dates.length === 0) return <p className="muted small-text">할 일이 없습니다.</p>

  // 표시 범위: 할 일 마감일 + 오늘 + 목표일을 모두 포함하고 양옆 여유
  let start = new Date(Math.min(...dates, today, target))
  let end = new Date(Math.max(...dates, today, target))
  const span = Math.max((end - start) / DAY, 14)
  const pad = Math.ceil(span * 0.06)
  start = new Date(start.getTime() - pad * DAY)
  end = new Date(start.getTime() + (span + pad * 2) * DAY)
  const total = (end - start) / DAY
  const pos = d => ((d - start) / DAY / total) * 100

  // 눈금 5개
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => new Date(start.getTime() + Math.round(total * f) * DAY))

  const rows = DEPARTMENTS
    .map(dept => ({ dept, ts: tasks.filter(t => t.department === dept) }))
    .filter(r => r.ts.length > 0)

  const showToday = today >= start && today <= end

  const selItems = sel ? tasks.filter(t => t.department === sel.dept && t.due_date === sel.date) : []

  return (
    <>
    <div className={'tl' + (compact ? ' compact' : '')}>
      <div className="tl-axis">
        <div className="tl-label" />
        <div className="tl-track">
          {ticks.map((d, i) => (
            <span key={i} className="tl-tick" style={{ left: pos(d) + '%' }}>{md(d)}</span>
          ))}
        </div>
      </div>

      {rows.map(({ dept, ts }) => {
        const ds = ts.map(t => parseDate(t.due_date))
        const first = new Date(Math.min(...ds))
        const last = new Date(Math.max(...ds))
        const open = ts.filter(t => t.status === '대기')
        const late = ts.filter(t => taskTone(t, today) === 'late').length
        const allDone = open.length === 0
        return (
          <div key={dept} className="tl-row">
            <div className={'tl-label' + (late ? ' is-late' : allDone ? ' is-done' : '')}>
              {dept}
              <small>{ts.length - open.length}/{ts.length}</small>
            </div>
            <div className="tl-track">
              <div className="tl-grid" />
              <div
                className={'tl-span' + (allDone ? ' done' : late ? ' late' : '')}
                style={{ left: pos(first) + '%', width: Math.max(pos(last) - pos(first), 0.8) + '%' }}
              />
              {groupByDate(ts, today).map(g => {
                const on = sel && sel.dept === dept && sel.date === g.date
                return (
                <span
                  key={g.date}
                  role="button"
                  tabIndex={0}
                  className={'tl-dot ' + g.tone + (on ? ' on' : '')}
                  style={{ left: pos(parseDate(g.date)) + '%' }}
                  onClick={() => setSel(on ? null : { dept, date: g.date })}
                  onKeyDown={e => { if (e.key === 'Enter') setSel(on ? null : { dept, date: g.date }) }}
                >
                  {g.items.length > 1 && <b>{g.items.length}</b>}
                </span>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* 오늘선과 목표일선: 라벨 열을 뺀 영역 위에 겹침 */}
      <div className="tl-overlay">
        <div className="tl-label" />
        <div className="tl-track">
          {showToday && (
            <div className="tl-line today" style={{ left: pos(today) + '%' }}><em>오늘</em></div>
          )}
          <div className="tl-line target" style={{ left: pos(target) + '%' }}><em>전환</em></div>
        </div>
      </div>
    </div>
    {sel && selItems.length > 0 && (
      <div className="tl-pop">
        <div className="tl-pop-head">
          <b>{sel.dept} · 마감 {md(parseDate(sel.date))}</b>
          <a className="link" onClick={() => setSel(null)}>닫기</a>
        </div>
        {selItems.map(t => {
          const tone = taskTone(t, today)
          return (
            <div key={t.id} className="tl-pop-item">
              <span className={'badge ' + (tone === 'wait' ? 'ing' : tone)}>{TONE_LABEL[tone]}</span>
              <span>{t.title}</span>
              {t.memo && <div className="muted small-text">“{t.memo}”</div>}
            </div>
          )
        })}
      </div>
    )}
    {!sel && <p className="muted small-text tl-hint">점을 누르면 할 일 내용이 보입니다.</p>}
    </>
  )
}

export function TimelineLegend() {
  return (
    <div className="tl-legend">
      <span><i className="tl-dot done" />완료</span>
      <span><i className="tl-dot na" />해당없음</span>
      <span><i className="tl-dot wait" />대기</span>
      <span><i className="tl-dot soon" />3일 이내</span>
      <span><i className="tl-dot late" />지연</span>
      <span><i className="tl-key today" />오늘</span>
      <span><i className="tl-key target" />전환 목표일</span>
    </div>
  )
}

/* ---------- 타임라인 탭: 진행중 변경 전체 ---------- */
export default function TimelineView({ onOpen }) {
  const [changes, setChanges] = useState(null)
  const [tasks, setTasks] = useState([])
  const [showClosed, setShowClosed] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const a = await supabase.from('change_requests').select('*').order('target_date')
      const b = await supabase.from('tasks').select('id,change_id,department,title,due_date,status,memo')
      if (a.error || b.error) return setErr((a.error || b.error).message)
      setChanges(a.data); setTasks(b.data)
    })()
  }, [])

  if (err) return <p className="err">불러오지 못했습니다: {err}</p>
  if (!changes) return <p className="muted">불러오는 중…</p>

  const today = todayMidnight()
  const list = changes.filter(c => showClosed || c.status === '진행중')

  return (
    <div>
      <div className="tl-head">
        <p className="muted">
          진행중 변경 {changes.filter(c => c.status === '진행중').length}건 · 점 하나가 할 일입니다(숫자는 같은 날 여러 건).
        </p>
        <label className="check">
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> 종결 포함
        </label>
      </div>
      <TimelineLegend />

      {list.length === 0 && <div className="empty">표시할 변경이 없습니다.</div>}

      {list.map(c => {
        const ts = tasks.filter(t => t.change_id === c.id)
        const late = ts.filter(t => taskTone(t, today) === 'late')
        const lateDepts = [...new Set(late.map(t => t.department))]
        const done = ts.filter(t => t.status !== '대기').length
        return (
          <div key={c.id} className="task tl-card">
            <div className="task-top">
              <span className={'badge ' + (c.status === '종결' ? 'done' : 'ing')}>{c.status}</span>
              {lateDepts.length > 0 && <span className="badge late">지연: {lateDepts.join(', ')}</span>}
              <span className="muted">완료 {done}/{ts.length}</span>
            </div>
            <a className="task-title link-title" onClick={() => onOpen(c.id)}>{c.title}</a>
            <ChangeTimeline change={c} tasks={ts} />
          </div>
        )
      })}
    </div>
  )
}
