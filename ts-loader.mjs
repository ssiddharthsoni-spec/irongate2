// Custom Node.js loader that resolves extensionless imports to .ts files
import { resolve as pathResolve } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

export async function resolve(specifier, context, nextResolve) {
  // Only handle relative imports without file extensions
  if (specifier.startsWith('.') && !specifier.match(/\.\w+$/)) {
    let parentDir;
    if (context.parentURL) {
      const parentPath = fileURLToPath(context.parentURL);
      parentDir = parentPath.substring(0, parentPath.lastIndexOf('/'));
    } else {
      parentDir = process.cwd();
    }

    const resolved = pathResolve(parentDir, specifier);

    // Try .ts first, then /index.ts
    if (existsSync(resolved + '.ts')) {
      return {
        url: pathToFileURL(resolved + '.ts').href,
        shortCircuit: true,
      };
    }
    if (existsSync(resolved + '/index.ts')) {
      return {
        url: pathToFileURL(resolved + '/index.ts').href,
        shortCircuit: true,
      };
    }
    if (existsSync(resolved + '.js')) {
      return {
        url: pathToFileURL(resolved + '.js').href,
        shortCircuit: true,
      };
    }
  }

  // Handle paths like '../shared/context-analyzer'
  if (specifier.startsWith('..') && !specifier.match(/\.\w+$/)) {
    let parentDir;
    if (context.parentURL) {
      const parentPath = fileURLToPath(context.parentURL);
      parentDir = parentPath.substring(0, parentPath.lastIndexOf('/'));
    } else {
      parentDir = process.cwd();
    }

    const resolved = pathResolve(parentDir, specifier);

    if (existsSync(resolved + '.ts')) {
      return {
        url: pathToFileURL(resolved + '.ts').href,
        shortCircuit: true,
      };
    }
    if (existsSync(resolved + '/index.ts')) {
      return {
        url: pathToFileURL(resolved + '/index.ts').href,
        shortCircuit: true,
      };
    }
  }

  return nextResolve(specifier, context);
}
