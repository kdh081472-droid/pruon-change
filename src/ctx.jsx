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
      <b>{p.name}</b>
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
  if (inline) return <>{p.name} · <span className="re">{p.email}</span> · {p.department}</>
  return <>{p.name}<br /><span className="re">{p.email}</span><br />{p.department}</>
}

export function personName(db, id) {
  const p = id && db.people[id]
  return p ? p.name : '알 수 없음'
}

// 대화 글: @사람 / @부서 강조
export function MsgText({ m }) {
  const { db, me } = useApp()
  const names = (m.mention_users || []).map(u => db.people[u]).filter(Boolean)
  const tokens = [...names.map(p => p.name), ...(m.mention_depts || [])]
  if (!tokens.length) return <span className="tx">{m.body}</span>
  const re = new RegExp('(@(?:' + tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|') + '))', 'g')
  const parts = m.body.split(re)
  return (
    <span className="tx">
      {parts.map((s, i) => {
        if (i % 2 === 0) return s
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
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" /></svg>,
}
