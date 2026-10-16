import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' : GitHub Pages 어느 저장소 이름에서도 동작
export default defineConfig({
  plugins: [react()],
  base: './',
})
