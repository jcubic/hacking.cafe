/*
 *  Copyright (c) 2026 Jakub T. Jankiewicz <https://jakub.jankiewicz.org>
 *
 *  This file is part of Hacking Cafe.
 *
 *  Hacking Cafe is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as published by
 *  the Free Software Foundation; either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  Hacking Cafe is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with Hacking Cafe.  If not, see <http://www.gnu.org/licenses/>.
 *
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '~': root
        },
        // npm-linked packages (e.g. jquery.terminal during local dev) resolve
        // to their real path outside node_modules, which breaks Rollup's
        // CJS/ESM interop detection for the build unless symlinks are preserved
        preserveSymlinks: true
    },
    plugins: [
        viteStaticCopy({
            targets: [
                {
                    // every api file, except secrets, runtime databases and editor backups
                    src: [
                        'api/**',
                        '!api/**/.env*',
                        '!api/**/*.db',
                        '!api/**/#*#',
                        '!api/**/.gitkeep',
                        '!api/**/*~'
                    ],
                    dest: '.'
                },
                {
                    src: 'public/favicon/favicon.ico',
                    dest: '.',
                    rename: { stripBase: true }
                }
            ]
        })
    ]
});
