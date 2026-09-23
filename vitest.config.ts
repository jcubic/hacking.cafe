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

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

// the vite config is not reused here: its only job is the static-copy plugin
// for the production bundle, which has nothing to do with the test run - the
// `~` alias (used by src/bash/index.ts for package.json) is all that is shared
export default defineConfig({
    resolve: {
        alias: {
            '~': root
        }
    },
    test: {
        // the bash module only needs BroadcastChannel/Blob/Worker, and the
        // first two exist in Node - Worker is stubbed per test, see
        // test/helpers/worker.ts
        environment: 'node',
        include: ['test/**/*.test.ts'],
        setupFiles: ['test/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'json'],
            include: ['src/bash/**/*.ts'],
            // the worker prelude is a template of browser-only code that is
            // never evaluated on this side of the postMessage boundary
            exclude: ['src/bash/process.js']
        }
    }
});
