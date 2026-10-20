import { useState } from 'react'
import { ORDER, VIEW_DEPTS, isViewDept } from './supabase.js'
import { useApp } from './ctx.jsx'

// 조직도: 가입한 사람을 부서별로 (보기 전용 부서 → 업무 부서 순). 부서는 처음에 접힌 상태. 퇴사자는 빠짐
export default function OrgTree({ inSheet }) {
  const { db, me } = useApp()
  const [openD, setOpenD] = useState({})
  const depts = [...VIEW_DEPTS, ...ORDER]
  return (
    <div className={'org-tree' + (inSheet ? ' in-sheet' : '')}>
      <div className="org-root">푸르온</div>
      {depts.map(d => {
        const us = db.profiles.filter(p => p.department === d).sort((a, b) => a.name.localeCompare(b.name))
        const open = !!openD[d]
        return (
          <div key={d} className={'org-d' + (d === me.department ? ' mine' : '')}>
            <button type="button" className="org-dh" aria-expanded={open} onClick={() => setOpenD(o => ({ ...o, [d]: !o[d] }))}>
              <span className="ar">{open ? '▾' : '▸'}</span><b>{d}</b><span className="cnt">{us.length}명</span>
              {isViewDept(d) && <span className="ro-tag">보기 전용</span>}
            </button>
            {open && (
              <ul>
                {us.length ? us.map(p => {
                  const isMe = p.id === me.id
                  return (
                    <li key={p.id} className={'org-u' + (isMe ? ' me' : '')}>
                      <span className="av s">{p.name.slice(0, 1)}</span>
                      <span className="org-n"><b>{p.name}</b>{isMe && <em>나</em>}</span>
                      <span className="pn-e">{p.email}</span>
                    </li>
                  )
                }) : <li className="org-u none">가입한 사람 없음</li>}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
