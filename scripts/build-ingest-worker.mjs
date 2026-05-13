/**
 * Bundle le worker d’ingestion pour Node 22 (sans tsx) : un seul fichier ESM
 * avec tout le code applicatif ; mongodb, bullmq, ioredis restent externes.
 */
import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const outfile = path.join(root, 'worker/dist/worker.mjs');

await esbuild.build({
  entryPoints: [path.join(root, 'worker/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile,
  packages: 'external',
  logLevel: 'info',
});

console.log('[build-ingest-worker] OK →', outfile);
