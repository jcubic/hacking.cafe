import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
    resolve: {
        // npm-linked packages (e.g. jquery.terminal during local dev) resolve
        // to their real path outside node_modules, which breaks Rollup's
        // CJS/ESM interop detection for the build unless symlinks are preserved
        preserveSymlinks: true
    },
    plugins: [
        viteStaticCopy({
            targets: [
                {
                    src: 'api/jargon/*',
                    dest: '.'
                },
                {
                    src: 'api/index.php',
                    dest: '.'
                },
                {
                    src: 'api/vendor/**',
                    dest: '.'
                }
            ]
        })
    ]
});
