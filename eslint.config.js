const js = require('@eslint/js');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  js.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    files: ['eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs'
    }
  },
  {
    files: ['plugin.js'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',
      globals: {
        Agtk: 'readonly',
        cc: 'readonly',
        jsb: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none' }]
    }
  }
];
