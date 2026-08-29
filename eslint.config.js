import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ['src/tilefab/**/*.{ts,tsx}'],
    ignores: [
      'src/tilefab/**/*.test.ts',
      'src/tilefab/worker/StaticFabOrganizationBundlePlacementRuntime.ts',
      'src/tilefab/editor/StaticFabOrganizationBundlePlacementBridge.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/StaticFabOrganizationBundlePlacement'],
              importNames: ['planStaticFabOrganizationBundlePlacement'],
              message: 'Exact organization-bundle planning is restricted to its disposable Worker runtime.',
            },
            {
              group: ['**/StaticFabOrganizationBundlePlacement'],
              importNames: [
                'issueStaticFabOrganizationBundlePlacementPermit',
                'adoptStaticFabOrganizationBundlePlacementWorkerPlan',
              ],
              message: 'One-shot organization-bundle permits may only be issued or adopted by the Worker bridge.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/tilefab/worker/StaticFabOrganizationBundlePlacementRuntime.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/StaticFabOrganizationBundlePlacement'],
              importNames: [
                'issueStaticFabOrganizationBundlePlacementPermit',
                'adoptStaticFabOrganizationBundlePlacementWorkerPlan',
              ],
              message: 'One-shot organization-bundle permits may only be issued or adopted by the Worker bridge.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/tilefab/editor/StaticFabOrganizationBundlePlacementBridge.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/StaticFabOrganizationBundlePlacement'],
              importNames: ['planStaticFabOrganizationBundlePlacement'],
              message: 'Exact organization-bundle planning is restricted to its disposable Worker runtime.',
            },
          ],
        },
      ],
    },
  },
])
