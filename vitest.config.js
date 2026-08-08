import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // espone describe/it/expect/suite come globali
    environment: 'node',
    setupFiles: ['./tests/setup-webcrypto.js'],
    include: ['tests/**/*.test.js'],
  },
});
