import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      // __BUILD_ID__ is injected by vite's define; vite.config.js runs in node.
      globals: { ...globals.browser, __BUILD_ID__: 'readonly' },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Uppercase names are components, and a component used only as <Icon /> is used.
      // The vars pattern already said so; destructured parameters were not covered, and
      // that false positive is what convinced someone to delete a live binding.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: ['vite.config.js', 'eslint.config.js', 'scripts/**/*.mjs', 'src/lib/*.mjs', 'src/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
])
