import js from '@eslint/js';
import tsEslint from 'typescript-eslint';

export default [
  js.configs.recommended,

  ...tsEslint.configs.recommended,

  {
    files: ['**/*.ts'],
    ignores: ['dist/**', 'node_modules/**'],

    languageOptions: {
      parser: tsEslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },

    rules: {
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-constant-condition': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@/quotes': [
        'error',
        'single',
        {
          avoidEscape: true,
          allowTemplateLiterals: true,
        },
      ],
      '@typescript-eslint/no-inferrable-types': 'off',
      'no-useless-escape': 'off',
      'no-array-constructor': 'error',
      'no-empty': [
        'error',
        { allowEmptyCatch: false },
      ],
    },
  },
];
