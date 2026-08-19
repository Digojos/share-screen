import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// O contrato de eventos vive em server/src/types.ts e e importado aqui como
// `@shared`. Como fica fora da raiz do Vite, o acesso precisa ser liberado.
const sharedTypes = fileURLToPath(new URL('../server/src/types.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': sharedTypes },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
  },
});
