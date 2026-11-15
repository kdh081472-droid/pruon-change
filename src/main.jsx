import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// 예상 못 한 오류가 나도 흰 화면 대신 안내를 보여줌
class Safety extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) { try { console.error('화면 오류', err) } catch (_) {} }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>푸르온 변경점 관리</h1>
          <h2>화면을 보여주지 못했습니다</h2>
          <p>일시적인 문제일 수 있습니다. 아래 버튼으로 다시 불러오면 대부분 해결됩니다. 저장된 내용은 그대로 있습니다.</p>
          <button type="button" onClick={() => { try { window.history.replaceState(null, '') } catch (_) {} window.location.reload() }}>다시 불러오기</button>
          <p className="muted small-text">계속 같은 화면이 나오면 관리자에게 알려주면 됩니다. ({String(this.state.err && this.state.err.message || this.state.err).slice(0, 120)})</p>
        </div>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Safety><App /></Safety>
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
    if (document.querySelector('.sheet, .rp, .chat:not(.docked), .helpbot .hb-q')) return true   // 열린 창, 도우미와 나누던 대화
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
