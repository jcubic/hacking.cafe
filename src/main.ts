import rpc from '@jcubic/json-rpc';
import LightningFS from '@isomorphic-git/lightning-fs';
import path from 'path-browserify';

import { $, JQueryTerminal } from './terminal';
import { make_jargon } from './jargon';
import { RPCBackend } from './fs';
import { color } from './colors';

const delay = 80;

const rpc_url = import.meta.env.DEV ? 'http://localhost:8810/' : '/api/';

let cwd = '/';
let completion;

const intepreter = rpc({ url: rpc_url }).then(service => {
    const _fs = new LightningFS('rpc', { db: new RPCBackend(service) as any });
    const fs = _fs.promises;

    const commands = {
        async hello(name: string) {
            return service.hello(name);
        },
        async cat(this: JQueryTerminal, ...args: string[]) {
            let content;
            if (args.length === 0) {
                content = this.read('');
            } else {
                const files = [];
                for (const name of args) {
                    const filename = path.resolve(cwd, name);
                    files.push(await fs.readFile(filename, 'utf8'));
                }
                content = files.join('');
            }
            term.echo(content);
        },
        mkdir: async function(this: JQueryTerminal, args: string) {
            const options = $.terminal.parse_options(args, { boolean: ['a', 'A'] } as any);
            for (const dir of options._) {
                const fullname = path.resolve(cwd, dir);
                await mkdir(fullname, !!options.p);
            }
        },
        pwd() {
            return cwd;
        },
        async ls(...args: string[]) {
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
            const dir_path = path.resolve(cwd, options._[0] ?? '.');
            const content = await list_dir(dir_path);
            const dirs = filter(['.', '..'].concat(content.dirs)).map((dir: string) => color('blue', dir));
            const result = dirs.concat(filter(content.files));
            if (result.length) {
                term.echo(result);
            }
        },
        jargon: make_jargon(service),
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
        async rfc(this: JQueryTerminal, ...args: string[]) {

            if (args[0] == '--help') {
                term.echo('Browser of RFC documents, using less unix command.\n\n' +
                    'If you execute without arguments you will get index page\n' +
                    'And on that page you can use / followed by text, to search\n' +
                    'links to RFC documents are clickable');
            } else {
                try {
                    let arg = null;
                    if (args.length) {
                        if (Number.isInteger(args[0])) {
                            arg = args[0];
                        } else {
                            this.error('invalid RFC number');
                        }
                    }
                    const rfc = await service.rfc(arg);
                    display_rfc(rfc as string);
                } catch (err) {
                    this.error((err as Error).message);
                }
            }
        },
        credits(this: JQueryTerminal) {
            const text = [
                '',
                'Tools, libraries, and services used:',
                '* [[!b;#fff;;;https://terminal.jcubic.pl/]jQuery Terminal]',
                '* [[!b;#fff;;;https://github.com/patorjk/figlet.js]Figlet.js] + Modular and Rectangles fonts',
                '* [[!b;#fff;;;http://catb.org/jargon/html/index.html]Jargon File] 4.4.7',
                '* [[!b;#fff;;;https://www.rfc-editor.org/]RFC Editor]',
                ''
            ].join('\n');
            this.echo(text, { keepWords: true });
        },
        help(this: JQueryTerminal) {
            function command_list() {
                const list = Object.keys(commands);
                list.push('clear');
                return list.map(cmd => `<command>${cmd}</command>`);
            }
            const list = formatter.format(command_list());
            this.echo(`Available commands: ${list}.`, { keepWords: true });
            this.echo('An <command>rfc</command> command use simplifed unix less command.\n', {
                keepWords: true
            });
        }
    };
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
            commands.rfc.call(term, parseInt(command, 10) as any);
        } else {
            term.exec(`rfc ${command}`, { typing: true, delay });
        }
        return false;
    });

    type ListDir = {
        files: string[],
        dirs: string[]
    };

    async function list_dir(dir: string): Promise<ListDir> {
        const dirList = await fs.readdir(dir);
        const files: string[] = [];
        const dirs: string[] = [];
        for (const name of dirList) {
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

    async function stat_or_null(path: string) {
        try {
            return await fs.stat(path);
        } catch (e) {
            return null;
        }
    }

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

    const command_list = Object.keys(commands);

    completion = async function(this: JQueryTerminal, string: string) {
        try {
            var cmd = $.terminal.parse_command(this.before_cursor());
            async function processAssets(callback: (arg: ListDir) => string[]) {
                var dir = path.resolve(cwd, string || '.');
                return callback(await list_dir(dir));
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
                    case 'less':
                        return await processAssets((content: ListDir) => {
                            return prepend(trailing(content.dirs).concat(content.files));
                        });
                    case 'ls':
                    case 'cd':
                        return await processAssets((content: ListDir) => prepend(trailing(content.dirs)));
                }
            }
            return command_list;
        } catch (e: any) {
            console.error(e);
        }
    };

    term.option('completion', completion);

    // @ts-expect-error
    return $.terminal.pipe(commands, {
        processArguments: false,
        redirects: [
            {
                name: '>',
                callback: function(file: string) {
                    const fullname = path.resolve(cwd, file);
                    console.log({ fullname });
                    return term.read('').then(text => {
                        console.log({ fullname, text });
                        if (typeof text !== 'undefined') {
                            return fs.writeFile(fullname, text);
                        }
                    });
                }
            }
        ]
    });
});

const formatter = new Intl.ListFormat('en', {
    style: 'long',
    type: 'conjunction',
});

const term = $('body').terminal(intepreter as any, {
    checkArity: false,
    // @ts-expect-error
    execHash: true,
    exit: false,
    execAnimation: true,
    processArguments: false,
    execHistory: true,
    greetings: null,
    prompt: '<DodgerBlue>~</DodgerBlue>:&gt; ',
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
