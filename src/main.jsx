import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// 홈 화면 추가 / PC 바로가기(앱 설치)용
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}

// 새 버전 자동 적용: 서버의 화면 파일이 바뀌면, 사용자가 다른 창에 가 있거나 돌아오는 순간
// (쓰던 글·열린 창이 없을 때만) 조용히 새로고침. 띠나 알림은 띄우지 않음
;(function autoUpdate() {
  const cur = s => { const m = String(s || '').match(/assets\/index-[\w-]+\.js/); return m ? m[0] : null }
  const mine = cur([...document.scripts].map(x => x.src).join(' '))
  if (!mine) return                                   // 개발 모드에선 쓰지 않음
  let pending = false, last = 0
  const busy = () => {
    if (document.querySelector('.sheet, .rp, .chat:not(.docked)')) return true          // 열린 창
    for (const el of document.querySelectorAll('textarea, .nf:not(.my-info) input:not([type=checkbox]), .form input')) {
      if (el.value && el.value.trim()) return true                                          // 쓰던 글
    }
    return false
  }
  const check = async () => {
    if (pending || Date.now() - last < 60000) return pending
    last = Date.now()
    try {
      const r = await fetch('./index.html?v=' + Date.now(), { cache: 'no-store' })
      const next = cur(await r.text())
      if (next && next !== mine) pending = true
    } catch (_) {}
    return pending
  }
  const tryApply = () => { if (pending && !busy()) location.reload() }
  document.addEventListener('visibilitychange', async () => {
    await check()
    tryApply()          // 다른 창으로 갈 때(안 보이는 동안) 또는 돌아오는 순간
  })
  setInterval(async () => { await check(); if (document.hidden) tryApply() }, 10 * 60 * 1000)
})()
