import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * O `strict` do TypeScript ja cobre tipos; o que ele NAO cobre — e o que mais
 * doeu neste projeto — sao as dependencias de `useEffect`. Varias foram
 * ajustadas na mao durante o desenvolvimento, e o plugin de react-hooks aponta
 * isso na hora.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo'] },

  // --- Front: React no navegador ---
  {
    files: ['web/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Chamadas sem await sao marcadas com `void` de proposito no codigo de
      // midia (replaceTrack, setParameters); avisar nisso seria so ruido.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  // --- Servidor: Node ---
  {
    files: ['server/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },

  // --- Bancada de teste: o dublê precisa de casts que o codigo real evita ---
  {
    files: ['web/**/*.test.ts', 'web/src/rtc/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
