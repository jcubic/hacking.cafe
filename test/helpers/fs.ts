/*
 *  An in-memory LightningFS for tests.
 *
 *  The real thing is used rather than a stub: the bash module leans on the
 *  details of this filesystem (mode bits, symlinks, ENOENT errors, lstat vs
 *  stat), and a hand written double would only prove that the double behaves
 *  the way the test author imagined.
 *
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
import LightningFS from '@isomorphic-git/lightning-fs';
import path from 'path-browserify';

import type { PromisifiedFS } from '../../src/bash/types';

export type FileSpec = string | { content?: string; mode?: number; link?: string };

export type Fixture = Record<string, FileSpec>;

// the type of the `db` option, which is the interface a backend implements
type Backend = NonNullable<NonNullable<ConstructorParameters<typeof LightningFS>[1]>['db']>;

// LightningFS hangs MemoryBackend off its default export at runtime, but the
// type definitions it ships know nothing about it
const { MemoryBackend } = LightningFS as unknown as {
    MemoryBackend: new () => Backend;
};

let counter = 0;

// LightningFS arms a ten minute lock timeout that it never clears, which would
// keep Node's event loop alive well past the end of the run. It is armed while
// the filesystem activates, so the timer only has to be unref'd for that window
async function activate(fs: PromisifiedFS) {
    const native = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) => {
        const timer = native(fn, ms, ...args);
        (timer as unknown as { unref?: () => void }).unref?.();
        return timer;
    }) as typeof globalThis.setTimeout;
    try {
        // any operation activates the filesystem
        await fs.readdir('/');
    } finally {
        globalThis.setTimeout = native;
    }
}

// -----------------------------------------------------------------------------
// create a filesystem populated from a { path: content } description. Parent
// directories are created on demand, so a fixture only has to name its files
// -----------------------------------------------------------------------------
export async function create_fs(fixture: Fixture = {}): Promise<PromisifiedFS> {
    const name = `test-${++counter}`;
    const fs = new LightningFS(name, {
        db: new MemoryBackend(),
        wipe: true
    }).promises as PromisifiedFS;
    await activate(fs);
    for (const [name, spec] of Object.entries(fixture)) {
        await write(fs, name, spec);
    }
    return fs;
}

// -----------------------------------------------------------------------------
export async function mkdirp(fs: PromisifiedFS, dir: string) {
    const parts = dir.split('/').filter(Boolean);
    let pathname = '/';
    for (const part of parts) {
        pathname = path.join(pathname, part);
        try {
            await fs.stat(pathname);
        } catch {
            await fs.mkdir(pathname);
        }
    }
}

// -----------------------------------------------------------------------------
async function write(fs: PromisifiedFS, filename: string, spec: FileSpec) {
    const dir = path.dirname(filename);
    if (dir !== '/') {
        await mkdirp(fs, dir);
    }
    if (typeof spec === 'string') {
        // a fixture value that ends in a slash is a directory
        if (filename.endsWith('/')) {
            await mkdirp(fs, filename);
            return;
        }
        await fs.writeFile(filename, spec);
        return;
    }
    if (spec.link) {
        await fs.symlink(spec.link, filename);
        return;
    }
    await fs.writeFile(filename, spec.content ?? '');
    if (spec.mode !== undefined) {
        await fs.chmod(filename, spec.mode);
    }
}

// -----------------------------------------------------------------------------
// the shape of a system the shell can actually boot into: a home directory,
// /bin on $PATH and a passwd entry for the user
// -----------------------------------------------------------------------------
export function system(user = 'guest'): Fixture {
    return {
        [`/home/${user}/.bashrc`]: `PATH=/bin\n`,
        '/bin/': '',
        '/etc/passwd': `root:x:0:0:root:/root:/bin/bash\n` +
            `${user}:x:502:502:Guest User:/home/${user}:/bin/bash\n`
    };
}
