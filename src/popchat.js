import { useEffect, useState } from 'react'

// 대화 작은 창 (카톡 PC처럼): 방마다 브라우저 창을 하나씩 따로 띄움
// 주소: 앱주소?chat=<방>  (방 = 변경 id 또는 'g:'+묶음 id)

export function popupRoom() {
  try { return new URLSearchParams(location.search).get('chat') } catch (_) { return null }
}
// 대화 목록 창 (앱주소?chats=1)
export function popupList() {
  try { return new URLSearchParams(location.search).get('chats') === '1' } catch (_) { return false }
}
let listWin = null
export function openListPopup() {
  if (!listWin || listWin.closed) {
    const W = 380, H = 760
    const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || 1200) - W - 440)
    const top = Math.max(0, (window.screenY || 0) + 40)
    listWin = window.open('', 'pruon_chat_list', `popup=yes,width=${W},height=${H},left=${left},top=${top}`)
    if (!listWin) return false
    let blank = true
    try { blank = !listWin.location.href || listWin.location.href === 'about:blank' } catch (_) { blank = true }
    if (blank) listWin.location.href = base() + '?chats=1'
  }
  try { listWin.focus() } catch (_) {}
  return true
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

// 다른 창에서 띄운 대화 창도 알 수 있게: 대화 창이 열리고 닫힐 때 알림
const remote = {}                 // 방 → 마지막 알림 시각
let listening = false
function listen() {
  if (listening) return
  const c = channel(); if (!c) return
  listening = true
  c.addEventListener('message', e => {
    const d = e.data || {}
    if (d.type === 'win-open') { remote[d.room] = Date.now(); emit() }
    if (d.type === 'win-close') { delete remote[d.room]; emit() }
  })
  c.postMessage({ type: 'win-ping' })
  // 혹시 닫힘 알림을 못 받았을 때: 10초마다 물어보고 25초 넘게 대답 없는 방은 지움
  setInterval(() => {
    c.postMessage({ type: 'win-ping' })
    const now = Date.now(); let ch = false
    Object.keys(remote).forEach(r => { if (now - remote[r] > 25000) { delete remote[r]; ch = true } })
    if (ch) emit()
  }, 10000)
}
// 대화 창 쪽: 열렸다고 알리고, 물어보면 대답, 닫힐 때 알림
export function announceWindow(room) {
  const c = channel(); if (!c) return () => {}
  const hi = () => c.postMessage({ type: 'win-open', room })
  const on = e => { if ((e.data || {}).type === 'win-ping') hi() }
  const bye = () => c.postMessage({ type: 'win-close', room })
  c.addEventListener('message', on)
  window.addEventListener('pagehide', bye)
  hi()
  return () => { c.removeEventListener('message', on); window.removeEventListener('pagehide', bye) }
}

// 열려 있는 대화 창의 방 { room: true }
export function useOpenPopups() {
  listen()
  const calc = () => ({
    ...Object.fromEntries(Object.keys(remote).map(r => [r, true])),
    ...Object.fromEntries(Object.entries(opened).filter(([, w]) => w && !w.closed).map(([r]) => [r, true])),
  })
  const [st, setSt] = useState(calc)
  useEffect(() => {
    const f = () => setSt(prev => { const n = calc(); return JSON.stringify(Object.keys(n).sort()) === JSON.stringify(Object.keys(prev).sort()) ? prev : n })
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
// 앱 창은 이름(pruon_main)으로 찾음 (창을 띄운 순서·opener에 기대지 않음).
// 앱 창이 없으면 앱처럼 보이는 새 창으로 열면서 바로 그 화면으로 (?go=종류:id)
export const MAIN_NAME = 'pruon_main'
export function toMain(msg) {
  const url = base() + '?go=' + msg.kind + ':' + encodeURIComponent(msg.id)
  let w = null
  // 앱 창이 꺼져 있으면 새로 띄움: 브라우저 탭이 아니라 앱처럼 보이는 창(주소창·탭 없이)으로, 화면 크기만큼
  const W = Math.max(1200, (screen.availWidth || 1440) - 40), H = Math.max(700, (screen.availHeight || 900) - 40)
  try { w = window.open('', MAIN_NAME, `popup=yes,width=${W},height=${H},left=20,top=20`) } catch (_) { w = null }
  if (w) {
    let blank = true
    try { blank = !w.location.href || w.location.href === 'about:blank' } catch (_) { blank = false }
    if (blank) { w.location.href = url; return }
    try { w.postMessage({ type: 'pruon-go', ...msg }, location.origin) } catch (_) {}
    try { w.focus() } catch (_) {}
    return
  }
  // 새 창도 못 열면(팝업 차단) 열려 있는 앱 창에 알림만
  const c = channel(); if (c) c.postMessage({ type: 'pruon-go', ...msg })
}
// ?go=change:<id> 로 열린 경우
export function goParam() {
  try {
    const g = new URLSearchParams(location.search).get('go')
    if (!g) return null
    const i = g.indexOf(':')
    return i > 0 ? { kind: g.slice(0, i), id: g.slice(i + 1) } : null
  } catch (_) { return null }
}
