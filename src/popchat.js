import { useEffect, useState } from 'react'

// 대화 작은 창 (카톡 PC처럼): 방마다 브라우저 창을 하나씩 따로 띄움
// 주소: 앱주소?chat=<방>  (방 = 변경 id 또는 'g:'+묶음 id)

export function popupRoom() {
  try { return new URLSearchParams(location.search).get('chat') } catch (_) { return null }
}
export function popupJump() {
  try {
    const p = new URLSearchParams(location.search)
    const q = p.get('q'), mid = +p.get('mid') || null
    return q ? { q, mid, t: Date.now() } : null
  } catch (_) { return null }
}

const opened = {}                 // 방 → 창 (이 창에서 띄운 것)
const subs = new Set()
const emit = () => subs.forEach(f => f())
const winName = room => 'pruon_chat_' + String(room).replace(/[^\w]/g, '_')
const base = () => location.pathname

let nOpen = 0
// 띄우기. 이미 열린 방이면 그 창을 앞으로 (검색에서 왔으면 그 글로 이동). 팝업이 막히면 false
export function openPopup(room, jump) {
  let w = opened[room]
  if (!w || w.closed) {
    const W = 380, H = 640
    const k = nOpen++ % 6
    const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || 1200) - W - 40 - k * 28)
    const top = Math.max(0, (window.screenY || 0) + 60 + k * 28)
    w = window.open('', winName(room), `popup=yes,width=${W},height=${H},left=${left},top=${top}`)
    if (!w) return false
    let blank = true
    try { blank = !w.location.href || w.location.href === 'about:blank' } catch (_) { blank = true }
    if (blank) {
      let url = base() + '?chat=' + encodeURIComponent(room)
      if (jump && jump.q) url += '&q=' + encodeURIComponent(jump.q) + (jump.mid ? '&mid=' + jump.mid : '')
      w.location.href = url
      jump = null
    }
  }
  if (jump && jump.q) { try { w.postMessage({ type: 'pruon-jump', q: jump.q, mid: jump.mid || null }, location.origin) } catch (_) {} }
  opened[room] = w
  try { w.focus() } catch (_) {}
  emit()
  return true
}

// 이 창에서 띄운 대화 창 중 아직 열려 있는 방 { room: true }
export function useOpenPopups() {
  const calc = () => Object.fromEntries(Object.entries(opened).filter(([, w]) => w && !w.closed).map(([r]) => [r, true]))
  const [st, setSt] = useState(calc)
  useEffect(() => {
    const f = () => setSt(prev => { const n = calc(); return JSON.stringify(n) === JSON.stringify(prev) ? prev : n })
    subs.add(f)
    const t = setInterval(f, 1500)
    return () => { subs.delete(f); clearInterval(t) }
  }, [])
  return st
}

// 창끼리 바로 알리기 (읽음 표시 등)
let bc = null
export function channel() {
  if (bc === null) { try { bc = new BroadcastChannel('pruon-chat') } catch (_) { bc = false } }
  return bc || null
}

// 작은 창 → 원래 앱 창에 "이 제품/묶음/할 일 열어줘"
export function toMain(msg) {
  const o = window.opener
  if (o && !o.closed) {
    try { o.postMessage({ type: 'pruon-go', ...msg }, location.origin); o.focus(); return } catch (_) {}
  }
  window.open(base(), '_blank')
}
