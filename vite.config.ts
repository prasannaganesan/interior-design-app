import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { onnxPlugin } from './vite.onnx.plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    onnxPlugin()
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  build: {
    modulePreload: {
      polyfill: false
    }
  }
})
