import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Emits /sw.js with this build's version and the exact list of files to
 * precache, so the app works offline after one visit and every deploy
 * replaces the previous cache cleanly.
 */
function serviceWorker(): Plugin {
  const publicFiles = (dir: string, prefix = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? publicFiles(join(dir, e.name), `${prefix}${e.name}/`) : [`/${prefix}${e.name}`],
    );

  return {
    name: 'music-galaxy-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['/', '/index.html', ...Object.keys(bundle).map((f) => `/${f}`), ...publicFiles('public')];
      // Fonts: only the modern Latin subsets up front; browsers fetch other
      // subsets on demand and the runtime cache keeps them.
      const wanted = (f: string) =>
        !f.endsWith('.map') && (!/\.woff2?$/.test(f) || (f.endsWith('.woff2') && /-latin-\d/.test(f)));
      const precache = [...new Set(files)].filter(wanted).sort();
      const template = readFileSync('src/sw.template.js', 'utf8');
      // Hash the worker's own code too, so a caching fix alone still rolls the cache.
      const version = createHash('sha256').update(template).update(precache.join('\n')).digest('hex').slice(0, 12);
      const source = template
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    // three/webgpu alone is ~900 kB minified (~250 kB gzip); the whole app is that renderer.
    chunkSizeWarningLimit: 1100,
  },
});
