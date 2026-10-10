import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // EPUB の章テキスト抽出で DOMParser / Range を使うため jsdom 環境で動かす
    environment: 'jsdom',
    include: ['src/**/*.test.ts']
  }
});
