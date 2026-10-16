import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key && !key.startsWith('여기에'))

export const supabase = createClient(
  url || 'http://localhost',
  key || 'missing-key'
)

export const DEPARTMENTS = ['품질', '제품개발', '구매', '생산', '영업', '물류']
export const EMAIL_DOMAIN = 'pruon.com'
