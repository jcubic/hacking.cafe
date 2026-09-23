/*
 *  Global test setup: the handful of browser APIs the bash module reaches for
 *  that Node does not provide.
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

// LightningFS guards its superblock with the Web Locks API. Node has a
// `navigator`, but no `navigator.locks`, and without it LightningFS falls back
// to an IndexedDB based mutex that cannot work here at all. Every test gets a
// filesystem of its own (see helpers/fs.ts), so a lock that is always granted
// immediately is all that is needed.
const locks = {
    async request(_name: string, options: unknown, callback?: unknown) {
        const fn = (typeof options === 'function' ? options : callback) as
            (lock: { name: string }) => unknown;
        // the caller keeps the lock for as long as the returned promise is
        // pending; we never hand the lock to anybody else, so resolving right
        // away is equivalent and does not leave the callback's promise dangling
        return await fn({ name: _name });
    }
};

Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: locks
});

// `Bash::process()` resolves /mitty.js against the document URL; in the test
// environment there is no document, only the shape the code reads from it
if (!('location' in globalThis)) {
    Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: new URL('http://localhost/')
    });
}
