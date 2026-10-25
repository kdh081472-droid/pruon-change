import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './ctx.jsx'
import { ORDER, SHORT } from './supabase.js'
import { dd, iso, todayMid, stampFull } from './util.js'

// 전체 요약: 모든 변경을 한 표로 (엑셀 내려받기의 "변경" 시트 항목에서 처음전환일 뺌 + 처리 현황)
// 검색은 단어 순서와 상관없이, 머리글마다 정렬·필터

const norm = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '')
const ymd = ts => (ts ? stampFull(ts).slice(0, 10) : '')
const STATUS_CLS = { '진행 중': 'live', '전환일 지남': 'late', 종결: 'done', '중단 종결': 'stop' }

const COLS = [
  { k: 'title', label: '제목', type: 'text', cls: 'c0', w: 240, min: 140 },
  { k: 'status', label: '상태', type: 'cat', w: 104, min: 84 },
  { k: 'pct', label: '처리', type: 'num', unit: '%', numLabel: '처리율 몇 % 이상', w: 130, min: 96 },
  { k: 'target', label: '전환일', type: 'date', w: 100, min: 86 },
  { k: 'desc', label: '변경내용', type: 'text', cls: 'sub', w: 180, min: 80 },
  { k: 'reason', label: '변경사유', type: 'text', cls: 'sub', w: 150, min: 80 },
  { k: 'items', label: '대상품목', type: 'text', cls: 'sub', w: 180, min: 80 },
  { k: 'by', label: '등록자', type: 'cat', sortKey: 'bySort', catSort: 'bySort', cls: 'sub1', w: 116, min: 80 },
  { k: 'reg', label: '등록일', type: 'date', cls: 'subd', w: 90, min: 76 },
  { k: 'closed', label: '종결일', type: 'date', cls: 'subd', w: 90, min: 76 },
]
const colOf = k => COLS.find(c => c.k === k)

function Hl({ text, words }) {
  const s = String(text || '')
  if (!words.length || !s) return s
  const re = new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi')
  return s.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))
}

export default function Summary() {
  const { db, uid, overdue, goChange, ui, setUi, unread, mentionsMe } = useApp()
  // 칸 폭: 내 계정 + 이 PC 브라우저에만 저장 (다른 사람 화면에는 영향 없음)
  const wKey = 'pruon_sumw_' + uid
  const [ws, setWs] = useState(() => {
    try { const o = JSON.parse(localStorage.getItem(wKey) || '{}'); return COLS.map(c => Math.max(c.min, +o[c.k] || c.w)) } catch (_) { return COLS.map(c => c.w) }
  })
  const saveWs = a => { try { localStorage.setItem(wKey, JSON.stringify(Object.fromEntries(COLS.map((c, i) => [c.k, a[i]])))) } catch (_) {} }
  const rz = useRef(null)
  const st = ui.sum || { q: '', sort: { k: 'target', dir: 'asc' }, f: {}, chip: null }
  const setSt = patch => setUi(u => ({ ...u, sum: { ...(u.sum || st), ...patch } }))
  const [pop, setPop] = useState(null)        // { k, x, y }
  const tw = useRef(null)

  // 표에 쓰는 줄 (엑셀 "변경" 시트와 같은 값)
  const rows = useMemo(() => db.changes.map(c => {
    const n = c.tasks.length, d = c.tasks.filter(t => t.status !== '대기').length
    const p = db.people[c.created_by]
    const dept = (p && p.department) || c.created_by_dept || ''
    const di = ORDER.indexOf(dept)
    // 남은 부서: 부서 순서 고정, '구매 1 · 생산 1'
    const rem = {}
    c.tasks.forEach(t => { if (t.status === '대기') rem[t.department] = (rem[t.department] || 0) + 1 })
    const remList = ORDER.filter(x => rem[x]).concat(Object.keys(rem).filter(x => !ORDER.includes(x))).map(x => [x, rem[x]])
    const u = unread(c.id)
    const status = c.status === '종결' ? (c.close_type === '중단' ? '중단 종결' : '종결') : overdue(c) ? '전환일 지남' : '진행 중'
    return {
      id: c.id, title: c.title, status, done: d, total: n, pct: n ? Math.round((d / n) * 100) : 0,
      target: c.target_date,
      desc: c.description || '', reason: c.reason || '', items: c.itemsText === '-' ? '' : c.itemsText,
      by: p ? `${p.name} (${SHORT[dept] || dept})` : (c.created_by_dept || ''),
      bySort: String(di < 0 ? 99 : di).padStart(2, '0') + ' ' + (p ? p.name : ''),
      left: c.status === '종결' ? '' : remList.map(([x, k]) => x + ' ' + k).join(' · '),
      remList: c.status === '종결' ? [] : remList, leftN: c.status === '종결' ? '' : remList.reduce((a, x) => a + x[1], 0),
      chat: u.length, chatAt: u.some(mentionsMe),
      reg: ymd(c.created_at), closed: ymd(c.closed_at), stop: c.close_reason || '',
    }
  }), [db, overdue, unread, mentionsMe])

  const words = st.q.trim().split(/\s+/).filter(Boolean)
  const list = useMemo(() => {
    const ws = words.map(norm)
    const out = rows.filter(r => {
      if (st.chip && r.status !== st.chip) return false
      if (st.onlyNew && !r.chat) return false
      if (ws.length) {
        const hay = norm(COLS.map(c => r[c.k]).join(' ') + ' ' + r.stop)
        if (!ws.every(w => hay.includes(w))) return false        // 단어 순서 상관없이 모두 포함
      }
      for (const [k, f] of Object.entries(st.f)) {
        const v = r[k]
        if (f.vals && !f.vals.includes(String(v))) return false
        if (f.text && !norm(v).includes(norm(f.text))) return false
        if (f.from && (!v || v < f.from)) return false
        if (f.to && (!v || v > f.to)) return false
        if (f.min != null && v < f.min) return false
      }
      return true
    })
    const { k, dir } = st.sort
    const sk = (colOf(k) && colOf(k).sortKey) || k
    return out.sort((a, b) => {
      const va = a[sk], vb = b[sk]
      const ea = va === '' || va == null, eb = vb === '' || vb == null
      if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1          // 빈 칸은 항상 아래로
      const d = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ko')
      return dir === 'asc' ? d : -d
    })
  }, [rows, st])

  useEffect(() => {
    if (!pop) return
    const close = e => { if (!e.target.closest('.sum-pop') && !e.target.closest('.sum-hb')) setPop(null) }
    const esc = e => { if (e.key === 'Escape') setPop(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    window.addEventListener('resize', () => setPop(null), { once: true })
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [pop])

  // 머리글 바로 아래에 창을 둠 (표를 옆으로 밀어도 따라감)
  const place = k => {
    const el = tw.current && tw.current.querySelector(`th[data-k="${k}"] .sum-hb`)
    if (!el) return setPop(null)
    const rc = el.getBoundingClientRect()
    setPop({ k, x: Math.max(8, Math.min(rc.left, window.innerWidth - 308)), y: rc.bottom + 4 })
  }
  const openPop = k => {
    if (pop && pop.k === k) return setPop(null)
    place(k)
  }
  const cnt = s => rows.filter(r => r.status === s).length
  const anyFilter = st.q || st.chip || st.onlyNew || Object.keys(st.f).length
  const newN = rows.filter(r => r.chat).length
  const today = iso(todayMid())

  const cell = (r, c) => {
    const v = r[c.k]
    if (c.k === 'title') return <td key={c.k} className="c0"><div className="cl2"><b><Hl text={v} words={words} /></b>{r.chat > 0 && <span className="tdot" title={'안 읽은 대화 ' + r.chat + '개' + (r.chatAt ? ' (나를 부른 글 있음)' : '')}>{r.chatAt ? '@' : ''}{r.chat}</span>}</div></td>
    if (c.k === 'status') return <td key={c.k} className="ctr"><span className={'sst ' + STATUS_CLS[v]}>{v}</span></td>
    if (c.k === 'pct') return <td key={c.k}><span className={'spg' + (r.status === '전환일 지남' ? ' late' : '')}><i><em style={{ width: v + '%' }} /></i>{r.done}/{r.total}</span></td>
    if (c.k === 'target') {
      const n = dd(v), live = r.status === '진행 중' || r.status === '전환일 지남'
      return <td key={c.k} className="num ctr k">{v.slice(2).replace(/-/g, '.')}{live && <span className={'tdd' + (n < 0 || n <= 7 ? ' hot' : '')}>{n === 0 ? 'D-day' : n > 0 ? 'D-' + n : 'D+' + -n}</span>}</td>
    }
    if (c.type === 'date') return <td key={c.k} className="num ctr subd">{v ? v.slice(2).replace(/-/g, '.') : '-'}</td>
    return <td key={c.k} className={c.cls || 'nw'}>{v ? <div className={c.cls === 'sub1' ? 'cl1' : 'cl2'}><Hl text={v} words={words} /></div> : <span className="faint">-</span>}</td>
  }

  return (
    <div className="sum">
      <div className="sum-chips">
        {[['진행 중', ''], ['전환일 지남', 'late'], ['종결', ''], ['중단 종결', '']].map(([s, cl]) => (
          <button key={s} type="button" className={'sum-chip ' + cl + (st.chip === s ? ' on' : '')} onClick={() => setSt({ chip: st.chip === s ? null : s })}>{s}<b>{cnt(s)}</b></button>
        ))}
        <button type="button" className={'sum-chip' + (!st.chip ? ' on' : '')} onClick={() => setSt({ chip: null })}>전체<b>{rows.length}</b></button>
        <button type="button" className={'sum-chip nw-chip' + (st.onlyNew ? ' on' : '')} onClick={() => setSt({ onlyNew: !st.onlyNew })}>새 대화 있는 것만<b>{newN}</b></button>
      </div>
      <div className="sum-tools">
        <label className="search sum-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="search" value={st.q} onChange={e => setSt({ q: e.target.value })} placeholder="검색 (단어 순서 상관없음)" autoComplete="off" aria-label="전체 요약 검색" />
        </label>
        <button type="button" className="btn sm ghost" disabled={!anyFilter} onClick={() => { setSt({ q: '', chip: null, onlyNew: false, f: {} }); setPop(null) }}>필터 모두 지우기</button>
        <span className="sum-count"><b>{list.length}</b> / {rows.length}건</span>
        <button type="button" className="btn sm ghost sum-wreset" title="머리글 사이 세로선을 끌면 칸 폭을 바꿀 수 있습니다 (내 화면에만 저장)" onClick={() => { const a = COLS.map(c => c.w); setWs(a); saveWs(a) }}>칸 폭 기본으로</button>
      </div>
      {Object.keys(st.f).length > 0 && (
        <div className="sum-active">
          {Object.entries(st.f).map(([k, f]) => {
            const d = f.vals ? (f.vals[0] === '__none__' ? '선택 없음' : f.vals.join(', ')) : f.text ? `"${f.text}" 포함` : f.min != null ? `${f.min}${colOf(k).unit || ''} 이상` : `${f.from || '처음'} ~ ${f.to || '끝'}`
            return <button key={k} type="button" className="sum-af" onClick={() => { const nf = { ...st.f }; delete nf[k]; setSt({ f: nf }) }}>{colOf(k).label}: {d} <span aria-hidden="true">×</span></button>
          })}
        </div>
      )}
      <div className="sum-tw" ref={tw} onScroll={() => pop && place(pop.k)}>
        <table className="sum-t" style={{ width: ws.reduce((a, b) => a + b, 0) }}>
          <colgroup>{COLS.map((c, i) => <col key={c.k} style={{ width: ws[i] }} />)}</colgroup>
          <thead>
            <tr>
              {COLS.map((c, ci) => {
                const f = st.f[c.k], s = st.sort.k === c.k
                return (
                  <th key={c.k} data-k={c.k} className={(c.cls === 'c0' ? 'c0 ' : '') + (f ? 'f ' : '') + (s ? 's' : '')}>
                    <button type="button" className="sum-hb" aria-label={c.label + ' 정렬·필터'} onClick={() => openPop(c.k)}>
                      {c.label}<span className="ic">{s ? (st.sort.dir === 'asc' ? '▲' : '▼') : f ? '●' : '▾'}{s && f ? ' ●' : ''}</span>
                    </button>
                    <span className={'sum-rz' + (rz.current && rz.current.i === ci ? ' on' : '')} role="separator" aria-orientation="vertical" aria-label={c.label + ' 칸 폭 조절'}
                      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {} rz.current = { i: ci, x: e.clientX, w0: ws[ci] } }}
                      onPointerMove={e => { const d = rz.current; if (!d || d.i !== ci) return; const nw = Math.max(c.min, Math.round(d.w0 + e.clientX - d.x)); if (nw !== ws[ci]) setWs(a => { const b = a.slice(); b[ci] = nw; return b }) }}
                      onPointerUp={e => { try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) {} if (rz.current) { rz.current = null; setWs(a => { saveWs(a); return a.slice() }) } }}
                      onDoubleClick={e => { e.stopPropagation(); setWs(a => { const b = a.slice(); b[ci] = c.w; saveWs(b); return b }) }} />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {list.map(r => <tr key={r.id} className={r.status === '종결' || r.status === '중단 종결' ? 'fin' : ''} onClick={() => goChange(r.id)}>{COLS.map(c => cell(r, c))}</tr>)}
            {!list.length && <tr><td colSpan={COLS.length} className="sum-empty">조건에 맞는 변경이 없습니다. 검색어를 줄이거나 필터를 지워보세요.</td></tr>}
          </tbody>
        </table>
      </div>
      {pop && <FilterPop key={pop.k} col={colOf(pop.k)} rows={rows} st={st} setSt={setSt} pos={pop} close={() => setPop(null)} />}
    </div>
  )
}

/* 머리글 창: 오름차순·내림차순 + 열 종류별 필터 */
function FilterPop({ col, rows, st, setSt, pos, close }) {
  const f = st.f[col.k] || {}
  const counts = useMemo(() => {
    const m = {}
    rows.forEach(r => { const v = String(r[col.k]); m[v] = (m[v] || 0) + 1 })
    return m
  }, [rows, col.k])
  const skey = useMemo(() => {
    const m = {}
    if (col.catSort) rows.forEach(r => { m[String(r[col.k])] = r[col.catSort] })
    return m
  }, [rows, col.k, col.catSort])
  const all = Object.keys(counts).sort((a, b) => (col.catSort ? String(skey[a]).localeCompare(String(skey[b]), 'ko') : a.localeCompare(b, 'ko')))
  const [vals, setVals] = useState(f.vals ? f.vals.filter(v => v !== '__none__') : all)
  const [find, setFind] = useState('')
  const [text, setText] = useState(f.text || '')
  const [from, setFrom] = useState(f.from || '')
  const [to, setTo] = useState(f.to || '')
  const [min, setMin] = useState(f.min != null ? String(f.min) : '')
  const ref = useRef(null)
  const [top, setTop] = useState(pos.y)
  useEffect(() => {
    const h = ref.current ? ref.current.offsetHeight : 0
    setTop(Math.max(8, Math.min(pos.y, window.innerHeight - h - 8)))
    const first = ref.current && ref.current.querySelector('input[type=text], input[type=date]')
    if (first && window.matchMedia('(hover: hover)').matches) first.focus()   // 휴대폰에선 자판이 바로 뜨지 않게
  }, [pos.y])

  const lab = col.type === 'date' ? ['오래된 순', '최근 순'] : col.type === 'num' ? ['낮은 순', '높은 순'] : ['가나다 순', '역순']
  const sd = st.sort.k === col.k ? st.sort.dir : ''
  const apply = () => {
    const nf = {}
    if (col.type === 'cat') { if (!vals.length) nf.vals = ['__none__']; else if (vals.length < all.length) nf.vals = vals }
    else if (col.type === 'date') { if (from) nf.from = from; if (to) nf.to = to }
    else if (col.type === 'num') { if (min.trim() !== '' && !isNaN(+min)) nf.min = +min }
    else if (text.trim()) nf.text = text.trim()
    const next = { ...st.f }
    if (Object.keys(nf).length) next[col.k] = nf; else delete next[col.k]
    setSt({ f: next }); close()
  }
  const shown = all.filter(v => !find || norm(v).includes(norm(find)))

  return (
    <div className="sum-pop" ref={ref} style={{ left: pos.x, top }} role="dialog" aria-label={col.label + ' 정렬·필터'}
      onKeyDown={e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') apply() }}>
      <div className="srt">
        <button type="button" className={sd === 'asc' ? 'on' : ''} onClick={() => setSt({ sort: { k: col.k, dir: 'asc' } })}>▲ 오름차순<small>{lab[0]}</small></button>
        <button type="button" className={sd === 'desc' ? 'on' : ''} onClick={() => setSt({ sort: { k: col.k, dir: 'desc' } })}>▼ 내림차순<small>{lab[1]}</small></button>
      </div>
      {col.type === 'cat' && (
        <>
          <h4>값 고르기</h4>
          <input type="text" value={find} onChange={e => setFind(e.target.value)} placeholder="목록에서 찾기" autoComplete="off" aria-label="값 찾기" />
          <div className="vals">
            <label><input type="checkbox" checked={vals.length === all.length} onChange={e => setVals(e.target.checked ? all : [])} />모두 선택</label>
            {shown.map(v => (
              <label key={v}>
                <input type="checkbox" checked={vals.includes(v)} onChange={e => setVals(e.target.checked ? [...vals, v] : vals.filter(x => x !== v))} />
                <span className="vt">{v || '(빈 칸)'}</span><span className="n">{counts[v]}</span>
              </label>
            ))}
          </div>
        </>
      )}
      {col.type === 'date' && (
        <>
          <h4>기간</h4>
          <div className="rng">
            <label><span>부터</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label><span>까지</span><input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
          </div>
        </>
      )}
      {col.type === 'num' && (
        <>
          <h4>{col.numLabel || '몇 이상'}</h4>
          <input type="text" inputMode="numeric" value={min} onChange={e => setMin(e.target.value)} placeholder="예: 50" />
        </>
      )}
      {col.type === 'text' && (
        <>
          <h4>포함하는 글자</h4>
          <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="예: 포장지" autoComplete="off" />
        </>
      )}
      <div className="ft">
        <button type="button" className="btn sm ghost" onClick={() => { const next = { ...st.f }; delete next[col.k]; setSt({ f: next }); close() }}>이 열 필터 지우기</button>
        <button type="button" className="btn sm" onClick={apply}>적용</button>
      </div>
    </div>
  )
}
