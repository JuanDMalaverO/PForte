import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Una dependencia de Magenta (protobufjs) usa la variable `global` de Node.
  define: { global: 'globalThis' },
  resolve: {
    // basic-pitch y Magenta traen cada uno su copia de TensorFlow.js; dos copias
    // en la misma página pisan el registro global de kernels. Forzamos una sola.
    dedupe: ['@tensorflow/tfjs', '@tensorflow/tfjs-core', '@tensorflow/tfjs-backend-webgl', '@tensorflow/tfjs-backend-cpu'],
  },
})
