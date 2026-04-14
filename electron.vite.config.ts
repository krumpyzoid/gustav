import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      outDir: 'build/main',
      rollupOptions: {
        external: ['node-pty', 'ws']
      }
    }
  },
  preload: {
    build: {
      outDir: 'build/preload'
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'build/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer')
      }
    }
  }
})
