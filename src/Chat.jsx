import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase, ORDER, SHORT, SIGNUP_DEPTS } from './supabase.js'
import { useApp, Person, MsgText, personName, Mark } from './ctx.jsx'
import { md, norm, parse, snip, stamp, errText, hasAll, words } from './util.js'
import { openPopup } from './popchat.js'

function tokenAt(el) {
  const b = el.value.slice(0, el.selectionStart)
  const m = b.match(/(^|\s)([/@])([^\s/@]*)$/)
  return m ? { ch: m[2], q: m[3], start: b.length - m[3].length - 1, end: el.selectionStart } : null
}

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() }
const dayTxt = ts => { const d = new Date(ts); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일` }

// 대화방: cid = 변경(품목) id 또는 'g:' + 묶음 id
// docked = PC 오른쪽 칸 · tab = PC 대화 탭(넓게) · 그 외 = 휴대폰 전체 화면
// popup = 대화 작은 창(따로 띄운 브라우저 창)
export default function Chat({ cid, onClose, docked, tab, popup, searchQ, jumpTo, onSearchClose }) {
  const { db, me, uid, C, isLate, unreadCnt, mentionsMe, reload, toast, markReadLocal, openTask, goChange, goGroup } = useApp()
  const isG = String(cid).startsWith('g:')
  const g = isG ? db.groupMap[cid.slice(2)] : null
  const c = isG ? null : C(cid)
  const gOf = c ? c.group : g
  const closed = isG ? !g.kids.some(k => k.status === '진행중') : c.status === '종결'
  const title = isG ? g.title : c.title
  const list = db.messages.filter(m => m.room === cid).sort((a, b) => a.id - b.id)
  const [draft, setDraft] = useState('')
  const [tid, setTid] = useState(null)
  const [link, setLink] = useState(null)        // 묶음 대화에서 / 로 연결한 품목
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
    // .then()을 붙여야 실제로 서버에 보내짐 (안 붙이면 화면에서만 읽음 처리되고 다시 켜면 안 읽음으로 돌아감)
    if (isG) supabase.rpc('mark_group_read', { p_group: g.id, p_last: lastId }).then(() => {}, () => {})
    else supabase.rpc('mark_read', { p_change: cid, p_last: lastId }).then(() => {}, () => {})
  }, [lastId, cid, uid, db.reads, markReadLocal])

  // 새 글이 오면 맨 아래로
  useLayoutEffect(() => {
    const L = listRef.current
    if (L) L.scrollTop = L.scrollHeight
  }, [lastId, cid])

  // 검색: 이 방 안에서 검색어가 들어간 글 (▲▼로 넘겨보기)
  // 방 이름에 들어 있는 낱말은 빼고 글 내용에서만 찾음 (예: "원산지 A만두속" → A만두속 방에서 "원산지")
  const roomNm = norm(title + ' ' + (gOf ? gOf.title : '') + (isG ? ' 묶음 전체 대화' : ''))
  const q = words(searchQ).filter(w => !roomNm.includes(norm(w))).join(' ')
  const hits = q ? list.filter(m => !m.deleted && hasAll(m.body, q)) : []
  const [hitI, setHitI] = useState(0)
  useEffect(() => {
    if (!jumpTo) return
    const i = hits.findIndex(m => m.id === jumpTo.mid)
    if (i >= 0) setHitI(i)
    const t = setTimeout(() => jump(jumpTo.mid), 60)
    return () => clearTimeout(t)
  }, [jumpTo && jumpTo.t, cid])
  const goHit = d => {
    if (!hits.length) return
    const i = (hitI + d + hits.length) % hits.length
    setHitI(i); jump(hits[i].id)
  }

  useEffect(() => {
    const on = e => {
      if (e.key !== 'Escape') return
      if (ctx) return setCtx(null)
      if (pop) return
      if (popup) return window.close()
      if (!docked && !tab && onClose) onClose()
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
    if (tk.ch === '/' && isG) {
      items = g.kids
        .filter(k => !q2 || norm(k.title).includes(q2))
        .map(k => ({
          kind: 'item', v: k.id,
          node: <><span className="pd-d">품목</span><span className="pd-t">{k.title}</span><span className={'pd-s' + (k.status === '종결' ? '' : '')}>{k.status === '종결' ? (k.close_type === '중단' ? '중단' : '종결') : md(k.target_date)}</span></>,
        }))
    } else if (tk.ch === '/') {
      items = [...c.tasks]
        .filter(t => !q2 || norm(t.department + t.title).includes(q2))
        .sort((a, b) => ORDER.indexOf(a.department) - ORDER.indexOf(b.department) || String(a.created_at).localeCompare(String(b.created_at)))
        .map(t => ({
          kind: 'task', v: t.id,
          node: <><span className="pd-d">{SHORT[t.department]}</span><span className="pd-t">{t.title}</span><span className={'pd-s' + (isLate(t) ? ' late' : '')}>{t.status === '대기' ? (isLate(t) ? '전환일 지남' : '대기') : t.status}</span></>,
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
    if (x.kind === 'item') {
      setLink(x.v)
      setDraft((v.slice(0, tk.start) + v.slice(tk.end)).replace(/\s{2,}/g, ' '))
    } else if (x.kind === 'task') {
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
    if (!body) return toast(tid ? '할 일에 남길 멘트를 입력해주세요' : link ? '품목에 남길 멘트를 입력해주세요' : '메시지를 입력해주세요')
    if (busy) return
    setBusy(true)
    const mn = mentions(body)
    const room = isG ? { group_id: g.id, link_change: link } : { change_id: cid, task_id: tid }
    const res = editId
      ? await supabase.from('messages').update(isG ? { body, link_change: link, ...mn } : { body, task_id: tid, ...mn }).eq('id', editId).select('id')
      : await supabase.from('messages').insert({ ...room, user_id: uid, body, reply_to: replyTo, ...mn }).select('id')
    setBusy(false)
    if (res.error) return toast(errText(res.error))
    if (editId) toast('메시지를 수정했습니다')
    setDraft(''); setTid(null); setLink(null); setReplyTo(null); setEditId(null); setPicked([])
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

  const attached = tid && c ? c.tasks.find(t => t.id === tid) : null
  const linked = link ? C(link) : null
  const ro = replyTo ? list.find(m => m.id === replyTo) : null
  const [tip, setTip] = useState(false)
  const ctxMsg = ctx ? list.find(m => m.id === ctx.mid) : null

  return (
    <>
      {!docked && !tab && <div className="scrim" onClick={onClose} />}
      <div className={'chat' + (docked || tab ? ' docked' : '') + (tab ? ' ch-tab' : '') + (isG ? ' ch-grp' : '') + (popup ? ' ch-win' : '')} role={docked || tab ? 'complementary' : 'dialog'} aria-modal={docked || tab ? undefined : true} aria-label={isG ? '묶음 대화' : '제품 대화'}>
        <div className="ch-h">
          <div className="ch-hl">
            <span className="s-tag">{isG ? '묶음 전체 대화' : gOf ? '품목 대화' : '제품 대화'} · {list.filter(m => !m.deleted).length}개</span>
            <b>{isG && <span className="g-chip g-in">묶음</span>}{title}{closed && <span className="ch-fin">종결</span>}</b>{!isG && gOf && <small className="ch-g">묶음 · {gOf.title}</small>}
            {isG && <small className="ch-g">품목 {g.kids.length}개 · 모든 품목 공통 공지·일정</small>}
            {!closed && tip && <span className="ch-tip">메시지를 누르면 답글·복사 (내 글은 수정·삭제도) · 말풍선 옆 숫자는 그 글을 아직 안 읽은 사람 수{isG ? ' · / 를 누르면 품목 연결' : ''}</span>}
          </div>
          {tab && (
            <span className="ch-open">
              {!isG && <button type="button" className="pill" onClick={() => goChange(cid)}>제품 열기</button>}
              {gOf && <button type="button" className="pill g-open-b" onClick={() => goGroup(gOf.id)}>묶음 열기</button>}
            </span>
          )}
          {docked && !tab && <button type="button" className="pill ch-nw" title="이 대화를 작은 창으로 따로 띄웁니다" onClick={() => { if (!openPopup(cid)) toast('팝업이 막혀 있습니다. 주소창 오른쪽의 팝업 차단 표시를 눌러 허용해주세요.') }}>↗ 새 창</button>}
          {!closed && <button type="button" className={'ch-q' + (tip ? ' on' : '')} aria-label="대화 사용법" aria-expanded={tip} onClick={() => setTip(v => !v)}>?</button>}
          {!docked && !tab && <button type="button" className="s-x" onClick={onClose} aria-label="닫기">✕</button>}
        </div>
        {q && (
          <div className="ch-sbar">
            <span>이 방에서 "<b>{q}</b>" {hits.length ? <>{hits.length}개 중 <b>{hitI + 1}</b>번째</> : '없음'}</span>
            <button type="button" className="pill" disabled={!hits.length} onClick={() => goHit(-1)} aria-label="이전 결과">▲</button>
            <button type="button" className="pill" disabled={!hits.length} onClick={() => goHit(1)} aria-label="다음 결과">▼</button>
            {onSearchClose && <button type="button" className="link ch-sx" onClick={onSearchClose}>✕ 검색 닫기</button>}
          </div>
        )}
        <div className="ch-list" ref={listRef}>
          {!list.length && <div className="empty">아직 대화가 없습니다. 첫 글을 남겨보세요.</div>}
          {list.map((m, i) => {
            const prev = list[i - 1]
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at)
            const divider = newDay && <div className="ch-day" key={'d' + m.id}><span>{dayTxt(m.created_at)}</span></div>
            if (m.deleted) return [divider, <div key={m.id} className="msg-del" data-mid={m.id}>삭제된 메시지입니다 · <Person id={m.user_id} /> · {stamp(m.created_at)}</div>]
            const mine = m.user_id === uid
            const p = db.people[m.user_id]
            const hl = !mine && mentionsMe(m)
            const o = m.reply_to ? list.find(x => x.id === m.reply_to) : null
            const t = m.task_id && c ? c.tasks.find(x => x.id === m.task_id) : null
            const lk = m.link_change ? C(m.link_change) : null
            const uc = unreadCnt(m)                 // 이 글을 아직 안 읽은 사람 수 (모든 글)
            // 같은 사람이 5분 안에 이어 쓴 글은 이름 한 번만
            const cont = !newDay && prev && !prev.deleted && prev.user_id === m.user_id && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000
            return [divider, (
              <div key={m.id} data-mid={m.id}
                className={'msg' + (mine ? ' mine' : '') + (hl ? ' hl' : '') + (cont ? ' cont' : '') + (p && p.department === '임원' ? ' ex' : '') + (flash === m.id ? ' flash' : '') + (q && hits[hitI] && hits[hitI].id === m.id ? ' hit' : '')}>
                {!mine && !cont && <div className="m-who"><Person id={m.user_id} /></div>}
                <div className="b-row">
                  <div className="bub" onClick={e => openMenu(m, e)} onContextMenu={e => openMenu(m, e)}>
                    {o && (
                      <button type="button" className="rq" onClick={() => jump(o.id)}>
                        <span className="rq-w">↩ {personName(db, o.user_id)}에게 답글</span>
                        <span className="rq-t">{o.deleted ? '삭제된 메시지입니다' : snip(o.body, 40)}</span>
                      </button>
                    )}
                    {t && <button type="button" className="ch-task" onClick={() => { if (!docked && !tab) onClose(); openTask(t.id) }}><b>/</b> [{t.department}] {t.title}</button>}
                    {lk && <button type="button" className="ch-task ch-item" onClick={() => { if (!docked && !tab) onClose(); goChange(lk.id) }}><b>/</b> {lk.title}</button>}
                    <MsgText m={m} q={q} />
                  </div>
                  <span className="side">
                    {uc > 0 && <span className="rc" title={'아직 안 읽은 사람 ' + uc + '명'}>{uc}</span>}
                    {m.edited && <span className="ed">수정됨</span>}
                    <span className="tm">{stamp(m.created_at)}</span>
                  </span>
                </div>
                {mine && !closed && delId === m.id && (
                  <div className="m-meta">삭제할까요? <button type="button" className="link warn-t" onClick={() => del(m.id)}>삭제</button> <button type="button" className="link" onClick={() => setDelId(null)}>취소</button></div>
                )}
              </div>
            )]
          })}
        </div>
        {closed ? (
          <div className="ch-ro">{isG ? '모든 품목이 종결된 묶음이라 대화는 읽기 전용입니다.' : '종결된 변경이라 대화는 읽기 전용입니다. 다시 진행되면 대화도 다시 열립니다.'}</div>
        ) : (
          <div className="ch-c">
            {ro && (
              <div className="ch-rep">
                <span><b>↩ {personName(db, ro.user_id)}</b>에게 답글 · {snip(ro.body, 30)}</span>
                <button type="button" className="x" aria-label="답글 취소" onClick={() => setReplyTo(null)}>✕</button>
              </div>
            )}
            {editId && <div className="ch-bar">메시지 수정 중 <button type="button" className="link" onClick={() => { setEditId(null); setDraft(''); setTid(null); setLink(null); setPicked([]) }}>취소</button></div>}
            {linked && (
              <div className="ch-att">
                <span><b>/</b> {linked.title}</span>
                <button type="button" className="x" aria-label="품목 연결 빼기" onClick={() => setLink(null)}>✕</button>
              </div>
            )}
            {attached && (
              <div className="ch-att">
                <span><b>/</b> [{attached.department}] {attached.title}</span>
                <button type="button" className="x" aria-label="할 일 연결 빼기" onClick={() => setTid(null)}>✕</button>
              </div>
            )}
            {pop && (
              <div className="ch-pop">
                <div className="pop-h">{pop.tk.ch === '/' ? (isG ? `품목 연결 · 이 묶음의 품목 ${pop.items.length}개` : `할 일 연결 · 이 제품의 할 일 ${pop.items.length}건`) : '부서 또는 사람 부르기'}</div>
                {pop.items.map((x, i) => (
                  <button type="button" key={x.kind + x.v} className={'pop-i' + (i === pop.i ? ' on' : '')}
                    onMouseDown={e => e.preventDefault()} onClick={() => pickPop(i)}>{x.node}</button>
                ))}
              </div>
            )}
            <div className="ch-in">
              <textarea ref={inRef} rows={2} value={draft} aria-label="메시지" placeholder={isG ? '메시지 입력 (/ 품목 연결, @ 부서·사람 부르기)' : '메시지 입력 (/ 할 일 연결, @ 부서·사람 부르기)'}
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
            ['수정', () => { setEditId(ctxMsg.id); setDraft(ctxMsg.body); setTid(ctxMsg.task_id); setLink(ctxMsg.link_change || null); setReplyTo(null); setPicked(ctxMsg.mention_users || []); setDelId(null); focusEnd() }],
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
