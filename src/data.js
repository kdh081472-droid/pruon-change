import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'

// Supabase는 한 번에 최대 1000줄까지 주므로 나눠서 모두 가져옴
async function fetchAll(table, orderCols, build) {
  const size = 1000
  const out = []
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select('*')
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
  const people = {}
  raw.profiles.forEach(p => { people[p.id] = p })
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
  const reads = {}
  raw.reads.forEach(r => { reads[r.user_id + '|' + r.change_id] = r.last_read_id })
  return {
    people,
    profiles: raw.profiles,
    changes,
    changeMap,
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
  const [profiles, changes, items, tasks, taskLogs, changeLogs, presets, templates, messages, reads] = await Promise.all([
    fetchAll('profiles', ['id']),
    fetchAll('change_requests', ['created_at', 'id']),
    fetchAll('change_items', ['id']),
    fetchAll('tasks', ['due_date', 'created_at', 'id']),
    fetchAll('task_logs', ['id']),
    fetchAll('change_logs', ['id']),
    fetchAll('assign_presets', ['created_at', 'id']),
    fetchAll('templates', ['sort_order', 'id'], q => q.eq('change_type', '포장지 변경')),
    fetchAll('messages', ['id']),
    fetchAll('message_reads', ['user_id', 'change_id']),
  ])
  return { profiles, changes, items, tasks, taskLogs, changeLogs, presets, templates, messages, reads }
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
    ;['messages', 'message_reads', 'tasks', 'change_requests', 'assign_presets'].forEach(table => {
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
