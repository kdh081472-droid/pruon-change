import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, setDepts } from './supabase.js'

// Supabase는 한 번에 최대 1000줄까지 주므로 나눠서 모두 가져옴
async function fetchAll(table, orderCols, build, cols = '*') {
  const size = 1000
  const out = []
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select(cols)
    orderCols.forEach(c => { q = q.order(c, { ascending: true }) })
    if (build) q = build(q)
    const { data, error } = await q.range(from, from + size - 1)
    if (error) throw error
    out.push(...data)
    if (data.length < size) break
  }
  return out
}

function shortTitle(t) {
  return t.length > 14 ? t.slice(0, 14) + '…' : t
}

export function buildDb(raw) {
  setDepts(raw.depts)
  const people = {}
  raw.profiles.forEach(p => { people[p.id] = p })   // 퇴사자 포함 (지난 기록 이름 표시용)
  const active = raw.profiles.filter(p => !p.left_at)
  // 할 일 순서: 부서가 정한 순서(pos) → 없으면 만든 순서 (새로 배정된 건 맨 끝)
  const byPos = (a, b) => ((a.pos ?? 1e9) - (b.pos ?? 1e9)) || String(a.created_at).localeCompare(String(b.created_at))
  raw.tasks.sort(byPos)
  const tasksBy = {}
  raw.tasks.forEach(t => { (tasksBy[t.change_id] = tasksBy[t.change_id] || []).push(t) })
  const itemsBy = {}
  raw.items.forEach(i => { (itemsBy[i.change_id] = itemsBy[i.change_id] || []).push(i) })
  const changes = raw.changes.map(c => {
    const items = itemsBy[c.id] || []
    return {
      ...c,
      items,
      itemsText: items.map(i => i.item_type + ' ' + i.item_name).join(' · ') || '-',
      short: shortTitle(c.title),
      tasks: tasksBy[c.id] || [],
    }
  })
  const changeMap = {}
  changes.forEach(c => { changeMap[c.id] = c })
  // 묶음(품목별 관리): 품목 하나 = 변경 1건. kids는 등록 순서
  const groupMap = {}
  const groups = (raw.groups || []).map(g => ({ ...g, kids: [], logs: [] }))
  groups.forEach(g => { groupMap[g.id] = g })
  changes.forEach(c => { if (c.group_id && groupMap[c.group_id]) { c.group = groupMap[c.group_id]; groupMap[c.group_id].kids.push(c) } })
  ;(raw.groupLogs || []).forEach(l => { if (groupMap[l.group_id]) groupMap[l.group_id].logs.push(l) })
  groups.forEach(g => { g.kids.sort((a, b) => (a.group_no ?? 1e9) - (b.group_no ?? 1e9)); g.kids.forEach((k, i) => { k.kidNo = i + 1 }) })
  const reads = {}
  raw.reads.forEach(r => { reads[r.user_id + '|' + r.change_id] = r.last_read_id })
  return {
    people,
    profiles: active,                  // 재직자만 (조직도·@부르기·안 읽은 사람 수)
    depts: raw.depts,
    changes,
    changeMap,
    groups: groups.filter(g => g.kids.length),
    groupMap,
    tasks: raw.tasks,
    taskLogs: raw.taskLogs,
    changeLogs: raw.changeLogs,
    presets: raw.presets,
    templates: raw.templates,
    messages: raw.messages,
    reads,
  }
}

export async function loadRaw() {
  // 묶음 표는 upgrade9 이후에 생김 → 없으면 빈 목록
  const soft = p => p.catch(() => [])
  const [profiles, changes, items, tasks, taskLogs, changeLogs, presets, templates, messages, reads, depts, groups, groupLogs] = await Promise.all([
    fetchAll('profiles', ['id'], null, 'id,name,email,department,created_at,left_at'),
    fetchAll('change_requests', ['created_at', 'id']),
    fetchAll('change_items', ['id']),
    fetchAll('tasks', ['created_at', 'id']),
    fetchAll('task_logs', ['id']),
    fetchAll('change_logs', ['id']),
    fetchAll('assign_presets', ['created_at', 'id']),
    fetchAll('templates', ['sort_order', 'id'], q => q.eq('change_type', '포장지 변경').eq('active', true)),
    fetchAll('messages', ['id']),
    fetchAll('message_reads', ['user_id', 'change_id']),
    fetchAll('departments', ['sort_order', 'name']),
    soft(fetchAll('change_groups', ['created_at', 'id'])),
    soft(fetchAll('group_logs', ['id'])),
  ])
  return { profiles, changes, items, tasks, taskLogs, changeLogs, presets, templates, messages, reads, depts, groups, groupLogs }
}

// 앱 전체 데이터: 처음에 한 번 모두 불러오고, 누가 무엇을 바꾸면 실시간으로 다시 불러옴
export function useAppData(userId) {
  const [db, setDb] = useState(null)
  const [err, setErr] = useState('')
  const timer = useRef(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    try {
      let raw
      try {
        raw = await loadRaw()
      } catch (e) {
        // 로그인 기간이 지난 상태로 요청한 경우: 먼저 연장하고 한 번 더
        const m = String((e && (e.message || e.code)) || '')
        if (!/JWT|expired|401|PGRST30/i.test(m)) throw e
        await supabase.auth.refreshSession()
        raw = await loadRaw()
      }
      if (alive.current) { setDb(buildDb(raw)); setErr('') }
    } catch (e) {
      if (alive.current) setErr((e && e.message) || String(e))
    }
  }, [])

  const soon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(reload, 350)
  }, [reload])

  useEffect(() => {
    alive.current = true
    reload()
    const ch = supabase.channel('pruon-live')
    ;['messages', 'message_reads', 'tasks', 'change_requests', 'assign_presets', 'departments', 'templates', 'change_groups', 'group_logs'].forEach(table => {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, soon)
    })
    ch.subscribe()
    // 화면으로 다시 돌아오면 최신으로
    const onVis = async () => {
      if (document.visibilityState !== 'visible') return
      // 절전·오래 둔 뒤 돌아오면 로그인부터 연장하고 다시 불러오기
      try { await supabase.auth.getSession() } catch (e) { /* 다음 시도에서 */ }
      soon()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    window.addEventListener('online', onVis)
    return () => {
      alive.current = false
      clearTimeout(timer.current)
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
      window.removeEventListener('online', onVis)
    }
  }, [userId, reload, soon])

  // 읽음 표시를 서버 응답 전에 먼저 화면에 반영
  const markReadLocal = useCallback((changeId, lastId) => {
    setDb(prev => {
      if (!prev) return prev
      const k = userId + '|' + changeId
      if ((prev.reads[k] || 0) >= lastId) return prev
      return { ...prev, reads: { ...prev.reads, [k]: lastId } }
    })
  }, [userId])

  return { db, err, reload, markReadLocal }
}
