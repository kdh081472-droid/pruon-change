import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { ICON } from './ctx.jsx'

// 사용법 도우미 (AI): 질문은 서버 함수 help-bot → Claude. 대화는 창을 닫으면 지워짐
const SUGGEST = ['할 일은 어떻게 처리해요?', '전환일이 지나면 어떻게 돼요?', '다른 부서에 할 일 배정하려면?', '잘못 처리한 걸 되돌리고 싶어요']

// **굵게**, 번호·글머리 줄만 간단히 보여줌
function Rich({ text }) {
  return String(text).split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, j) =>
      p.startsWith('**') && p.endsWith('**') ? <b key={j}>{p.slice(2, -2)}</b>
        : p.startsWith('`') && p.endsWith('`') ? <code key={j}>{p.slice(1, -1)}</code> : p)
    const li = /^\s*(\d+\.|[-•·])\s/.test(line)
    return <div key={i} className={li ? 'hb-li' : line.trim() ? '' : 'hb-gap'}>{parts}</div>
  })
}

export default function HelpBot({ onClose, full }) {
  const [msgs, setMsgs] = useState([])          // {role, content, err?}
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [st, setSt] = useState(null)
  const listRef = useRef(null)
  const inRef = useRef(null)

  useEffect(() => { supabase.rpc('help_status').then(({ data }) => data && setSt(data)) }, [])
  useEffect(() => { inRef.current && inRef.current.focus() }, [])
  useEffect(() => { const el = listRef.current; el && el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }, [msgs, busy])
  useEffect(() => {
    const on = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  }, [onClose])

  const totalLeft = st ? Math.max(0, st.total_limit - st.total_used) : null
  const mineLeft = st ? Math.max(0, st.mine_limit - st.mine_used) : null
  const out = st && (totalLeft <= 0 || mineLeft <= 0)

  async function ask(textIn) {
    const q = (textIn ?? draft).trim()
    if (!q || busy) return
    if (q.length > 1000) return setMsgs(m => [...m, { role: 'assistant', content: '질문은 1000자 이하로 써주세요.', err: true }])
    const next = [...msgs.filter(m => !m.err), { role: 'user', content: q }]
    setMsgs(m => [...m, { role: 'user', content: q }])
    setDraft('')
    setBusy(true)
    let answer = '', err = false
    try {
      const { data, error } = await supabase.functions.invoke('help-bot', { body: { messages: next.map(({ role, content }) => ({ role, content })) } })
      if (error) {
        let msg = ''
        try { msg = (await error.context.json()).error } catch (_) {}
        throw new Error(msg || '도우미가 지금 답할 수 없습니다. 잠시 후 다시 시도해주세요.')
      }
      answer = data.answer
      setSt(s => (s ? { ...s, total_used: s.total_limit - data.total_left, mine_used: s.mine_limit - data.mine_left } : s))
    } catch (e) {
      answer = String((e && e.message) || e)
      err = true
      supabase.rpc('help_status').then(({ data }) => data && setSt(data))
    }
    setMsgs(m => [...m, { role: 'assistant', content: answer, err }])
    setBusy(false)
    setTimeout(() => inRef.current && inRef.current.focus(), 50)
  }

  return (
    <>
      {full && <div className="scrim" onClick={onClose} />}
      <div className={'helpbot' + (full ? ' full' : '')} role="dialog" aria-label="사용법 도우미">
        <div className="hb-h">
          <span className="hb-ic" aria-hidden="true">{ICON.help}</span>
          <div className="hb-t"><b>사용법 도우미</b><span>앱 사용법을 물어보세요 · AI 답변은 틀릴 수 있어요</span></div>
          <button type="button" className="s-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="hb-list" ref={listRef}>
          <div className="hb-a first">
            <div className="hb-who">도우미</div>
            안녕하세요. 변경점 관리 앱 사용법을 알려드려요. 궁금한 걸 편하게 물어보세요.
            <div className="hb-sg">{SUGGEST.map(s => <button key={s} type="button" disabled={busy || out} onClick={() => ask(s)}>{s}</button>)}</div>
          </div>
          {msgs.map((m, i) => m.role === 'user'
            ? <div key={i} className="hb-q">{m.content}</div>
            : <div key={i} className={'hb-a' + (m.err ? ' err' : '')}><div className="hb-who">도우미</div><Rich text={m.content} /></div>)}
          {busy && <div className="hb-a typing"><div className="hb-who">도우미</div><span className="dots"><i /><i /><i /></span> 답변을 쓰는 중…</div>}
        </div>
        <div className="hb-in">
          <div className="hb-row">
            <textarea ref={inRef} rows={2} value={draft} aria-label="질문" disabled={out}
              placeholder={out ? '오늘 질문 수를 모두 썼습니다. 내일 다시 이용해주세요.' : '예: 전환일은 누가 바꿀 수 있어요?'}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask() } }} />
            <button type="button" className="btn" disabled={busy || out || !draft.trim()} onClick={() => ask()}>묻기</button>
          </div>
          <div className="hb-foot">
            <span>{st ? <>오늘 회사 전체 남은 질문 <b>{totalLeft}</b> / {st.total_limit} · 내 남은 질문 <b>{mineLeft}</b></> : ' '}</span>
            <span>질문은 이름 없이 저장되어 설명서 개선에 쓰여요</span>
          </div>
        </div>
      </div>
    </>
  )
}
