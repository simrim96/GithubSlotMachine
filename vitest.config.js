import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // espone describe/it/expect/suite come globali
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
