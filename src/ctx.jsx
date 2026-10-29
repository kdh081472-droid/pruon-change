import { createContext, useContext, useEffect, useState } from 'react'
import { SHORT } from './supabase.js'

export const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

// 창 너비 (PC 넓은 화면 판단용)
export function useWidth() {
  const [w, setW] = useState(window.innerWidth)
  useEffect(() => {
    let t
    const on = () => { clearTimeout(t); t = setTimeout(() => setW(window.innerWidth), 120) }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}
export const WIDE = 1100

function local(email) {
  return String(email || '').split('@')[0]
}

// 이름 · 이메일 ID · 부서  (예: 김동현 kdh 개발)
export function Person({ id, fallback }) {
  const { db } = useApp()
  const p = id && db.people[id]
  if (!p) return <span>{fallback || '-'}</span>
  return (
    <span className="pn">
      <b>{p.name}</b>{p.left_at && <span className="pn-x">(퇴사)</span>}
      <span className="pn-e" title={p.email}>{local(p.email)}</span>
      <span className="pn-d">{SHORT[p.department] || p.department}</span>
    </span>
  )
}

// 보고서용 (줄여 쓰지 않음)
export function PersonR({ id, inline, fallback }) {
  const { db } = useApp()
  const p = id && db.people[id]
  if (!p) return <>{fallback || '-'}</>
  const nm = p.name + (p.left_at ? ' (퇴사)' : '')
  if (inline) return <>{nm} · <span className="re">{p.email}</span> · {p.department}</>
  return <>{nm}<br /><span className="re">{p.email}</span><br />{p.department}</>
}

export function personName(db, id) {
  const p = id && db.people[id]
  return p ? p.name : '알 수 없음'
}

// 대화 글: @사람 / @부서 강조
// 검색어 표시 (대화 검색)
export function Mark({ text, q }) {
  const s = String(text || '')
  const ws = String(q || '').trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!ws.length) return s
  const re = new RegExp('(' + ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi')
  return s.split(re).map((p, i) => (i % 2 ? <mark key={i} className="q-hl">{p}</mark> : p))
}

export function MsgText({ m, q }) {
  const { db, me } = useApp()
  const names = (m.mention_users || []).map(u => db.people[u]).filter(Boolean)
  const tokens = [...names.map(p => p.name), ...(m.mention_depts || [])]
  if (!tokens.length) return <span className="tx"><Mark text={m.body} q={q} /></span>
  const re = new RegExp('(@(?:' + tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|') + '))', 'g')
  const parts = m.body.split(re)
  return (
    <span className="tx">
      {parts.map((s, i) => {
        if (i % 2 === 0) return <Mark key={i} text={s} q={q} />
        const t = s.slice(1)
        const isMe = t === me.department || (t === me.name && (m.mention_users || []).includes(me.id))
        return <span key={i} className={'at' + (isMe ? ' me' : '')}>{s}</span>
      })}
    </span>
  )
}

export const ICON = {
  mine: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></svg>,
  org: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-2h12v2" /></svg>,
  timeline: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h10M4 12h16M4 18h7" /><circle cx="17" cy="6" r="2" /><circle cx="14" cy="18" r="2" /></svg>,
  late: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  new: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  key: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></svg>,
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>,
  table: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></svg>,
  help: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01" /></svg>,
  stat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" /></svg>,
}
