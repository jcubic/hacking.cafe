/*
 *  Bash builtins, some of them on Linux/Unix are normal programs
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
import parse_options from '@jcubic/lily';
import path from 'path-browserify';
import { vsprintf } from 'sprintf-js';
import { fs_constants } from './constants';

import type { BashContext, Stats, UserData } from './types';

import {
    char,
    make_directory,
    rmdir,
    list_dir,
    mode_to_string,
    file_date,
    format_bytes,
    is_permission,
    parse_mode
} from './utils';

// -----------------------------------------------------------------------------
export function echo(this: BashContext, ...args: string[]) {
    const options = parse_options(args, {
        boolean: ['e', 'n']
    } as any);
    let output = options._.join(' ');
    if (options.e) {
        const re = /\\([\\ntbe]|0[0-9]{1,3}|x[0-9a-zA-Z]{1,2})/g
        output = output.replace(re, (_, str) => {
            switch (str[0]) {
                case '\\':
                    return '\\';
                case 'n':
                    return '\n';
                case 'b':
                    return '\b';
                case 't':
                    return '\t';
                case 'e':
                    return char(0x1b);
                case '0':
                    return char(parseInt(str.substring(1), 8));
                case 'x':
                    return char(parseInt(str.substring(1), 16));
            }
            return '';
        });
    }
    if (options.n) {
        this.stdout.write(output);
    } else {
        this.stdout.writeln(output);
    }
}

// -----------------------------------------------------------------------------
export async function grep(this: BashContext, ...args: string[]) {
    const options = parse_options(args, {
        boolean: ['i', 'v']
    });
    let [pattern, ...files] = options._;
    let content;
    if (!files.length) {
        content = await this.stdin.read();
    } else {
        const fullname = this.bash.resolve_path(files[0]);
        content = await this.fs.readFile(fullname, 'utf8');
    }
    if (options.F) {
        pattern = RegExp.escape(pattern);
    }
    const re = new RegExp(pattern, options.i ? 'i' : '');
    const lines = content.split('\n');
    for (const line of lines) {
        const match = line.match(re);
        if ((options.v && !match) || (!options.v && match)) {
            this.stdout.writeln(line);
        }
    }
}

// -----------------------------------------------------------------------------
export async function rm(this: BashContext, ...args: string[]) {
    const options = parse_options(args, { boolean: ['r'] });
    try {
        for (const file of options._) {
            const pathname = this.bash.resolve_path(file);
            const stat = await this.fs.stat(pathname);
            if (stat.isDirectory()) {
                if (options.r) {
                    rmdir(this.fs, pathname);
                } else {
                    this.stderr.writeln(`${file} is a directory`);
                }
            } else {
                this.fs.unlink(pathname);
            }
        }
    } catch(e) {
        this.stderr.writeln((e as Error).message);
    }
}

// -----------------------------------------------------------------------------
export async function cd(this: BashContext, dir?: string) {
    if (dir) {
        const dirname = this.bash.resolve_path(dir);
        try {
            const stat = await this.fs.stat(dirname);
            if (stat.isFile()) {
                this.stderr.writeln(`"${dirname}" is not directory`);
            } else {
                this.cwd = dirname == '/' ? dirname : dirname.replace(/\/$/, '');
            }
        } catch (e: any) {
            this.stderr.writeln("Directory doesn't exits");
        }
    } else {
        this.cwd = this.home;
    }
}

// -----------------------------------------------------------------------------
export async function cat(this: BashContext, ...args: string[]) {
    if (args.length === 0) {
        while (true) {
            const line = await this.stdin.read_line();
            if (line === null) {
                break;
            }
            this.stdout.write(line);
            this.stdout.flush();
        }
    } else {
        const files = [];
        for (const name of args) {
            const filename = this.bash.resolve_path(name);
            files.push(await this.fs.readFile(filename, 'utf8'));
        }
        this.stdout.write(files.join(''));
    }
}

// -----------------------------------------------------------------------------
export async function mkdir(this: BashContext, ...args: string[]) {
    const options = parse_options(args, {
        boolean: ['a', 'A', 'p']
    });
    for (const dir of options._) {
        const fullname = this.bash.resolve_path(dir);
        await make_directory(this.fs, fullname, !!options.p);
    }
}

// ---------------------------------------------------------------------
export function pwd(this: BashContext) {
    this.stdout.writeln(this.cwd);
}

// ---------------------------------------------------------------------
// @ts-expect-error
function long_ls(context: BashContext, stat: Stats) {
    return [
        mode_to_string(stat.mode),
        format_bytes(stat.size).padStart(4, ' '),
        file_date(stat.mtimeMs)
    ].join(' ') + ' ';
}

// ---------------------------------------------------------------------
export async function ls(this: BashContext, ...args: string[]) {
    const options = parse_options(args, { boolean: ['a', 'A', 'l'] });
    function filter(list: string[]) {
        if (options.a) {
            return list;
        } else if (options.A) {
            return list.filter(name => !name.match(/^\.{1,2}$/));
        } else {
            return list.filter(name => !name.match(/^\./));
        }
    }
    const dir_path = this.bash.resolve_path(options._[0] ?? '.');
    const content = await list_dir(this.fs, dir_path);
    let dirs = filter(['.', '..'].concat(content.dirs));
    let result = dirs.concat(filter(content.files));
    result = await Promise.all(result.map(async (name: string) => {
        const fullname = path.join(dir_path, name);
        const lstat = await this.fs.lstat(fullname);
        let stat;
        try {
            stat = await this.fs.stat(fullname);
        } catch(e) {
            // broken symlink
            stat = lstat;
        }
        const prefix = options.l ? long_ls(this, stat) : '';
        if (lstat.isSymbolicLink()) {
            const color = stat === lstat ? '\x1b[40;31;01m' : '\x1b[01;36m';
            return [prefix, color, name].join('') + '\x1b[m';
        }
        if (stat.isDirectory()) {
            return `${prefix}\x1b[01;34m${name}\x1b[m`;
        }
        const executable = fs_constants.S_IXUSR | fs_constants.S_IXGRP | fs_constants.S_IXOTH;
        if ((stat.mode & executable) !== 0) {
            return `${prefix}\x1b[01;32m${name}\x1b[m`;
        }
        if (name.endsWith('~')) {
            return `${prefix}\x1b[00;90m${name}\x1b[m`;
        }
        return `${prefix}${name}`;
    }));
    if (result.length) {
        this.stdout.write(result.join('\n') + '\n');
    }
}

// -----------------------------------------------------------------------------
export async function adduser(this: BashContext, ...args: string[]) {
    const options = parse_options(args);
    if (options._.length === 1) {
        const [ user ] = options._;
        const home = path.join('/home/', user);
        try {
            await this.fs.stat(home);
        } catch(e) {
            await this.bash.exec('mkdir', '-p', home);
        }
        const bashrc_path = path.join('/home/', user, '.bashrc');
        try {
            await this.fs.stat(bashrc_path);
        } catch(e) {
            const bashrc = [
                String.raw`PS1="\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "`,
                'PATH=/bin/',
                ''
            ].join('\n');
            await this.fs.writeFile(`${home}/.bashrc`, bashrc);
        }
        let users = await this.bash.users();
        if (!users.some((data: UserData) => data.username === user)) {
            const passwd = users.map(user => user.text).concat([
                `${user}:x:502:502:Guest User:/home/${user}:/bin/bash`,
                ''
            ]).join('\n');
            await this.fs.writeFile('/etc/passwd', passwd);
        }
    } else {
        this.stdout.writeln('Usage: useradd LOGIN');
    }
}

// -----------------------------------------------------------------------------
export async function source(this: BashContext, ...args: string[]) {
    const options = parse_options(args);
    if (options._.length === 1) {
        const filename = this.bash.resolve_path(options._[0]);
        const file = await this.fs.readFile(filename, 'utf8');
        this.bash.evaluate(file);
    }
}

// -----------------------------------------------------------------------------
export async function chmod(this: BashContext, ...args: string[]) {
    const options = parse_options(args, { boolean: ['R'] });
    if (options._.length > 1) {
        const [ permission, ...files ] = options._;
        if (permission.match(/^[0-7]+$/)) {
            const mode = parseInt(permission, 8);
            for (const file of files) {
                const filepath = this.bash.resolve_path(file);
                await this.fs.chmod(filepath, mode);
            }
        } else if (is_permission(permission)) {
            for (const file of files) {
                const filepath = this.bash.resolve_path(file);
                const { mode } = await this.fs.stat(filepath);
                await this.fs.chmod(filepath, parse_mode(permission, mode));
            }
        }
    } else {
        this.stdout.writeln('Usage: chmod mode files');
    }
}

// -----------------------------------------------------------------------------
export async function ln(this: BashContext, ...args: string[]) {
    const options = parse_options(args, { boolean: ['s'] });
    if (!options.s) {
        throw new Error('hardlinks not supported');
    }
    if (options._.length === 2) {
        const [target, name] = options._.map((name: string) => {
            return this.bash.resolve_path(name);
        });
        try {
            await this.fs.symlink(target, name);
            return 0;
        } catch(e) {
            return 1;
        }
    }
}

// -----------------------------------------------------------------------------
export async function read(this: BashContext, ...args: string[]) {
    const options = parse_options(args);
    if (typeof options.p === 'string') {
        this.stderr.write(options.p);
        this.stderr.flush();
    }
    let input = await this.stdin.read_line();
    if (input === null) {
        return 1;
    }
    input = input.replace(/\n+$/, '');
    if (options._.length > 1) {
        let ifs;
        try {
            ifs = this.bash.get_variable('$IFS');
        } catch(e) {
        }
        ifs ??= ' \\t\\n';
        const re = new RegExp('[' + ifs + ']');
        const parts = input.split(re);
        for (let i = 0; i < options._.length; ++i) {
            const variable = options._[i] as string;
            const value = parts[i] ?? '';
            this.bash.set_variable('$' + variable, value);
        }
    } else {
        const variable = options._.length === 0 ? 'REPLY' : options._[0];
        this.bash.set_variable('$' + variable, input);
    }
    return 0;
}

// -----------------------------------------------------------------------------
export async function test(this: BashContext, ...args: string[]) {
    const options = parse_options(args);
    const { bash, fs } = this;
    async function is(filename: string, string: keyof Stats | null = null, follow = true) {
        try {
            const fullpath = bash.resolve_path(filename);
            const stat = follow ? await fs.stat(fullpath) : await fs.lstat(fullpath);
            if (string) {
                return stat[string]() ? 0 : 1;
            }
            return 0;
        } catch(e) {
            return 1;
        }
    }
    if (typeof options.d === 'string') {
        return is(options.d, 'isDirectory');
    }
    if (typeof options.e === 'string') {
        return is(options.e);
    }
    if (typeof options.f === 'string') {
        return is(options.f, 'isFile');
    }
    if (typeof options.L === 'string' || typeof options.h === 'string') {
        return is((options.L ?? options.h) as string, 'isSymbolicLink', false);
    }
    if (args.length === 3) {
        const [left, op, right] = args;
        switch (op) {
            case '=':
                return left === right ? 0 : 1;
            case '!=':
                return left !== right ? 0 : 1;
            case '<':
                return left.localeCompare(right) < 0 ? 0 : 1;
            case '>':
                return left.localeCompare(right) > 0 ? 0 : 1;
        }
        if (op[0] === '-') {
            const a = parseInt(left, 10);
            const b = parseInt(right, 10);
            switch (op) {
                case '-eq':
                    return a === b ? 0 : 1;
                case '-ge':
                    return a >= b ? 0 : 1;
                case '-gt':
                    return a > b ? 0 : 1;
                case '-le':
                    return a <= b ? 0 : 1;
                case '-lt':
                    return a < b ? 0 : 1;
                case '-ne':
                    return a !== b ? 0 : 1;
            }
        }
        throw new Error(`test: unsuported operator ${op}`);
    }
    if (args.length === 2) {
        const [op, string] = args;
        switch (op) {
            case '-n':
                return string.length > 0 ? 0 : 1;
            case '-z':
                return string.length === 0 ? 0 : 1;
        }
    }
    throw new Error('Unkown operator');
}

// -----------------------------------------------------------------------------
function unicode(str: string) {
    return String.fromCodePoint(parseInt(str, 16));
}

// -----------------------------------------------------------------------------
function unescape(str: string) {
    const re = /\\([\\ntbe"]|0[0-9]{1,3}|x[0-9a-zA-Z]{1,2}|u[0-9a-zA-Z]{4}|U[0-9a-zA-Z]{8})/g
    return str.replace(re, (_, str: string) => {
        switch (str[0]) {
            case '"':
                return '"';
            case '\\':
                return '\\';
            case 'n':
                return '\n';
            case 'b':
                return '\b';
            case 't':
                return '\t';
            case 'u':
                return unicode(str.substring(1));
            case 'U':
                return unicode(str.substring(1));
            case 'e':
                return char(0x1b);
            case '0':
                return char(parseInt(str.substring(1), 8));
            case 'x':
                return char(parseInt(str.substring(1), 16));
        }
        if (str[0].match(/[0-9]/)) {
            return char(parseInt(str.substring(1), 8));
        }
        return '';
    });
}

// -----------------------------------------------------------------------------
export async function printf(this: BashContext, ...args: string[]) {
    if (args.length === 0) {
        this.stderr.write("bash: printf: usage: printf [-v var] format [arguments]\n");
        return 2;
    }

    const format = unescape(args.shift() as string);
    const count = (format.match(/%[^%]/g) || []).length;

    if (count === 0) {
        this.stdout.write(format);
        return 0;
    }

    let i = 0;
    while (i < args.length || i === 0) {
        const chunk = args.slice(i, i + count);
        while (chunk.length < count) {
            chunk.push("");
        }
        try {
            const result = vsprintf(format, chunk);
            this.stdout.write(result);
        } catch (err) {
            this.stderr.write(`bash: printf: formatting error: ${(err as Error).message}\n`);
            return 1;
        }

        i += count;
        if (args.length === 0) {
            break;
        }
    }
    return 0;
}
