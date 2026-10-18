export const DAY = 86400000

export function todayMid() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
export function parse(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function iso(x) {
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
}
export function add(x, n) {
  const r = new Date(x)
  r.setDate(r.getDate() + n)
  return r
}
export function md(x) {
  const d = typeof x === 'string' ? parse(x) : x
  return d.getMonth() + 1 + '/' + d.getDate()
}
// 오늘 기준 남은 일수 (음수 = 지연)
export function dd(x) {
  const d = typeof x === 'string' ? parse(x) : x
  return Math.round((d - todayMid()) / DAY)
}
export function diffDays(a, b) {
  return Math.round((parse(a) - parse(b)) / DAY)
}
export function ddLabel(n) {
  return n < 0 ? -n + '일 지연' : n === 0 ? '오늘 마감' : 'D-' + n
}
export function dayTxt(n) {
  return n > 0 ? '전환 ' + n + '일 전' : n === 0 ? '전환 당일' : '전환 ' + -n + '일 후'
}
// 서버 시각 → "10/18 14:20" (한국 시간)
export function stamp(ts) {
  if (!ts) return ''
  const p = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ts))
  const g = t => (p.find(x => x.type === t) || {}).value || ''
  return `${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`
}
// 서버 시각 → "2026-10-18 14:20"
export function stampFull(ts) {
  if (!ts) return '-'
  const p = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ts))
  const g = t => (p.find(x => x.type === t) || {}).value || ''
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`
}
export function norm(x) {
  return String(x || '').toLowerCase().replace(/\s+/g, '')
}
export function snip(t, n) {
  t = String(t || '').replace(/\s+/g, ' ')
  return t.length > n ? t.slice(0, n) + '…' : t
}
// 서버 오류 문구를 사람이 읽을 수 있게
export function errText(e) {
  const m = (e && (e.message || e.error_description)) || String(e || '')
  if (m.includes('permission denied')) return '권한이 없습니다.'
  if (m.includes('row-level security')) return '권한이 없습니다.'
  if (m.includes('duplicate key') && m.includes('assign_presets')) return '같은 이름의 목록이 이미 있습니다.'
  if (m.includes('Failed to fetch')) return '인터넷 연결을 확인해주세요.'
  return m || '알 수 없는 오류가 발생했습니다.'
}
