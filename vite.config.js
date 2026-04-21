import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El dashboard hace algunas llamadas via `src/api.js` con path relativo `/api`.
// En prod Vercel sirve frontend + API en el mismo dominio. En dev necesitamos
// proxear `/api/*` al backend desplegado para que el dashboard funcione.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://missioncontrol-coral.vercel.app',
        changeOrigin: true,
      },
    },
  },
})
