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

import type { BashContext } from './types';

import { char, make_directory, rmdir, list_dir, color } from './utils';

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
    let content;
    if (args.length === 0) {
        content = await this.stdin.read();
    } else {
        const files = [];
        for (const name of args) {
            const filename = this.bash.resolve_path(name);
            files.push(await this.fs.readFile(filename, 'utf8'));
        }
        content = files.join('');
    }
    this.stdout.write(content);
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
export async function ls(this: BashContext, ...args: string[]) {
    const options = parse_options(args, { boolean: ['a', 'A'] });
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
    const dirs = filter(['.', '..'].concat(content.dirs)).map((dir: string) => {
        return color('blue', dir);
    });
    const result = dirs.concat(filter(content.files));
    if (result.length) {
        this.stdout.write(result.join('\n') + '\n');
    }
}

export async function adduser(this: BashContext, ...args: string[]) {
    const options = parse_options(args);
    if (options._.length === 1) {
        const [ user ] = options._;
        const home = `/home/${user}`;
        try {
            await this. fs.stat(home);
            throw new Error(`User ${user} already exist`);
        } catch(e) {
            await this.bash.exec('mkdir', '-p', home);

            const bashrc = [
                String.raw`PS1="\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "`,
                ''
            ].join('\n');
            await this.fs.writeFile(`${home}/.bashrc`, bashrc);

            let users = await this.bash.users();
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

export async function source(this: BashContext, ...args: string[]) {
    const options = parse_options(args);
    if (options._.length === 1) {
        const filename = this.bash.resolve_path(options._[0]);
        const file = await this.fs.readFile(filename, 'utf8');
        this.bash.evaluate(file);
    }
}
