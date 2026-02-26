import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { resolve } from 'path';
import { readFileSync, writeFileSync, readdirSync } from 'fs';

/**
 * Vite plugin that fixes CRXJS MAIN world content script loaders.
 *
 * CRXJS generates loaders that use dynamic import("./module.js") for content scripts.
 * In ISOLATED world, CRXJS uses chrome.runtime.getURL() which works fine.
 * In MAIN world, chrome.runtime is unavailable, so CRXJS falls back to relative paths.
 * Relative paths resolve against the PAGE's origin, not the extension's, causing silent failure.
 *
 * This plugin post-processes the build output:
 * 1. Finds MAIN world loader files (named *main-world*loader*.js)
 * 2. Extracts the module filename from the dynamic import
 * 3. Reads the actual module code
 * 4. Replaces the loader with an IIFE containing the inlined module code
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
          // Pattern: import("./main-world.ts-HASH.js") or import("./main-world.ts-HASH.js")
          const importMatch = loaderCode.match(/import\(\s*(?:\/\*.*?\*\/\s*)?["']\.\/([^"']+)["']\s*\)/);

          if (!importMatch) {
            console.warn(`[inline-main-world] Could not find dynamic import in ${loaderName}`);
            continue;
          }

          const moduleName = importMatch[1];
          const modulePath = resolve(assetsDir, moduleName);

          try {
            let moduleCode = readFileSync(modulePath, 'utf-8');

            // Strip any ES module syntax (import/export) since we're inlining into an IIFE
            // Remove import statements
            moduleCode = moduleCode.replace(/^\s*import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, '');
            moduleCode = moduleCode.replace(/^\s*import\s*\{[^}]*\}\s*from\s+['"][^'"]+['"];?\s*$/gm, '');
            moduleCode = moduleCode.replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '');
            // Remove export statements
            moduleCode = moduleCode.replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
            moduleCode = moduleCode.replace(/^\s*export\s+default\s+/gm, '');
            moduleCode = moduleCode.replace(/^\s*export\s+/gm, '');

            // Wrap in IIFE
            const inlinedCode = `(function(){\n'use strict';\n${moduleCode.trim()}\n})();\n`;

            writeFileSync(loaderPath, inlinedCode);
            console.log(
              `[inline-main-world] Inlined ${moduleName} (${moduleCode.length} bytes) into ${loaderName}`
            );
          } catch (err) {
            console.warn(`[inline-main-world] Could not read module ${moduleName}:`, err);
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
