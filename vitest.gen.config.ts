import { defineConfig } from 'vitest/config';
// Runs the payload generators used for After Effects integration tests.
export default defineConfig({ test: { include: ['scripts/**/*.gen.ts'], testTimeout: 120000 } });
