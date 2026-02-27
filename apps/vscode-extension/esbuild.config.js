const { build } = require('esbuild');

const isWatch = process.argv.includes('--watch');

build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !isWatch,
  ...(isWatch ? { watch: true } : {}),
}).then(() => {
  console.log(isWatch ? 'Watching for changes...' : 'Build complete');
}).catch(() => process.exit(1));
