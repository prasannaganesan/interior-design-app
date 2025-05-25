import type { Plugin } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

export function onnxPlugin(): Plugin {
  const wasmFiles = [
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.jsep.wasm'
  ];

  return {
    name: 'vite:onnx',
    config() {
      // Ensure public directory exists
      if (!existsSync('public')) {
        mkdirSync('public', { recursive: true });
      }

      // Copy WASM files
      for (const file of wasmFiles) {
        const src = resolve('node_modules/onnxruntime-web/dist', file);
        if (existsSync(src)) {
          copyFileSync(src, resolve('public', file));
        }
      }

      return {
        optimizeDeps: {
          exclude: ['onnxruntime-web']
        },
        resolve: {
          alias: {
            'onnxruntime-web': resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort.all.min.js')
          }
        }
      };
    }
  };
} 