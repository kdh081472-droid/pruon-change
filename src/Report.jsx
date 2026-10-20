import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ORDER } from './supabase.js'
import { useApp, PersonR } from './ctx.jsx'
import { md, parse, stamp, stampFull } from './util.js'

export default function Report({ cid, onClose }) {
  const { db, C, toast } = useApp()
  const c = C(cid)
  const [withChat, setWithChat] = useState(true)
  const [busy, setBusy] = useState(false)
  const pageRef = useRef(null)
  const [zoom, setZoom] = useState(1)

  useLayoutEffect(() => {
    const fit = () => setZoom(Math.min(1, (window.innerWidth - 24) / 794))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  useEffect(() => {
    const on = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  })

  const ts = [...c.tasks].sort((a, b) => ORDER.indexOf(a.department) - ORDER.indexOf(b.department) || String(a.created_at).localeCompare(String(b.created_at)))
  const deptsIn = [...ORDER.filter(d => ts.some(t => t.department === d)), ...[...new Set(ts.map(t => t.department))].filter(d => !ORDER.includes(d))]
  const tmap = {}
  ts.forEach(t => { tmap[t.id] = t })
  const clogs = db.changeLogs.filter(x => x.change_id === cid)
  const tlogs = db.taskLogs.filter(x => x.change_id === cid)
  const targetChanges = clogs.filter(x => x.action === '전환일 변경')
  const lateDone = t => t.status !== '대기' && t.done_at && stampFull(t.done_at).slice(0, 10) > c.target_date   // 전환일 이후 처리
  const msgs = db.messages.filter(m => m.change_id === cid).sort((a, b) => a.id - b.id)
  const docNo = 'CHG-' + String(c.created_at).slice(0, 4) + '-' + c.id.slice(0, 6).toUpperCase()

  const hist = []
  clogs.forEach(x => {
    let what = x.action
    if (x.action === '등록') what = '변경 등록'
    if (x.action === '전환일 변경') what = `전환일 변경 ${md(x.old_date)} → ${md(x.new_date)}`
    if (x.action === '할 일 배정') what = '할 일 배정 → ' + (x.detail || '')
    if ((x.action === '다시 진행' || x.action === '종결') && x.detail) what = x.action + ' (' + x.detail + ')'
    hist.push({ k: 'c' + x.id, at: x.created_at, who: x.user_id, what, memo: x.memo || '' })
  })
  tlogs.forEach(x => {
    const t = tmap[x.task_id]
    if (!t) return
    hist.push({ k: 't' + x.id, at: x.created_at, who: x.user_id, what: `[${t.department}] ${x.action} · ${t.title}`, memo: x.memo || '' })
  })
  hist.sort((a, b) => String(a.at).localeCompare(String(b.at)))

  async function savePdf() {
    if (busy) return
    setBusy(true)
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
      const src = pageRef.current
      // 확대·축소 없이 원래 크기(794px)로 복제해서 찍기
      const holder = document.createElement('div')
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff'
      const page = src.cloneNode(true)
      page.style.zoom = '1'
      page.style.boxShadow = 'none'
      page.style.borderRadius = '0'
      holder.appendChild(page)
      document.body.appendChild(holder)
      if (document.fonts && document.fonts.ready) await document.fonts.ready
      // 표 줄이 페이지 사이에서 잘리지 않도록 자를 수 있는 위치를 모아둠
      const top0 = page.getBoundingClientRect().top
      const cuts = [...page.querySelectorAll('tr, h2, .pg-h, .sumrow, .kvt, p, .pg-f')]
        .map(el => el.getBoundingClientRect().bottom - top0)
        .sort((a, b) => a - b)
      const totalH = page.scrollHeight
      // 아이폰은 한 그림의 크기 제한이 있어서 긴 보고서는 해상도를 조금 낮춤
      const scale = Math.max(1, Math.min(2, Math.floor(Math.sqrt(15e6 / (794 * totalH)) * 10) / 10))
      const canvas = await html2canvas(page, { scale, backgroundColor: '#ffffff', useCORS: true, windowWidth: 794 })
      document.body.removeChild(holder)

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pageHpx = Math.floor((794 * 297) / 210)   // A4 한 장 높이 (px)
      const margin = 28
      let y = 0, first = true
      while (y < totalH - 2) {
        const room = first ? pageHpx : pageHpx - margin * 2
        let end = Math.min(y + room, totalH)
        if (end < totalH) {
          const ok = cuts.filter(v => v > y + 40 && v <= end)
          if (ok.length) end = ok[ok.length - 1]
        }
        const h = end - y
        const slice = document.createElement('canvas')
        slice.width = canvas.width
        slice.height = Math.round(h * scale)
        const g = slice.getContext('2d')
        g.fillStyle = '#fff'
        g.fillRect(0, 0, slice.width, slice.height)
        g.drawImage(canvas, 0, Math.round(y * scale), canvas.width, Math.round(h * scale), 0, 0, slice.width, Math.round(h * scale))
        if (!first) pdf.addPage()
        const topMm = first ? 0 : (margin * 210) / 794
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, topMm, 210, (h * 210) / 794)
        first = false
        y = end
      }
      const safe = c.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40)
      pdf.save(`변경점결과보고서_${safe}_${stampFull(new Date().toISOString()).slice(0, 10)}.pdf`)
      toast('PDF를 저장했습니다')
    } catch (e) {
      toast('PDF를 만들지 못했습니다: ' + ((e && e.message) || e))
    }
    setBusy(false)
  }

  const nDone = ts.filter(t => t.status === '완료').length
  const nNa = ts.filter(t => t.status === '해당없음').length
  const nLate = ts.filter(lateDone).length

  return (
    <>
      <div className="rp-scrim" onClick={onClose} />
      <div className="rp" role="dialog" aria-modal="true" aria-label="결과 보고서">
        <div className="rp-bar">
          <b>결과 보고서</b>
          <span className="rp-note">전자결재 참고파일용 PDF로 저장됩니다</span>
          <label className="rp-ck"><input type="checkbox" checked={withChat} onChange={e => setWithChat(e.target.checked)} /> 대화 기록 포함</label>
          <button type="button" className="btn sm" disabled={busy} onClick={savePdf}>{busy ? 'PDF 만드는 중…' : 'PDF로 저장'}</button>
          <button type="button" className="btn sm ghost" onClick={onClose}>닫기</button>
        </div>
        <div className="page" ref={pageRef} style={{ zoom }}>
          <div className="pg-h">
            <div>
              <div className="pg-k">푸르온식품연구소 · 변경점 관리 결과 보고서</div>
              <h1>{c.title}</h1>
            </div>
            <div className="pg-no">문서번호 {docNo}</div>
          </div>

          <h2>1. 변경 개요</h2>
          <table className="kvt"><tbody>
            <tr><th>변경 내용</th><td colSpan={3}>{c.description || '-'}</td></tr>
            <tr><th>변경 사유</th><td colSpan={3}>{c.reason || '-'}</td></tr>
            <tr><th>대상 품목</th><td colSpan={3}>{c.itemsText}</td></tr>
            <tr><th>발의</th><td><PersonR id={c.created_by} inline fallback={c.created_by_dept} /></td><th>등록일</th><td>{stampFull(c.created_at)}</td></tr>
            <tr>
              <th>전환일</th>
              <td>{c.first_target_date && c.first_target_date !== c.target_date ? <>{md(c.first_target_date)} → <b>{c.target_date}</b></> : c.target_date}</td>
              <th>종결일</th><td>{c.status === '종결' ? stampFull(c.closed_at) : '진행중'}</td>
            </tr>
            <tr>
              <th>종결 구분</th>
              <td colSpan={3}>
                {c.status !== '종결' ? '진행중 (아직 종결되지 않음)'
                  : c.close_type === '중단'
                    ? <><b className="lt" style={{ fontSize: 12.5 }}>중단 종결</b> · 사유: {c.close_reason} · <PersonR id={c.closed_by} inline /></>
                    : '정상 종결 (모든 할 일 처리)'}
              </td>
            </tr>
          </tbody></table>

          <h2>2. 처리 요약</h2>
          <div className="sumrow">
            <div><b>{ts.length}</b>전체 할 일</div>
            <div><b>{nDone}</b>확인완료</div>
            <div><b>{nNa}</b>해당없음</div>
            <div><b>{nLate}</b>전환일 후 처리</div>
            <div><b>{targetChanges.length}</b>전환일 변경</div>
          </div>

          <h2>3. 부서별 처리 결과</h2>
          <table className="rt">
            <thead><tr><th>부서</th><th>할 일</th><th>결과</th><th>확인 메모</th><th>처리자</th></tr></thead>
            <tbody>
              {deptsIn.map(d => {
                const xs = ts.filter(t => t.department === d)
                return xs.map((t, i) => (
                  <tr key={t.id}>
                    {i === 0 && <td rowSpan={xs.length} className="rd">{d}</td>}
                    <td>{t.is_extra && '[추가 배정] '}{t.title}</td>
                    <td className="c">
                      {t.status === '대기' ? (c.close_type === '중단' ? <span className="lt">중단(미처리)</span> : '대기') : t.status}
                      {lateDone(t) && <><br /><span className="lt">전환일 후 처리</span></>}
                    </td>
                    <td>{t.memo || ''}</td>
                    <td className="c">{t.done_by ? <><PersonR id={t.done_by} /><br />{stamp(t.done_at)}</> : '-'}</td>
                  </tr>
                ))
              })}
            </tbody>
          </table>

          <h2>4. 변경 과정 이력</h2>
          <table className="rt hist-t">
            <thead><tr><th>일시</th><th>처리자</th><th>내용</th><th>사유·메모</th></tr></thead>
            <tbody>
              {hist.map(x => (
                <tr key={x.k}>
                  <td className="c">{stamp(x.at)}</td>
                  <td className="c">{x.who ? <PersonR id={x.who} /> : '자동'}</td>
                  <td>{x.what}</td>
                  <td>{x.memo}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {withChat && (
            <>
              <h2>5. 제품 대화 기록</h2>
              {msgs.length ? (
                <table className="rt hist-t">
                  <thead><tr><th>일시</th><th>작성자</th><th>연결 할 일</th><th>내용</th></tr></thead>
                  <tbody>
                    {msgs.map(m => {
                      const t = m.task_id ? tmap[m.task_id] : null
                      const o = m.reply_to ? msgs.find(x => x.id === m.reply_to) : null
                      return (
                        <tr key={m.id}>
                          <td className="c">{stamp(m.created_at)}</td>
                          <td className="c"><PersonR id={m.user_id} /></td>
                          <td>{t ? `[${t.department}] ${t.title}` : '-'}</td>
                          <td>
                            {o && <span className="re">↩ 답글 </span>}
                            {m.deleted ? <i>삭제된 메시지</i> : <>{m.body}{m.edited ? ' (수정됨)' : ''}</>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : <p>대화 기록 없음</p>}
            </>
          )}
          <div className="pg-f">출력일시 {stampFull(new Date().toISOString())} · 푸르온 변경점 관리 시스템에서 자동 생성 · 전자결재 참고자료용</div>
        </div>
      </div>
    </>
  )
}
