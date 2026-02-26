import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/cine.Indica/', // <-- ADICIONE ESTA LINHA COM O NOME DO SEU REPOSITÓRIO
})