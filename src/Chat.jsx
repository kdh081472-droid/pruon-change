import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase, ORDER, SHORT, SIGNUP_DEPTS } from './supabase.js'
import { useApp, Person, MsgText, personName } from './ctx.jsx'
import { md, norm, parse, snip, stamp, errText } from './util.js'

function tokenAt(el) {
  const b = el.value.slice(0, el.selectionStart)
  const m = b.match(/(^|\s)([/@])([^\s/@]*)$/)
  return m ? { ch: m[2], q: m[3], start: b.length - m[3].length - 1, end: el.selectionStart } : null
}

export default function Chat({ cid, onClose, docked }) {
  const { db, me, uid, C, isLate, unreadCnt, mentionsMe, reload, toast, markReadLocal, openTask } = useApp()
  const c = C(cid)
  const closed = c.status === '종결'
  const list = db.messages.filter(m => m.change_id === cid).sort((a, b) => a.id - b.id)
  const [draft, setDraft] = useState('')
  const [tid, setTid] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [editId, setEditId] = useState(null)
  const [delId, setDelId] = useState(null)
  const [picked, setPicked] = useState([])      // @로 고른 사람 id
  const [pop, setPop] = useState(null)          // {tk, items, i}
  const [ctx, setCtx] = useState(null)          // {mid, x, y}
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const listRef = useRef(null)
  const inRef = useRef(null)
  const lastId = list.length ? list[list.length - 1].id : 0

  // 읽음 처리
  useEffect(() => {
    if (!lastId) return
    if ((db.reads[uid + '|' + cid] || 0) >= lastId) return
    markReadLocal(cid, lastId)
    supabase.rpc('mark_read', { p_change: cid, p_last: lastId })
  }, [lastId, cid, uid, db.reads, markReadLocal])

  // 새 글이 오면 맨 아래로
  useLayoutEffect(() => {
    const L = listRef.current
    if (L) L.scrollTop = L.scrollHeight
  }, [lastId])

  useEffect(() => {
    const on = e => {
      if (e.key !== 'Escape') return
      if (ctx) return setCtx(null)
      if (pop) return
      if (!docked) onClose()
    }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  })

  const focusEnd = () => setTimeout(() => {
    const I = inRef.current
    if (I) { I.focus(); I.setSelectionRange(I.value.length, I.value.length) }
  }, 0)

  function updatePop(el) {
    const tk = tokenAt(el)
    if (!tk) return setPop(null)
    const q2 = norm(tk.q)
    let items
    if (tk.ch === '/') {
      items = [...c.tasks]
        .filter(t => !q2 || norm(t.department + t.title).includes(q2))
        .sort((a, b) => ORDER.indexOf(a.department) - ORDER.indexOf(b.department) || parse(a.due_date) - parse(b.due_date))
        .map(t => ({
          kind: 'task', v: t.id,
          node: <><span className="pd-d">{SHORT[t.department]}</span><span className="pd-t">{t.title}</span><span className={'pd-s' + (isLate(t) ? ' late' : '')}>{t.status === '대기' ? md(t.due_date) : t.status}</span></>,
        }))
    } else {
      items = [
        ...SIGNUP_DEPTS.filter(d => !q2 || d.includes(tk.q)).map(d => ({
          kind: 'dept', v: d, node: <><span className="pd-d">부서</span><span className="pd-t">@{d} <small>부서 전원</small></span></>,
        })),
        ...db.profiles.filter(p => p.id !== uid && (!q2 || norm(p.name + p.email + p.department).includes(q2)))
          .sort((a, b) => SIGNUP_DEPTS.indexOf(a.department) - SIGNUP_DEPTS.indexOf(b.department) || a.name.localeCompare(b.name))
          .map(p => ({
            kind: 'user', v: p.id, name: p.name,
            node: <><span className="pd-d">{SHORT[p.department]}</span><span className="pd-t">@{p.name} <span className="pn-e">{p.email.split('@')[0]}</span></span></>,
          })),
      ]
    }
    setPop(items.length ? { tk, items, i: 0 } : null)
  }

  function pickPop(i) {
    const x = pop.items[i], tk = pop.tk, v = draft
    if (x.kind === 'task') {
      setTid(x.v)
      setDraft((v.slice(0, tk.start) + v.slice(tk.end)).replace(/\s{2,}/g, ' '))
    } else if (x.kind === 'dept') {
      setDraft(v.slice(0, tk.start) + '@' + x.v + ' ' + v.slice(tk.end))
    } else {
      setDraft(v.slice(0, tk.start) + '@' + x.name + ' ' + v.slice(tk.end))
      setPicked(p => (p.includes(x.v) ? p : [...p, x.v]))
    }
    setPop(null)
    focusEnd()
  }

  // 글 안의 @부서 / @사람 찾기
  function mentions(body) {
    const depts = SIGNUP_DEPTS.filter(d => body.includes('@' + d))
    const users = new Set(picked.filter(id => db.people[id] && body.includes('@' + db.people[id].name)))
    // 직접 타이핑한 이름도 (같은 이름이 한 명뿐일 때만)
    db.profiles.forEach(p => {
      if (body.includes('@' + p.name) && db.profiles.filter(q => q.name === p.name).length === 1) users.add(p.id)
    })
    users.delete(uid)
    return { mention_users: [...users], mention_depts: depts }
  }

  async function send() {
    const body = draft.trim()
    if (!body) return toast(tid ? '할 일에 남길 멘트를 입력해주세요' : '메시지를 입력해주세요')
    if (busy) return
    setBusy(true)
    const mn = mentions(body)
    const res = editId
      ? await supabase.from('messages').update({ body, task_id: tid, ...mn }).eq('id', editId).select('id')
      : await supabase.from('messages').insert({ change_id: cid, user_id: uid, body, task_id: tid, reply_to: replyTo, ...mn }).select('id')
    setBusy(false)
    if (res.error) return toast(errText(res.error))
    if (editId) toast('메시지를 수정했습니다')
    setDraft(''); setTid(null); setReplyTo(null); setEditId(null); setPicked([])
    await reload()
    focusEnd()
  }

  async function del(id) {
    const res = await supabase.from('messages').update({ deleted: true }).eq('id', id).select('id')
    setDelId(null)
    if (res.error) return toast(errText(res.error))
    toast('삭제했습니다 · "삭제된 메시지" 표시는 남습니다')
    reload()
  }

  async function copy(text) {
    const done = () => toast('복사했습니다')
    try { await navigator.clipboard.writeText(text); return done() } catch (e) { /* 아래 방법으로 */ }
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done()
    } catch (e) { toast('복사할 수 없습니다') }
  }

  function onKey(e) {
    if (pop) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = pop.items.length
        setPop({ ...pop, i: (pop.i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pickPop(pop.i) }
      if (e.key === 'Escape') { e.preventDefault(); return setPop(null) }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  function jump(id) {
    const el = listRef.current && listRef.current.querySelector(`[data-mid="${id}"]`)
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setFlash(null); setTimeout(() => setFlash(id), 10) }
  }

  const openMenu = (m, e) => {
    if (closed || m.deleted) return
    if (e.target.closest('button')) return
    e.preventDefault()
    setCtx({ mid: m.id, x: e.clientX, y: e.clientY })
  }

  const attached = tid ? c.tasks.find(t => t.id === tid) : null
  const ro = replyTo ? list.find(m => m.id === replyTo) : null
  const ctxMsg = ctx ? list.find(m => m.id === ctx.mid) : null

  return (
    <>
      {!docked && <div className="scrim" onClick={onClose} />}
      <div className={'chat' + (docked ? ' docked' : '')} role={docked ? 'complementary' : 'dialog'} aria-modal={docked ? undefined : true} aria-label="제품 대화">
        <div className="ch-h">
          <div>
            <span className="s-tag">제품 대화 · {list.filter(m => !m.deleted).length}개</span>
            <b>{c.title}</b>
            {!closed && <span className="ch-tip">메시지를 누르면 답글·복사(내 글은 수정·삭제도) · 숫자는 안 읽은 사람 수</span>}
          </div>
          {!docked && <button type="button" className="s-x" onClick={onClose} aria-label="닫기">✕</button>}
        </div>
        <div className="ch-list" ref={listRef}>
          {!list.length && <div className="empty">아직 대화가 없습니다. 첫 글을 남겨보세요.</div>}
          {list.map(m => {
            if (m.deleted) return <div key={m.id} className="msg-del" data-mid={m.id}>삭제된 메시지입니다 · <Person id={m.user_id} /> · {stamp(m.created_at)}</div>
            const mine = m.user_id === uid
            const p = db.people[m.user_id]
            const hl = !mine && mentionsMe(m)
            const o = m.reply_to ? list.find(x => x.id === m.reply_to) : null
            const t = m.task_id ? c.tasks.find(x => x.id === m.task_id) : null
            const uc = unreadCnt(m)
            return (
              <div key={m.id} data-mid={m.id}
                className={'msg' + (mine ? ' mine' : '') + (hl ? ' hl' : '') + (p && p.department === '임원' ? ' ex' : '') + (flash === m.id ? ' flash' : '')}>
                {!mine && <div className="m-who"><Person id={m.user_id} /></div>}
                <div className="b-row">
                  <div className="bub" onClick={e => openMenu(m, e)} onContextMenu={e => openMenu(m, e)}>
                    {o && (
                      <button type="button" className="rq" onClick={() => jump(o.id)}>
                        <span className="rq-w">↩ {personName(db, o.user_id)}에게 답글</span>
                        <span className="rq-t">{o.deleted ? '삭제된 메시지입니다' : snip(o.body, 40)}</span>
                      </button>
                    )}
                    {t && <button type="button" className="ch-task" onClick={() => { if (!docked) onClose(); openTask(t.id) }}><b>/</b> [{t.department}] {t.title}</button>}
                    <MsgText m={m} />
                  </div>
                  <span className="side">
                    {uc > 0 && <span className="rc">{uc}</span>}
                    {m.edited && <span className="ed">수정됨</span>}
                    <span className="tm">{stamp(m.created_at)}</span>
                  </span>
                </div>
                {mine && !closed && delId === m.id && (
                  <div className="m-meta">삭제할까요? <button type="button" className="link warn-t" onClick={() => del(m.id)}>삭제</button> <button type="button" className="link" onClick={() => setDelId(null)}>취소</button></div>
                )}
              </div>
            )
          })}
        </div>
        {closed ? (
          <div className="ch-ro">종결된 변경이라 대화는 읽기 전용입니다. 다시 진행되면 대화도 다시 열립니다.</div>
        ) : (
          <div className="ch-c">
            {ro && (
              <div className="ch-rep">
                <span><b>↩ {personName(db, ro.user_id)}</b>에게 답글 · {snip(ro.body, 30)}</span>
                <button type="button" className="x" aria-label="답글 취소" onClick={() => setReplyTo(null)}>✕</button>
              </div>
            )}
            {editId && <div className="ch-bar">메시지 수정 중 <button type="button" className="link" onClick={() => { setEditId(null); setDraft(''); setTid(null); setPicked([]) }}>취소</button></div>}
            {attached && (
              <div className="ch-att">
                <span><b>/</b> [{attached.department}] {attached.title}</span>
                <button type="button" className="x" aria-label="할 일 연결 빼기" onClick={() => setTid(null)}>✕</button>
              </div>
            )}
            {pop && (
              <div className="ch-pop">
                <div className="pop-h">{pop.tk.ch === '/' ? `할 일 연결 · 이 제품의 할 일 ${pop.items.length}건` : '부서 또는 사람 부르기'}</div>
                {pop.items.map((x, i) => (
                  <button type="button" key={x.kind + x.v} className={'pop-i' + (i === pop.i ? ' on' : '')}
                    onMouseDown={e => e.preventDefault()} onClick={() => pickPop(i)}>{x.node}</button>
                ))}
              </div>
            )}
            <div className="ch-in">
              <textarea ref={inRef} rows={2} value={draft} aria-label="메시지" placeholder="메시지 입력 (/ 할 일 연결, @ 부서·사람 부르기)"
                onChange={e => { setDraft(e.target.value); updatePop(e.target) }}
                onKeyDown={onKey}
                onClick={e => updatePop(e.target)} />
              <button type="button" className="btn sm" disabled={busy} onClick={send}>{editId ? '수정' : '보내기'}</button>
            </div>
          </div>
        )}
      </div>
      {ctx && ctxMsg && (
        <CtxMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} items={[
          ['↩ 답글', () => { setReplyTo(ctxMsg.id); setEditId(null); focusEnd() }],
          ['복사', () => copy(ctxMsg.body)],
          ...(ctxMsg.user_id === uid ? [
            ['수정', () => { setEditId(ctxMsg.id); setDraft(ctxMsg.body); setTid(ctxMsg.task_id); setReplyTo(null); setPicked(ctxMsg.mention_users || []); setDelId(null); focusEnd() }],
            ['삭제', () => setDelId(ctxMsg.id), true],
          ] : []),
        ]} />
      )}
    </>
  )
}

function CtxMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    })
    const f = ref.current.querySelector('button'); f && f.focus()
  }, [x, y])
  useEffect(() => {
    const on = e => { if (!ref.current || !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('click', on), 0)
    return () => document.removeEventListener('click', on)
  }, [onClose])
  return (
    <div className="ctx" role="menu" ref={ref} style={pos}>
      {items.map(([label, fn, warn]) => (
        <button key={label} type="button" role="menuitem" className={warn ? 'warn-t' : ''} onClick={() => { onClose(); fn() }}>{label}</button>
      ))}
    </div>
  )
}
