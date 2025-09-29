import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

const external = [
  ...builtinModules,
  ...builtinModules.map(mod => `node:${mod}`),
  '@fastify/cors',
  '@fastify/jwt',
  '@fastify/postgres',
  'fastify',
  'fastify-type-provider-zod',
  'jsonwebtoken',
  'pg',
  'zod',
];

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node18',
    lib: {
      entry: 'src/index.ts',
      fileName: () => 'index.js',
      formats: ['es'],
    },
    rollupOptions: {
      external,
      output: {
        entryFileNames: 'index.js',
        format: 'es',
        interop: 'auto',
      },
    },
  },
});
