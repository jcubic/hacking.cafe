import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
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
                    src: 'favicon',
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
