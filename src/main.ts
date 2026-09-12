import rpc from '@jcubic/json-rpc';
import LightningFS from '@isomorphic-git/lightning-fs';
import path from 'path-browserify';

import { $, JQueryTerminal } from './terminal';
import { make_jargon } from './jargon';
import { RPCBackend } from './fs';
import { color } from './colors';
import { Bash, BufferOutput, Stdin, PromisifiedFS, BashContext } from './bash';

const DEV = import.meta.env.DEV;

const delay = 80;
const DEBUG = DEV;

const rpc_url = DEV ? 'http://localhost:8810/' : '/api/';

let completion;

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

class BufferError extends BufferTerminalOutput {
    flush() {
        if (this._buffer.length) {
            this._term.echo(`<red>${this.output()}</red>`, {
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
        return this._term.read('');
    }
}

const intepreter = rpc({ url: rpc_url }).then(service => {
    const _fs = new LightningFS('rpc', { db: new RPCBackend(service) as any });
    const fs = _fs.promises as unknown as PromisifiedFS;

    // TODO default should be ~
    const default_dir = '/';

    function char(int: number) {
        return String.fromCharCode(int);
    }

    const commands = {
        async hello(name: string) {
            await service.hello(name);
        },
        // ---------------------------------------------------------------------
        echo(this: BashContext, ...args: string[]) {
            const options = $.terminal.parse_options(args, {
                boolean: ['e', 'n']
            } as any);
            let output = options._.join(' ');
            if (options.e) {
                const re = /\\([\\ntb]|0[0-9]{1,3}|x[0-9a-zA-Z]{1,2})/g
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
        },
        async grep(this: BashContext, ...args: string[]) {
            const options = $.terminal.parse_options(args, {
                boolean: ['i', 'v']
            } as any);
            let [pattern, ...files] = options._;
            let content;
            if (!files.length) {
                content = await this.stdin.read();
            } else {
                const fullname = path.resolve(this.cwd, files[0]);
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
        },
        // ---------------------------------------------------------------------
        async rm(this: BashContext, ...args: string[]) {
            const options = $.terminal.parse_options(args);
            try {
                for (const file of args) {
                    const pathname = path.resolve(this.cwd, file);
                    const stat = await fs.stat(pathname);
                    if (stat.isDirectory()) {
                        if (options.r) {
                            rmdir(pathname);
                        } else {
                            this.stderr.writeln(`${file} is a directory`);
                        }
                    } else {
                        fs.unlink(pathname);
                    }
                }
            } catch(e) {
                this.stderr.writeln((e as Error).message);
            }
        },
        // ---------------------------------------------------------------------
        async cd(this: BashContext, dir?: string) {
            if (dir) {
                const dirname = path.resolve(this.cwd, dir);
                try {
                    const stat = await fs.stat(dirname);
                    if (stat.isFile()) {
                        this.stderr.writeln(`"${dirname}" is not directory`);
                    } else {
                        this.cwd = dirname == '/' ? dirname : dirname.replace(/\/$/, '');
                    }
                } catch (e: any) {
                    this.stderr.writeln("Directory don't exits");
                }
            } else {
                this.cwd = default_dir;
            }
        },
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
        async cat(this: BashContext, ...args: string[]) {
            let content;
            if (args.length === 0) {
                content = await this.stdin.read();
            } else {
                const files = [];
                for (const name of args) {
                    const filename = path.resolve(this.cwd, name);
                    files.push(await fs.readFile(filename, 'utf8'));
                }
                content = files.join('');
            }
            this.stdout.write(content);
        },
        // ---------------------------------------------------------------------
        mkdir: async function(this: BashContext, args: string) {
            const options = $.terminal.parse_options(args, {
                boolean: ['a', 'A']
            } as any);
            for (const dir of options._) {
                const fullname = path.resolve(this.cwd, dir);
                await mkdir(fullname, !!options.p);
            }
        },
        // ---------------------------------------------------------------------
        pwd(this: BashContext) {
            this.stdout.writeln(this.cwd);
        },
        // ---------------------------------------------------------------------
        async ls(this: BashContext, ...args: string[]) {
            const options = $.terminal.parse_options(args, { boolean: ['a', 'A'] } as any);
            function filter(list: string[]) {
                if (options.a) {
                    return list;
                } else if (options.A) {
                    return list.filter(name => !name.match(/^\.{1,2}$/));
                } else {
                    return list.filter(name => !name.match(/^\./));
                }
            }
            const dir_path = path.resolve(this.cwd, options._[0] ?? '.');
            const content = await list_dir(dir_path);
            const dirs = filter(['.', '..'].concat(content.dirs)).map((dir: string) => {
                return color('blue', dir);
            });
            const result = dirs.concat(filter(content.files));
            if (result.length) {
                this.stdout.write(result.join('\n') + '\n');
            }
        },
        // ---------------------------------------------------------------------
        jargon: make_jargon(service),
        // ---------------------------------------------------------------------
        record(this: JQueryTerminal, ...args: string[]) {
            // toggle storing commands in URL hash
            if (args[0] === 'start') {
                term.history_state(true);
            } else if (args[0] === 'stop') {
                term.history_state(false);
            } else {
                this.echo('save commands in url hash so you can rerun them\n\n' +
                    'usage: record [stop|start]');
            }
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
                '',
                'Tools, libraries, and services used:',
                '* [[!b;#fff;;;https://terminal.jcubic.pl/]jQuery Terminal]',
                '* [[!b;#fff;;;https://github.com/patorjk/figlet.js]Figlet.js] + Modular ' +
                    'and Rectangles fonts',
                '* [[!b;#fff;;;http://catb.org/jargon/html/index.html]Jargon File] 4.4.7',
                '* [[!b;#fff;;;https://www.rfc-editor.org/]RFC Editor]',
                ''
            ].join('\n');
            this.stdout.writeln(text);
        },
        // ---------------------------------------------------------------------
        help(this: BashContext) {
            function command_list() {
                const list = Object.keys(commands);
                list.push('clear');
                return list.map(cmd => `<command>${cmd}</command>`);
            }
            const list = formatter.format(command_list());
            this.stdout.writeln(`Available commands: ${list}.`);
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

    type ListDir = {
        files: string[],
        dirs: string[]
    };

    // -------------------------------------------------------------------------
    async function list_dir(dir: string): Promise<ListDir> {
        const dir_list = await fs.readdir(dir);
        const files: string[] = [];
        const dirs: string[] = [];
        for (const name of dir_list) {
            const file = path.join(dir, name);
            try {
                const stat = await fs.stat(file);
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

    // -------------------------------------------------------------------------
    async function stat_or_null(path: string) {
        try {
            return await fs.stat(path);
        } catch (e) {
            return null;
        }
    }

    // -------------------------------------------------------------------------
    async function mkdir(dir: string, parent = false) {
        if (parent) {
            const parts = dir.split('/').filter(part => part !== '');
            if (!parts.length) {
                throw new Error('Invalid argument');
            }
            let full_path = '/';
            for (const part of parts) {
                full_path = path.join(full_path, part);
                const stat = await stat_or_null(full_path);
                if (!stat) {
                    await fs.mkdir(full_path);
                } else if (stat.isFile()) {
                    throw new Error(`${full_path} is a file`);
                }
            }
        } else {
            const stat = await stat_or_null(dir);
            if (!stat) {
                await fs.mkdir(dir);
            } else if (stat.isDirectory()) {
                throw new Error('Directory already exists');
            } else if (stat.isFile()) {
                throw new Error(`${dir} is a File`);
            }
        }
    }

    // -------------------------------------------------------------------------
    async function rmdir(dir: string) {
        const list = await fs.readdir(dir);
        for(const name of list) {
            const filename = path.join(dir, name);
            const stat = await fs.stat(filename);
            if (!filename.match(/^\.{1,2}$/)) {
                if(stat.isDirectory()) {
                    await rmdir(filename);
                } else {
                    fs.unlink(filename);
                }
            }
        }
        await fs.rmdir(dir);
    }

    // -------------------------------------------------------------------------
    function get_path(string: string) {
        let path = bash.cwd().replace(/^\//, '').split('/');
        if (path[0] === '') {
            path = path.slice(1);
        }
        var parts = string === '/'
            ? string.split('/')
            : string.replace(/\/?[^\/]*$/, '').split('/');
        if (parts[0] === '') {
            parts = parts.slice(1);
        }
        if (string === '/') {
            return [];
        } else if (string.startsWith('/')) {
            return parts;
        } else if (path.length) {
            return path.concat(parts);
        } else {
            return parts;
        }
    }

    const command_list = Object.keys(commands);

    // -------------------------------------------------------------------------
    completion = async function(this: JQueryTerminal, string: string) {
        const cwd = bash.cwd();
        var cmd = $.terminal.parse_command(this.before_cursor());
        async function processAssets(callback: (arg: ListDir) => string[]) {
            var dir = get_path(string);
            return callback(await list_dir('/' + dir.join('/')));
        }
        function prepend(list: string[]) {
            if (string.match(/\//) || (!string && cwd === '/')) {
                var path = string.replace(/\/[^\/]+$/, '').replace(/\/+$/, '');
                return list.map((dir: string) => path + '/' + dir);
            } else {
                return list;
            }
        }
        function trailing(list: string[]) {
            return list.map((dir: string) => dir + '/');
        }
        if (cmd.name !== string) {
            switch (cmd.name) {
                case 'cat':
                case 'rm':
                case 'less':
                    return await processAssets((content: ListDir) => {
                        return prepend(trailing(content.dirs).concat(content.files));
                    });
                case 'ls':
                case 'cd':
                    return await processAssets((content: ListDir) => {
                        return prepend(trailing(content.dirs));
                    });
            }
        }
        return command_list;
    };

    term.option('completion', completion);

    const stdout = new BufferTerminalOutput(term);
    const stderr = new BufferError(term);
    const stdin = new Input(term);

    const bash = new Bash(commands, {
        stdout,
        stderr,
        stdin,
        fs,
        cwd: default_dir
    });

    term.set_prompt(() => {
        const cwd = bash.cwd();
        const path = cwd === '/' ? '~' : cwd.replace(default_dir, '~/');
        return `<DodgerBlue>${path}</DodgerBlue>:&gt; `;
    });

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
