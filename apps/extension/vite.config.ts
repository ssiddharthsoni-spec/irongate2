import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { resolve } from 'path';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { buildSync } from 'esbuild';

/**
 * Vite plugin that fixes CRXJS MAIN world content script loaders.
 *
 * CRXJS generates loaders that use dynamic import("./module.js") for content scripts.
 * In MAIN world, chrome.runtime is unavailable, so imports fail silently.
 *
 * Fix: after Vite builds, we use esbuild to re-bundle the main-world module
 * (and all its dependencies) into a single self-contained IIFE. No import
 * stripping, no variable collision hacks — esbuild handles it properly.
 */
function inlineMainWorldPlugin() {
  return {
    name: 'inline-main-world',
    closeBundle() {
      const assetsDir = resolve(__dirname, 'dist/assets');

      try {
        const files = readdirSync(assetsDir);

        // Find MAIN world loader files
        const loaderFiles = files.filter(
          (f) => f.includes('main-world') && f.includes('loader') && f.endsWith('.js')
        );

        for (const loaderName of loaderFiles) {
          const loaderPath = resolve(assetsDir, loaderName);
          const loaderCode = readFileSync(loaderPath, 'utf-8');

          // Extract the module filename from the dynamic import
          const importMatch = loaderCode.match(/import\(\s*(?:\/\*.*?\*\/\s*)?["']\.\/([^"']+)["']\s*\)/);

          if (!importMatch) {
            console.warn(`[inline-main-world] Could not find dynamic import in ${loaderName}`);
            continue;
          }

          const moduleName = importMatch[1];
          const modulePath = resolve(assetsDir, moduleName);

          try {
            // Use esbuild to bundle the module + all its dependencies into a
            // single IIFE. esbuild properly handles variable scoping, tree-shaking,
            // and minification — no manual regex hacking needed.
            const result = buildSync({
              entryPoints: [modulePath],
              bundle: true,
              format: 'iife',
              write: false,
              minify: true,
              // Resolve bare imports from the assets directory
              absWorkingDir: assetsDir,
              logLevel: 'warning',
            });

            if (result.outputFiles && result.outputFiles.length > 0) {
              const bundledCode = result.outputFiles[0].text;
              writeFileSync(loaderPath, bundledCode);
              console.log(
                `[inline-main-world] Bundled ${moduleName} → ${loaderName} (${bundledCode.length} bytes, self-contained IIFE)`
              );
            } else {
              console.warn(`[inline-main-world] esbuild produced no output for ${moduleName}`);
            }
          } catch (err) {
            console.warn(`[inline-main-world] esbuild bundle failed for ${moduleName}:`, err);
          }
        }
      } catch (err) {
        console.warn('[inline-main-world] Plugin error:', err);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    inlineMainWorldPlugin(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  base: './',
  build: {
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
});
