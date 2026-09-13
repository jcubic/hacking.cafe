import rpc from '@jcubic/json-rpc';
import LightningFS from '@isomorphic-git/lightning-fs';
import path from 'path-browserify';

import { $, JQueryTerminal } from './terminal';
import { make_jargon } from './jargon';
import { RPCBackend } from './fs';

import {
    Bash,
    color,
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

    const commands = {
        async hello(name: string) {
            await service.hello(name);
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

    // -------------------------------------------------------------------------

    const command_list = Object.keys(commands);

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
        home:  '/'
    });

    term.set_prompt(() => {
        const cwd = bash.cwd;
        const path = cwd === '/' ? '~' : cwd.replace(default_dir, '~/');
        return color('blue', path) + ':&gt; ';
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
