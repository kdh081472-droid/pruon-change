import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key && !key.startsWith('여기에'))

// 로그인 유지: 브라우저에 저장하고, 만료 전에 자동으로 연장
export const supabase = createClient(url || 'http://localhost', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

// 할 일을 맡는 부서 (화면에 나오는 순서)
export const ORDER = ['제품개발', '품질', '구매', '영업', '생산', '물류']
// 보기 전용 계정
export const VIEWER = '임원'
// 가입할 때 고르는 부서
export const SIGNUP_DEPTS = [...ORDER, VIEWER]
export const SHORT = { 제품개발: '개발', 품질: '품질', 구매: '구매', 영업: '영업', 생산: '생산', 물류: '물류', 임원: '임원' }
export const EMAIL_DOMAIN = 'pruon.com'
export const ITEM_TYPES = ['단품', '번들/기획상품', '띠지', '박스', '기타']
