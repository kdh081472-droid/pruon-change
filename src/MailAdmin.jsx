import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { useApp } from './ctx.jsx'
import { errText } from './util.js'

// 관리자 모드 › 메일 알림: 켜기 · 변경 등록 메일 받는 부서 · 테스트 메일 · 발송 현황
const FN = 'notify-mail'
const KIND = { change: '변경 등록', group: '변경 등록(묶음)', mention: '부르기', test: '테스트' }
const md = d => { const [, m, dd] = String(d).split('-'); return `${Number(m)}/${Number(dd)}` }

function Sw({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={'ai-sw' + (on ? ' on' : '')} onClick={() => onChange(!on)}><i /></button>
}

export default function MailAdmin() {
  const { db, me, toast } = useApp()
  const [cfg, setCfg] = useState(null)
  const [f, setF] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [test, setTest] = useState(null)   // { ok, msg }

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_mail_get')
    if (error) return setErr(errText(error) + ' (upgrade20.sql을 실행했는지 확인해주세요)')
    setErr(''); setCfg(data); setF({ enabled: !!data.enabled, off: data.off_depts || [] })
  }, [])
  useEffect(() => { load() }, [load])

  const dirty = !!(cfg && f && (f.enabled !== !!cfg.enabled || [...f.off].sort().join('|') !== [...(cfg.off_depts || [])].sort().join('|')))

  async function save() {
    if (busy) return
    setBusy('save'); setErr('')
    const base = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
    const { error } = await supabase.rpc('admin_mail_save', {
      p_enabled: f.enabled,
      p_off_depts: f.off,
      p_fn_url: base ? base + '/functions/v1/' + FN : null,
      p_fn_key: import.meta.env.VITE_SUPABASE_ANON_KEY || null,      // 앱에 이미 들어 있는 공개용 키
      p_app_url: location.origin + location.pathname,
    })
    setBusy('')
    if (error) return setErr(errText(error))
    toast(f.enabled ? '메일 알림 설정을 저장했습니다 · 지금부터 메일이 나갑니다' : '메일 알림을 껐습니다')
    load()
  }

  async function sendTest() {
    if (busy) return
    setBusy('test'); setTest(null)
    const { data, error } = await supabase.functions.invoke(FN, { body: { action: 'test' } })
    setBusy('')
    if (error) {
      let m = errText(error)
      try { const j = await error.context.json(); if (j && j.error) m = j.error } catch (_) {}
      if (/Failed to send|404|not found/i.test(m)) m = '메일 발송 기능(notify-mail)에 연결하지 못했습니다. Supabase에 notify-mail 기능을 만들었는지, 이름이 정확한지 확인해야 합니다. (' + m + ')'
      setTest({ ok: false, msg: m })
    } else if (data && data.ok) setTest({ ok: true, msg: `${data.to} 로 보냈습니다. 받은편지함(없으면 스팸함)을 확인하면 됩니다.` })
    else setTest({ ok: false, msg: (data && data.error) || '알 수 없는 오류' })
    load()
  }

  async function kick() {
    if (busy) return
    setBusy('kick')
    const { data, error } = await supabase.rpc('admin_mail_kick')
    setBusy('')
    if (error) return toast(errText(error))
    toast(data ? `밀린 메일 ${data}통을 다시 보냅니다 · 잠시 후 새로고침하면 결과가 보입니다` : '밀린 메일이 없습니다')
    setTimeout(load, 6000)
  }

  const head = (
    <div className="adm-h">
      <div><h1>메일 알림</h1><p>변경 등록·대화 부르기를 회사 메일로 알림 · 보낸 시각·종류·성공 여부만 기록 (열어 봤는지는 기록하지 않음)</p></div>
    </div>
  )
  if (err && !cfg) return <>{head}<div className="card empty">{err}</div></>
  if (!cfg || !f) return <>{head}<div className="card empty">불러오는 중…</div></>

  const depts = db.depts.map(d => d.name)
  const offOld = f.off.filter(d => !depts.includes(d))
  const days = cfg.days || []
  const tot = days.reduce((a, d) => ({ change: a.change + d.change, mention: a.mention + d.mention, fail: a.fail + d.fail }), { change: 0, mention: 0, fail: 0 })

  return (
    <>
      {head}
      {err && <div className="card empty">{err}</div>}

      <div className="card adm-card ml-card">
        <h2>켜기</h2>
        <label className="ml-on">
          <Sw on={f.enabled} onChange={v => setF({ ...f, enabled: v })} label="메일 알림 켜기" />
          <span><b>{f.enabled ? '메일 알림 켜짐' : '메일 알림 꺼짐'}</b><small>{f.enabled ? '변경 등록·부르기가 생기면 바로 메일이 나갑니다' : '꺼져 있으면 아무 메일도 나가지 않습니다'}</small></span>
        </label>
        {!cfg.linked && <p className="ml-warn">처음 한 번은 [저장]을 눌러야 서버와 메일 발송 기능이 연결됩니다.</p>}
      </div>

      <div className="card adm-card ml-card">
        <h2>변경 등록 메일 받는 부서</h2>
        <p className="ml-sub">체크한 부서의 가입자 전원이 변경 등록 메일을 받습니다(퇴사 처리된 사람·등록한 본인 제외). 묶음은 묶음당 1통입니다.<br />대화에서 @이름·@부서로 불린 메일은 이 체크와 상관없이 갑니다.</p>
        <div className="ml-depts">
          {depts.map(d => {
            const on = !f.off.includes(d)
            return (
              <label key={d} className={'ml-dept' + (on ? ' on' : '')}>
                <input type="checkbox" checked={on} onChange={() => setF({ ...f, off: on ? [...f.off, d] : f.off.filter(x => x !== d) })} />
                {d}
              </label>
            )
          })}
        </div>
        {offOld.length > 0 && <p className="ml-sub">지금은 없는 부서(받지 않음으로 남아 있음): {offOld.join(', ')}</p>}
        <div className="ml-acts">
          <button type="button" className="btn" disabled={!!busy || (!dirty && cfg.linked)} onClick={save}>{busy === 'save' ? '저장하는 중…' : '저장'}</button>
          {dirty && <button type="button" className="btn ghost" onClick={() => setF({ enabled: !!cfg.enabled, off: cfg.off_depts || [] })}>되돌리기</button>}
          {dirty && <span className="ml-dirty">저장하지 않은 변경이 있습니다</span>}
        </div>
      </div>

      <div className="card adm-card ml-card">
        <h2>테스트 메일</h2>
        <p className="ml-sub">내 메일({me.email})로 테스트 메일을 보냅니다. 켜기와 상관없이 보낼 수 있습니다.</p>
        <div className="ml-acts">
          <button type="button" className="btn ghost" disabled={!!busy} onClick={sendTest}>{busy === 'test' ? '보내는 중…' : '테스트 메일 보내기'}</button>
        </div>
        {test && <p className={'ml-res ' + (test.ok ? 'ok' : 'bad')}>{test.ok ? '✓ ' : '✕ '}{test.msg}</p>}
      </div>

      <div className="card adm-card ml-card">
        <h2>발송 현황 <small>최근 14일</small></h2>
        <div className="ml-sum">
          <span>변경 등록 <b>{tot.change}</b>통</span>
          <span>부르기 <b>{tot.mention}</b>통</span>
          <span className={tot.fail ? 'bad' : ''}>실패 <b>{tot.fail}</b>통</span>
          <span>대기 <b>{cfg.waiting}</b>통</span>
          <button type="button" className="btn ghost sm" disabled={!!busy} onClick={kick}>{busy === 'kick' ? '…' : '밀린·실패 메일 다시 보내기'}</button>
          <button type="button" className="btn ghost sm" disabled={!!busy} onClick={load}>새로고침</button>
        </div>
        {days.length === 0 ? <p className="ml-sub">아직 보낸 메일이 없습니다.</p> : (
          <table className="adm-t ml-t">
            <thead><tr><th>날짜</th><th>변경 등록</th><th>부르기</th><th>테스트</th><th>실패</th></tr></thead>
            <tbody>
              {days.map(d => (
                <tr key={d.day}><td>{md(d.day)}</td><td>{d.change}</td><td>{d.mention}</td><td>{d.test}</td><td className={d.fail ? 'bad' : ''}>{d.fail}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {(cfg.fails || []).length > 0 && (
          <div className="ml-fails">
            <b>최근 실패 (7일)</b>
            {cfg.fails.map((x, i) => (
              <div key={i} className="ml-fail">
                <span>{(d => `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)(new Date(x.at))}</span>
                <span>{KIND[x.kind] || x.kind}</span>
                <span>{x.name || '-'}</span>
                <span className="e">{x.err || '-'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
