import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key && !key.startsWith('여기에'))

// 로그인 유지: 브라우저에 저장하고, 만료 전에 자동으로 연장
export const supabase = createClient(url || 'http://localhost', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

// 부서 목록은 서버의 부서 표(departments)에서 불러와 setDepts로 채움 (아래는 불러오기 전 기본값)
// 다른 파일에서 import한 ORDER·SHORT 등은 setDepts 이후 자동으로 새 값이 보임
// 할 일을 맡는 부서 (업무 부서, 화면에 나오는 순서)
export let ORDER = ['제품개발', '품질', '구매', '영업', '생산', '물류']
// 보기 전용 부서
export let VIEW_DEPTS = ['임원']
// 가입·부서 선택에 쓰는 전체 목록
export let SIGNUP_DEPTS = [...ORDER, ...VIEW_DEPTS]
export const SHORT = { 제품개발: '개발', 품질: '품질', 구매: '구매', 영업: '영업', 생산: '생산', 물류: '물류', 임원: '임원' }
export function setDepts(rows) {
  if (!rows || !rows.length) return
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  ORDER = sorted.filter(d => d.kind === '업무').map(d => d.name)
  VIEW_DEPTS = sorted.filter(d => d.kind === '보기').map(d => d.name)
  SIGNUP_DEPTS = sorted.map(d => d.name)
  sorted.forEach(d => { SHORT[d.name] = d.short })
}
export const isViewDept = d => VIEW_DEPTS.includes(d) || !ORDER.includes(d)
export const EMAIL_DOMAIN = 'pruon.com'
export const ITEM_TYPES = ['단품', '번들/기획상품', '띠지', '박스', '원료', '기타']
