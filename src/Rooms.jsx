import { useMemo, useState } from 'react'
import { useApp, Mark, Person } from './ctx.jsx'
import { snip, hasAll } from './util.js'
import { openPopup, useOpenPopups } from './popchat.js'

// 대화방 목록 (카톡식): 최근 대화순 · 묶음은 한 줄로 접고 펼치면 묶음 전체 대화 + 품목 방 · 종결된 방도 포함
// room = 변경(품목) id 또는 'g:' + 묶음 id

const FILTERS = [['all', '전체'], ['unread', '안 읽음'], ['live', '진행 중'], ['fin', '종결']]

function when(ts) {
  if (!ts) return ''
  const d = new Date(ts), now = new Date()
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, now)) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (same(d, y)) return '어제'
  return (d.getMonth() + 1) + '/' + d.getDate()
}

// 방 정보 (목록·검색·안 읽은 수 공용)
export function useRooms() {
  const { db, unread, mentionsMe } = useApp()
  return useMemo(() => {
    const last = {}
    db.messages.forEach(m => { if (!m.deleted && (!last[m.room] || last[m.room].id < m.id)) last[m.room] = m })
    const info = room => {
      const u = unread(room)
      return { room, last: last[room] || null, un: u.length, at: u.some(mentionsMe) }
    }
    const entries = []
    db.groups.forEach(g => {
      const gr = { ...info('g:' + g.id), isG: true, title: g.title, g, open: g.kids.some(k => k.status === '진행중') }
      const kids = g.kids.map(k => ({ ...info(k.id), title: k.title, c: k, open: k.status === '진행중' }))
      const all = [gr, ...kids]
      const lastAll = all.map(x => x.last).filter(Boolean).sort((a, b) => b.id - a.id)[0] || null
      entries.push({
        key: 'g:' + g.id, isGroup: true, g, title: g.title, groupRoom: gr, kids,
        last: lastAll, un: all.reduce((a, x) => a + x.un, 0), at: all.some(x => x.at), open: gr.open, created: g.created_at,
      })
    })
    db.changes.filter(c => !c.group).forEach(c => {
      entries.push({ key: c.id, ...info(c.id), title: c.title, c, open: c.status === '진행중', created: c.created_at })
    })
    const byLast = (a, b) => {
      if (a.last && b.last) return b.last.id - a.last.id
      if (a.last) return -1
      if (b.last) return 1
      return String(b.created || '').localeCompare(String(a.created || ''))
    }
    entries.sort(byLast)
    entries.forEach(e => { if (e.kids) e.kids.sort(byLast) })
    const total = entries.reduce((a, e) => a + e.un, 0)
    return { entries, total, byLast }
  }, [db, unread, mentionsMe])
}

// dbl: PC 대화 탭 — 한 번 클릭은 고르기만(onSel), 더블클릭·Enter로 열기(onPick)
export const pickProps = (dbl, onSel, onPick) => dbl ? {
  onClick: onSel,
  onDoubleClick: onPick,
  onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); onPick() } },
} : { onClick: onPick }

function Row({ x, sel, onPick, onSel, dbl, sub, lead, isOpen }) {
  const { db } = useApp()
  const p = x.last && db.people[x.last.user_id]
  return (
    <button type="button" className={'rm-i' + (sel === x.room ? ' sel' : '') + (sub ? ' sub' : '') + (x.open ? '' : ' fin')}
      {...pickProps(dbl, () => (onSel || onPick)(x.room), () => onPick(x.room))}>
      {lead}
      <span className={'rm-ic' + (x.isG ? ' g' : '') + (x.open ? '' : ' x')} aria-hidden="true">{x.isG ? '▣' : '●'}</span>
      <span className="rm-b">
        <span className="rm-t">{!x.open && <span className="rm-fin">종결</span>}{sub && x.isG ? '묶음 전체 대화' : x.title}{isOpen && <span className="rm-win">↗ 창 열림</span>}</span>
        <span className="rm-m">{x.last ? <>{p ? p.name : '알 수 없음'}: {snip(x.last.body, 40)}</> : <span className="faint">아직 대화가 없습니다</span>}</span>
      </span>
      <span className="rm-r">
        <small>{x.last ? when(x.last.created_at) : ''}</small>
        <span className="rm-n">{x.at && <span className="rm-at">@</span>}{x.un > 0 && <span className="rm-un">{x.un > 999 ? '999+' : x.un}</span>}</span>
      </span>
    </button>
  )
}

export function RoomList({ sel, onPick, onSearchPick, dbl, onSel, opened = {} }) {
  const { db, ui, setUi } = useApp()
  const { entries } = useRooms()
  const st = ui.rooms || { f: 'all', q: '', open: {} }
  const setSt = patch => setUi(u => ({ ...u, rooms: { ...(u.rooms || st), ...patch } }))
  const [q, setQ] = useState(st.q || '')
  const k = q.trim()
  const [selMid, setSelMid] = useState(null)
  const pickSel = room => { setSelMid(null); onSel && onSel(room) }
  const selG = sel && (String(sel).startsWith('g:') ? sel.slice(2) : db.changeMap[sel] && db.changeMap[sel].group_id)

  const shown = entries.filter(e => (
    st.f === 'unread' ? e.un > 0 : st.f === 'live' ? e.open : st.f === 'fin' ? !e.open : true
  ))
  const cnt = { unread: entries.filter(e => e.un > 0).length }

  const roomName = room => {
    if (String(room).startsWith('g:')) { const g = db.groupMap[room.slice(2)]; return g ? { t: g.title + ' · 묶음 전체 대화', tag: '묶음' } : { t: '' } }
    const c = db.changeMap[room]
    return c ? { t: c.title, tag: c.group ? '묶음 품목' : '', g: c.group ? c.group.title : '' } : { t: '' }
  }
  // 검색: 방 이름 + 대화 내용 (종결된 방 포함) · 띄어쓴 낱말이 모두 들어 있으면 순서 상관없이
  const search = useMemo(() => {
    if (!k) return null
    const rooms = []
    entries.forEach(e => {
      if (e.isGroup) {
        if (hasAll(e.title + ' 묶음 전체 대화', k)) rooms.push(e.groupRoom)
        e.kids.forEach(x => { if (hasAll(x.title + ' ' + e.title, k)) rooms.push(x) })
      } else if (hasAll(e.title, k)) rooms.push(e)
    })
    // 대화 내용: 글 + 그 방 이름을 합쳐서 찾음 (예: "풀무원 원산지")
    const msgs = db.messages.filter(m => {
      if (m.deleted) return false
      const rn = roomName(m.room)
      return hasAll(m.body + ' ' + rn.t + ' ' + (rn.g || ''), k)
    }).sort((a, b) => b.id - a.id).slice(0, 200)
    return { rooms, msgs }
  }, [k, entries, db])

  return (
    <div className="rl2">
      <div className="rl2-h">
        <label className="search rl2-s">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="search" value={q} onChange={e => { setQ(e.target.value); setSt({ q: e.target.value }) }} placeholder="방 이름·대화 내용 검색" aria-label="대화 검색" autoComplete="off" />
        </label>
        {!k && (
          <div className="rl2-f" role="group" aria-label="대화방 거르기">
            {FILTERS.map(([v, t]) => (
              <button key={v} type="button" className={'sum-chip' + (st.f === v ? ' on' : '')} aria-pressed={st.f === v} onClick={() => setSt({ f: v })}>
                {t}{v === 'unread' && cnt.unread > 0 && <b>{cnt.unread}</b>}
              </button>
            ))}
          </div>
        )}
        {k && <p className="rl2-sum">"{k}" 검색 결과 · 방 {search.rooms.length} · 대화 {search.msgs.length}{search.msgs.length >= 200 ? '+' : ''} (종결된 방 포함)</p>}
      </div>
      <div className="rl2-list">
        {k ? (
          <>
            <div className="rl2-sec">방 이름 {search.rooms.length}</div>
            {search.rooms.map(x => <Row key={'r' + x.room} x={{ ...x, title: x.isG ? x.title + ' · 묶음 전체 대화' : x.title }} sel={selMid ? null : sel} dbl={dbl} onSel={pickSel} onPick={r => onSearchPick(r, null, k)} isOpen={opened[x.room]} />)}
            {!search.rooms.length && <div className="rl2-none">없음</div>}
            <div className="rl2-sec">대화 내용 {search.msgs.length}</div>
            {search.msgs.map(m => {
              const rn = roomName(m.room), p = db.people[m.user_id]
              return (
                <button type="button" key={m.id} className={'rm-i rm-hit' + ((dbl ? selMid === m.id : sel === m.room) ? ' sel' : '')}
                  {...pickProps(dbl, () => { onSel && onSel(m.room); setSelMid(m.id) }, () => onSearchPick(m.room, m.id, k))}>
                  <span className="rm-b">
                    <span className="rm-t">{rn.tag && <span className="g-chip g-in">{rn.tag}</span>}<Mark text={rn.t} q={k} />{opened[m.room] && <span className="rm-win">↗ 창 열림</span>}</span>
                    <span className="rm-m wrap"><i>{p ? p.name : ''}:</i> <Mark text={snip(m.body, 90)} q={k} /></span>
                  </span>
                  <span className="rm-r"><small>{when(m.created_at)}</small></span>
                </button>
              )
            })}
            {!search.msgs.length && <div className="rl2-none">없음</div>}
          </>
        ) : shown.length ? shown.map(e => {
          if (!e.isGroup) return <Row key={e.key} x={e} sel={sel} onPick={onPick} dbl={dbl} onSel={pickSel} isOpen={opened[e.room]} />
          const open = st.open && st.open[e.g.id] !== undefined ? st.open[e.g.id] : e.g.id === selG
          const tog = ev => { ev.stopPropagation(); setSt({ open: { ...(st.open || {}), [e.g.id]: !open } }) }
          return (
            <div key={e.key} className={'rm-grp' + (open ? ' open' : '')}>
              <Row x={{ ...e, room: 'g:' + e.g.id, isG: true }} sel={open ? null : sel && selG === e.g.id ? 'g:' + e.g.id : null}
                dbl={dbl} onSel={() => { if (!open) setSt({ open: { ...(st.open || {}), [e.g.id]: true } }); pickSel('g:' + e.g.id) }}
                onPick={() => { if (!open) setSt({ open: { ...(st.open || {}), [e.g.id]: true } }); onPick('g:' + e.g.id) }}
                lead={<span className="rm-tog" role="button" tabIndex={0} aria-label={open ? '품목 접기' : '품목 펼치기'} aria-expanded={open} onClick={tog} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') tog(ev) }}>{open ? '▾' : '▸'}</span>} />
              {open && <>
                <Row x={e.groupRoom} sel={sel} onPick={onPick} dbl={dbl} onSel={pickSel} sub isOpen={opened[e.groupRoom.room]} />
                {e.kids.map(x => <Row key={x.room} x={x} sel={sel} onPick={onPick} dbl={dbl} onSel={pickSel} sub isOpen={opened[x.room]} />)}
              </>}
            </div>
          )
        }) : <div className="rl2-none">조건에 맞는 대화방이 없습니다.</div>}
      </div>
    </div>
  )
}

/* ---------- PC 대화 탭: 방 목록 (카톡 PC처럼) · 방을 더블클릭하면 작은 창으로 ---------- */
export default function ChatTab({ inWindow }) {
  const { db, me, ui, setUi, toast } = useApp()
  const opened = useOpenPopups()
  const sel = ui.chatRoom && (String(ui.chatRoom).startsWith('g:') ? db.groupMap[ui.chatRoom.slice(2)] : db.changeMap[ui.chatRoom]) ? ui.chatRoom : null
  const open = (room, jump) => {
    setUi(u => ({ ...u, chatRoom: room }))
    if (!openPopup(room, jump)) toast('팝업이 막혀 있습니다. 주소창 오른쪽의 팝업 차단 표시를 눌러 허용해주세요.')
  }
  return (
    <div className="ct ct1">
      <section className="ct-l">
        <div className="ct-lh">대화 <small>{inWindow ? '더블클릭하면 대화 창' : '방을 더블클릭하면 작은 창으로 열립니다'}</small>{inWindow && <span className="ct-me"><Person id={me.id} /></span>}</div>
        <RoomList dbl sel={sel} opened={opened} onSel={room => setUi(u => ({ ...u, chatRoom: room }))}
          onPick={room => open(room)} onSearchPick={(room, mid, q) => open(room, { q, mid })} />
      </section>
    </div>
  )
}
