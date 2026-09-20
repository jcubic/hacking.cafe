/*
 *  Helper utilities
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
import path from 'path-browserify';

import type { ListDir, PromisifiedFS } from './types';
import { fs_constants } from './constants';

// -----------------------------------------------------------------------------
export function char(int: number) {
    return String.fromCharCode(int);
}

// -----------------------------------------------------------------------------
export function date() {
    return new Date().toLocaleString('en', {
        weekday: "short",
        month: "short",
        day: "numeric",
    });
}

// -----------------------------------------------------------------------------
export async function make_directory(fs: PromisifiedFS, dir: string, parent = false) {
    if (parent) {
        const parts = dir.split('/').filter(part => part !== '');
        if (!parts.length) {
            throw new Error('Invalid argument');
        }
        let full_path = '/';
        for (const part of parts) {
            full_path = path.join(full_path, part);
            const stat = await stat_or_null(fs, full_path);
            if (!stat) {
                await fs.mkdir(full_path);
            } else if (stat.isFile()) {
                throw new Error(`${full_path} is a file`);
            }
        }
    } else {
        const stat = await stat_or_null(fs, dir);
        if (!stat) {
            await fs.mkdir(dir);
        } else if (stat.isDirectory()) {
            throw new Error('Directory already exists');
        } else if (stat.isFile()) {
            throw new Error(`${dir} is a File`);
        }
    }
}

// -----------------------------------------------------------------------------
export async function rmdir(fs: PromisifiedFS, dir: string) {
    const list = await fs.readdir(dir);
    for(const name of list) {
        const pathname = path.join(dir, name);
        const stat = await fs.stat(pathname);
        if (!pathname.match(/^\.{1,2}$/)) {
            if(stat.isDirectory()) {
                await rmdir(fs, pathname);
            } else {
                await fs.unlink(pathname);
            }
        }
    }
    // you can delete root directory
    if (dir !== '/') {
        await fs.rmdir(dir);
    }
}

// -----------------------------------------------------------------------------
async function stat_or_null(fs: PromisifiedFS, path: string) {
    try {
        return await fs.stat(path);
    } catch (e) {
        return null;
    }
}

// -----------------------------------------------------------------------------
export async function list_dir(fs: PromisifiedFS, dir: string): Promise<ListDir> {
    const dir_list = await fs.readdir(dir);
    const files: string[] = [];
    const dirs: string[] = [];
    for (const name of dir_list) {
        const file = path.join(dir, name);
        try {
            let stat;
            try {
                stat = await fs.stat(file);
            } catch(e) {
                const lstat = await fs.lstat(file);
                if (!lstat.isSymbolicLink()) {
                    throw new Error('Internal error');
                }
                files.push(name);
                continue;
            }
            if (stat.isFile()) {
                files.push(name);
            } else {
                dirs.push(name);
            }
        } catch(e) {
            throw new Error(`Internal: scaned file ${file} doesn't exist`);
        }
    }
    return { files, dirs };
}

// -----------------------------------------------------------------------------
export async function list_executables(fs: PromisifiedFS, dir: string): Promise<string[]> {
    const executable = fs_constants.S_IXUSR | fs_constants.S_IXGRP | fs_constants.S_IXOTH;
    const dir_list = await fs.readdir(dir);
    const result: string[] = [];
    for (const name of dir_list) {
        const file = path.join(dir, name);
        try {
            const stat = await fs.stat(file);
            if (stat.isFile() && (stat.mode & executable) !== 0) {
                result.push(name);
            }
        } catch(e) {
            throw new Error(`Internal: scaned file ${file} doesn't exist`);
        }
    }
    return result;
}


// -----------------------------------------------------------------------------
const COLORS = {
    blue:   '#55f',
    green:  '#4d4',
    grey:   '#999',
    red:    '#A00',
    yellow: '#FF5',
    violet: '#a320ce',
    white:  '#fff',
    'persian-green': '#0aa'
} as const;

// -----------------------------------------------------------------------------
export type COLOR = keyof typeof COLORS;

// -----------------------------------------------------------------------------
function is_color(color: any): color is COLOR {
    return Object.hasOwn(COLORS, color);
}

// -----------------------------------------------------------------------------
export function color(name: string, string: string) {
    if (is_color(name)) {
        return '[[;' + COLORS[name] + ';]' + string + ']';
    } else {
        return string;
    }
}

// -----------------------------------------------------------------------------
// ref: https://stackoverflow.com/a/18650828/387194
export function format_bytes(bytes: number, decimals = 2) {
    if (!+bytes) {
        return '0';
    }

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    const value = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
    if (i === 0) {
        return value.toString();
    }

    return `${value}${sizes[i]}`;
}

// -----------------------------------------------------------------------------
const MASKS = {
    // User
    u: { r: 0o400, w: 0o200, x: 0o100 },
    // Group
    g: { r: 0o040, w: 0o020, x: 0o010 },
    // Others
    o: { r: 0o004, w: 0o002, x: 0o001 }
};

// -----------------------------------------------------------------------------
export function mode_to_string(mode: number) {
    const perms = mode & 0o777;

    const result = {
        owner: {
            read:    (perms & MASKS.u.r) !== 0,
            write:   (perms & MASKS.u.w) !== 0,
            execute: (perms & MASKS.u.x) !== 0,
        },
        group: {
            read:    (perms & MASKS.g.r) !== 0,
            write:   (perms & MASKS.g.w) !== 0,
            execute: (perms & MASKS.g.x) !== 0,
        },
        others: {
            read:    (perms & MASKS.o.r) !== 0,
            write:   (perms & MASKS.o.w) !== 0,
            execute: (perms & MASKS.o.x) !== 0,
        }
    };

    const to_string = (r: boolean, w: boolean, x: boolean) => `${r ? 'r' : '-'}${w ? 'w' : '-'}${x ? 'x' : '-'}`;
    return [
        to_string(result.owner.read, result.owner.write, result.owner.execute),
        to_string(result.group.read, result.group.write, result.group.execute),
        to_string(result.others.read, result.others.write, result.others.execute)
    ].join('');
}

// -----------------------------------------------------------------------------
export function file_date(timestamp: number) {
    const date = new Date(timestamp);
    const locale = (new Intl.NumberFormat()).resolvedOptions().locale;
    const mon = date.toLocaleString(locale, { month: 'short' });
    const day = date.getDate().toString().padStart(2, ' ');
    const hour = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${mon} ${day} ${hour}:${min}`;
}

// -----------------------------------------------------------------------------
const permission_re = /^[ugoa][-+=][rwx](,[ugoa][-+=][rwx])*$/;

// -----------------------------------------------------------------------------
export function is_permission(arg: string) {
    return arg.match(permission_re);
}

// -----------------------------------------------------------------------------
// bit value of each permission letter, and the shift for each class
// of user it applies to within a Posix mode (eg. rwxrwxrwx)
// -----------------------------------------------------------------------------
const PERMISSION_BITS: Record<string, number> = { r: 4, w: 2, x: 1 };
const CLASS_SHIFTS: Record<string, number> = { u: 6, g: 3, o: 0 };

export function parse_mode(str: string, mode: number): number {
    return str.split(',').reduce((mode, clause) => {
        const match = clause.match(/^([ugoa])([-+=])([rwx])$/);
        if (!match) {
            return mode;
        }
        const [, who, op, perm] = match;
        const classes = who === 'a' ? ['u', 'g', 'o'] : [who];
        const bit_value = PERMISSION_BITS[perm];
        return classes.reduce((mode, cls) => {
            const shift = CLASS_SHIFTS[cls];
            const bit = bit_value << shift;
            if (op === '+') {
                return mode | bit;
            }
            if (op === '-') {
                return mode & ~bit;
            }
            // '=' sets this permission and clears the other two bits
            // within the same class (eg. u=r also clears u's w and x)
            const class_mask = 0b111 << shift;
            return (mode & ~class_mask) | bit;
        }, mode);
    }, mode);
}

// -----------------------------------------------------------------------------
// hepler function to prevent vite to preload the URL
// -----------------------------------------------------------------------------
export async function import_module(module: string) {
    return (await import(/* @vite-ignore */module)).default;
}

// -----------------------------------------------------------------------------
export function escape(text: string) {
    text = $.terminal.escape_brackets(text);
    text = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return text;
}

// -----------------------------------------------------------------------------
// Converts a standard POSIX Shell Glob pattern into a JavaScript RegExp.
// Supports: *, ?, and character classes like [a-z], [!0-9] / [^0-9]
// -----------------------------------------------------------------------------
export function glob_to_regex(glob: string, greedy = false) {
    const modifier = greedy ? '' : '?';
    const escape = '-\\^$+.()|{}/';
    let result = '';
    for (let i = 0; i < glob.length; i++) {
        const char = glob[i];
        if (char === '*') {
            result += '.*' + modifier;
        } else if (char === '?') {
            result += '.';
        } else if (char === '[') {
            const end = glob.indexOf(']', i + 1);
            if (end === -1) {
                result += '\\[';
            } else {
                const set = glob.slice(i + 1, end);
                result += '[' + (set[0] === '!' ? '^' + set.slice(1) : set) + ']';
                i = end;
            }
        } else if (escape.includes(char)) {
            result += '\\' + char;
        } else {
            result += char;
        }
    }
    return result;
}

// -----------------------------------------------------------------------------
export class Signal {
    private _code: number;
    static SIGINT = 2;
    static SIGKILL = 9;
    static SIGTERM = 15;
    constructor(code: number) {
        this._code = code;
    }
    get code() {
        return 128 + this._code;
    }
}
