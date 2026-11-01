import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// AI 초안 공통 도우미

// AI 탭을 보여줄지·대외비 단어 (서버 설정). upgrade12 전이면 null → AI 탭 없음
let pubCache = null, pubAt = 0
export function useAiPublic() {
  const [st, setSt] = useState(pubCache)
  useEffect(() => {
    let alive = true
    if (pubCache && Date.now() - pubAt < 60000) return
    supabase.rpc('ai_public').then(({ data, error }) => {
      pubCache = error ? null : data; pubAt = Date.now()
      if (alive) setSt(pubCache)
    })
    return () => { alive = false }
  }, [])
  return st
}
export const resetAiPublic = () => { pubCache = null; pubAt = 0 }

export function newSession() {
  try { return crypto.randomUUID() } catch (_) {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16) })
  }
}

// 입력에 대외비 단어가 있으면 그 단어
export function confHit(text, words) {
  const t = String(text || '').toLowerCase()
  return (words || []).find(w => String(w).trim() && t.includes(String(w).trim().toLowerCase())) || null
}

// 서버 함수 호출 (오류 문구를 그대로 꺼냄)
export async function callDraft(body) {
  const { data, error } = await supabase.functions.invoke('ai-draft', { body })
  if (error) {
    let msg = ''
    try { msg = (await error.context.json()).error } catch (_) {}
    if (!msg && /Failed to send|fetch/i.test(String(error.message))) msg = 'AI 서버에 연결하지 못했습니다. 관리자에게 서버 함수(ai-draft) 설정을 확인해 달라고 해주세요.'
    throw new Error(msg || 'AI가 지금 답할 수 없습니다. 잠시 후 다시 보내주세요.')
  }
  return data
}

export const tkey = t => t.department + '|' + t.title
export const md2 = s => (s ? s.slice(5).replace('-', '/') : '')

// 두 글이 얼마나 비슷한지 (0~1, 글자 두 개씩 묶어 비교)
export function similar(a, b) {
  const g = s => { const x = String(s || '').replace(/\s+/g, ''); const m = new Map(); for (let i = 0; i < x.length - 1; i++) { const k = x.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1) } return m }
  const A = g(a), B = g(b)
  let n = 0, ta = 0, tb = 0
  A.forEach(v => { ta += v }); B.forEach(v => { tb += v })
  A.forEach((v, k) => { n += Math.min(v, B.get(k) || 0) })
  return ta + tb ? (2 * n) / (ta + tb) : 1
}
// 메모 AI 표시: 그대로 = 'ai', 고침 = 'ai_edit', 거의 새로 씀 = 없음
export function memoFlag(text, aiText) {
  const a = String(text || '').trim(), b = String(aiText || '').trim()
  if (!b) return null
  if (a === b) return 'ai'
  return similar(a, b) >= 0.35 ? 'ai_edit' : null
}

// 확인 안 된 질문 → 기본 메모 (AI가 메모를 안 줬을 때)
export function defaultMemo(open) {
  return '확인 필요 메모: ' + open.map(q => q.q).join(', ') + ' — 아직 미확인입니다. 확인되면 여기에 공유하겠습니다.'
}

// 사람이 고친 칸 이름
export const FIELD_LABEL = { title: '제목', desc: '변경 내용', reason: '변경 사유', items: '대상 품목', mode: '관리 방식', target: '전환일', list: '부서별 할 일' }
// 미리보기 칸 → 양식 칸
export const PV2F = { title: 'title', description: 'desc', reason: 'reason', items: 'items', mode: 'mode', target_date: 'target' }
