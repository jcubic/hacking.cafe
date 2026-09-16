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
import rpc from '@jcubic/json-rpc';
import LightningFS from '@isomorphic-git/lightning-fs';
import path from 'path-browserify';
import { z } from 'zod';

import { $, JQueryTerminal } from './terminal';
import { make_jargon } from './jargon';
import { RPCBackend } from './fs';
import type { ListDir } from './bash/types';
import { system_details } from './utils';
import {
    Bash,
    BufferOutput,
    Stdin,
    PromisifiedFS,
    BashContext,
    Completion
} from './bash';

const DEV = import.meta.env.DEV;

const delay = 80;
const DEBUG = DEV;

const rpc_url = DEV ? 'http://localhost:8810/' : '/api/';

// shape of the object returned by the service.location() JSON-RPC method
const LocationSchema = z.object({
    ip: z.string(),
    country_code: z.string(),
    country_name: z.string(),
    region_name: z.string(),
    city_name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    zip_code: z.string(),
    time_zone: z.string(),
    asn: z.string(),
    as: z.string(),
    is_proxy: z.boolean()
});

class BufferTerminalOutput extends BufferOutput {
    protected _term: JQueryTerminal;
    constructor(term: JQueryTerminal) {
        super();
        this._term = term;
        this._buffer = [];
    }
    flush() {
        if (this._buffer.length) {
            this._term.echo(this.output(), {
                newline: false
            });
            this.clear();
        }
    }
}

class Input implements Stdin {
    protected _term: JQueryTerminal;
    constructor(term: JQueryTerminal) {
        this._term = term;
    }
    read() {
        const ret = this._term.read('');
        // scripts are pausing the terminal when run
        if (this._term.paused()) {
            this._term.resume();
        }
        return ret;
    }
}

const intepreter = rpc({ url: rpc_url }).then(async (service) => {
    const _fs = new LightningFS('rpc', { db: new RPCBackend(service) as any });
    const fs = _fs.promises as unknown as PromisifiedFS;

    const user = 'guest';
    const home = `/home/${user}`;
    const host = 'hacking.cafe';

    const commands = {
        // ---------------------------------------------------------------------
        async less(this: BashContext, fname?: string) {
            let content;
            if (fname) {
                const fullname = path.resolve(this.cwd, fname);
                content = await fs.readFile(fullname, 'utf8');
            } else {
                content = await this.stdin.read();
            }
            term.less(content);
        },
        // ---------------------------------------------------------------------
        jargon: make_jargon(service),
        // ---------------------------------------------------------------------
        record(this: BashContext, ...args: string[]) {
            // toggle storing commands in URL hash
            if (args[0] === 'start') {
                term.history_state(true);
            } else if (args[0] === 'stop') {
                term.history_state(false);
            } else {
                term.echo('save commands in url hash so you can rerun them\n\n' +
                    'usage: record [stop|start]');
            }
        },
        // ---------------------------------------------------------------------
        async fetch(this: BashContext) {
            const cols = term.cols();
            const narrow_view = cols <= 65;
            const logo = neofetch.innerHTML;
            const lines = logo.split('\n');
            const gap = 3;
            const logo_width = $.terminal.length(lines[0]);
            const space = cols - logo_width - gap - 2;
            const server = `${user}@hacking.cafe`;
            const user_data = LocationSchema.parse(await service.location());

            const dark_mode = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const {
                OS,
                Browser,
                RAM,
                CPU,
                GPU,
                Resolution,
                Timezone,
                Language
            } = system_details();

            const meta = {
                OS,
                Browser,
                RAM,
                CPU,
                GPU,
                Resolution,
                'Dark Mode': `${dark_mode ? 'enabled' : 'disabled'}`,
                IP: user_data.ip,
                Terminal: `jQuery Terminal ${$.terminal.version}`,
                Location: `${user_data.city_name}, ${user_data.country_name}`,
                ISP: user_data.as,
                Timezone,
                Language
                //'Battery': battery_status
            } as const;
            const info = [
                `<white>${server}</white>`,
                '-'.repeat(server.length)
            ];
            for (const [key, value] of Object.entries(meta)) {
                if (!value) {
                    continue;
                }
                const escape = $.terminal.escape_brackets(value as string);
                let formatted = `[[;white;]${escape}]`;
                const text = `[[;#F7DF1E;]${key}]: ${formatted}`;
                if (narrow_view) {
                    info.push(text);
                } else {
                    const lines = $.terminal.split_equal(text, space);
                    info.push(...lines);
                }
            }
            let result;
            if (narrow_view) {
                result = lines.concat([''], info).join('\n');
            } else {
                result = lines.map((line, index) => {
                    if (info[index]) {
                        return line + '   ' + info[index];
                    }
                    return line;
                }).join('\n');
            }
            this.stdout.writeln(result);
        },
        // ---------------------------------------------------------------------
        async rfc(this: BashContext, ...args: string[]) {
            if (args[0] == '--help') {
                term.echo('Browser of RFC documents, using less unix command.\n\n' +
                    'If you execute without arguments you will get index page\n' +
                    'And on that page you can use / followed by text, to search\n' +
                    'links to RFC documents are clickable');
            } else {
                try {
                    let arg = null;
                    if (args.length) {
                        arg =  parseInt(args[0], 10)
                        if (!Number.isInteger(arg)) {
                            this.stderr.writeln('invalid RFC number');
                        }
                    }
                    const rfc = await service.rfc(arg);
                    display_rfc(rfc as string);
                } catch (err) {
                    this.stderr.writeln((err as Error).message);
                }
            }
        },
        // ---------------------------------------------------------------------
        credits(this: BashContext) {
            const text = [
                'author: [[!b;#fff;;;https://jakub.jankiewicz.org]Jakub T. Jankiewicz]',
                '',
                'Tools, libraries, and services used:',
                '* [[!b;#fff;;;https://terminal.jcubic.pl/]jQuery Terminal]',
                '* [[!b;#fff;;;https://github.com/patorjk/figlet.js]Figlet.js] + Modular ' +
                    'and Rectangles fonts',
                '* [[!b;#fff;;;http://catb.org/jargon/html/index.html]Jargon File] 4.4.7',
                '* [[!b;#fff;;;https://www.rfc-editor.org/]RFC Editor]',
                '* [[!b;#fff;;;https://codepen.io/Boowoa/full/abxxXqb]JS ASCII logo] by @Boowoa',
                ''
            ].join('\n');
            this.stdout.writeln(text);
        },
        // ---------------------------------------------------------------------
        async help(this: BashContext) {
            function command_list() {
                const list = bash.commands;
                list.push('clear');
                return list.map(cmd => `<command>${cmd}</command>`);
            }
            const list = formatter.format(command_list());
            this.stdout.writeln(`Available commands: ${list}.`);
            const scripts = (await bash.executables('/bin')).map(cmd => {
                return `<command>/bin/${cmd}</command>`;
            });
            if (scripts.length) {
                const list = formatter.format(scripts);
                this.stdout.writeln(`Available scripts in /bin directory ${list}`);
            }
            this.stdout.writeln('An <command>rfc</command> command use simplifed unix ' +
                'less command.\n');
        }
    };

    // -------------------------------------------------------------------------
    term.on('click', 'a.jargon', function(this: any) {
        const href = $(this).attr('href') as string;
        term.exec(`jargon ${href}`, { typing: true, delay });
        return false;
    }).on('click', 'a.command', function(this: any) {
        const command = $(this).attr('href') as string;
        term.exec(command, { typing: true, delay });
        return false;
    }).on('click', 'a.rfc', function(this: any) {
        const command = $(this).attr('href') as string;
        // are we inside RFC browser?
        if (term.level() >= 2) {
            bash.exec('rfc', command);
        } else {
            term.exec(`rfc ${command}`, { typing: true, delay });
        }
        return false;
    });

    // -------------------------------------------------------------------------
    const completion = async function(this: JQueryTerminal, string: string) {
        var cmd = $.terminal.parse_command(this.before_cursor());
        if (cmd.name !== string) {
            switch (cmd.name) {
                case 'cat':
                case 'rm':
                case 'less':
                    return await bash.completion(string, Completion.File);
                case 'ls':
                case 'cd':
                    return await bash.completion(string, Completion.Directory);
            }
        }
        return bash.commands;
    };

    term.option('completion', completion);

    const stdout = new BufferTerminalOutput(term);
    const stderr = new BufferTerminalOutput(term);
    const stdin = new Input(term);

    const bash = new Bash(commands, {
        stdout,
        stderr,
        stdin,
        fs,
        user,
        host,
        home
    });

    // for debugging
    (window as any).term = term;
    (term as any).fs = fs;

    // intialize the file system after update or deleting of files
    const paths = await service.init_list() as ListDir;
    for (const pathname of paths.dirs) {
        try {
            const stat = await fs.stat(pathname);
            if (stat.isFile()) {
                await fs.unlink(pathname);
                make_dir(pathname);
            }
        } catch(e) {
            make_dir(pathname);
        }
    }
    for (const pathname of paths.files) {
        try {
            const stat = await fs.stat(pathname);
            if (stat.isDirectory()) {
                await bash.exec('rm', '-r', pathname);
                make_file(pathname);
            }
        } catch(e) {
            make_file(pathname);
        }
    }

    // restore user when deleted
    await bash.exec('adduser', user);

    await bash.init();

    term.set_prompt(() => {
        return bash.prompt();
    });

    // -------------------------------------------------------------------------
    async function make_file(path: string) {
        const content = await service.init_read(path) as string;
        await fs.writeFile(path, content);
        if (path.startsWith('/bin/')) {
            await bash.exec('chmod', 'a+x,g-w,a-w', path);
        }
    }

    // -------------------------------------------------------------------------
    async function make_dir(path: string) {
        await bash.exec('mkdir', '-p', path);
    }

    // -------------------------------------------------------------------------
    return [
        async function(this: JQueryTerminal, command: string) {
            try {
                await bash.evaluate(command);
            } catch(e) {
                this.error((e as Error).message);
                if (DEBUG) {
                    setTimeout(() => { throw e }, 0);
                }
            }
        },
        { rpc: rpc_url }
    ];
});

const formatter = new Intl.ListFormat('en', {
    style: 'long',
    type: 'conjunction',
});

const term = $('body').terminal(intepreter, {
    checkArity: false,
    execHash: true,
    exit: false,
    execAnimation: true,
    processArguments: false,
    execHistory: true,
    greetings: null,
    convertLinks: false,
    onInit() {
        this.echo(() => {
            const cols = this.cols();
            if (cols >= 100) {
                return greetings_big.innerHTML;
            } else if (cols >= 62) {
                return greetings_medium.innerHTML;
            } else if (cols >= 38) {
                return greetings_small.innerHTML;
            } else if (cols >= 29) {
                return greetings_smaller.innerHTML;
            } else {
                return greetings_tiny.innerHTML
            }
        });
    }
});

function display_rfc(rfc: string) {
    // RFC have leading and trailing whitespace
    rfc = rfc.trim();
    // RFC don't have any XML formatting, they are text files
    rfc = rfc.replace(/</g, '&lt;');
    rfc = rfc.replace(/>/g, '&gt;');
    term.less(rfc);
}
