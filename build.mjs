import { cpSync, mkdirSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const copyStatic = () => {
  cpSync('public', 'dist', { recursive: true });
  cpSync('src/popup.html', 'dist/popup.html');
  cpSync('src/popup.css', 'dist/popup.css');
};

const options = {
  entryPoints: ['src/background.ts', 'src/popup.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  plugins: [{ name: 'static', setup: (build) => build.onEnd(copyStatic) }]
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
