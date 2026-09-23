/*
 *  The shell half of the worker IPC: what a JavaScript program running as a
 *  process can reach through require(), and how the shell tracks it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Bash } from '../src/bash';
import type { Modules } from '../src/bash/types';
import { create_bash } from './helpers/bash';
import { install_worker, last_worker } from './helpers/worker';

let uninstall: () => void;

beforeEach(() => {
    uninstall = install_worker();
});

afterEach(() => {
    uninstall();
});

// start a program and hand back the worker it runs in; exec_js only settles
// when the program exits, so the promise is kept for the test to finish off
async function start(bash: Bash, code: string, args: string[] = []) {
    const exit = bash.exec_js('/bin/program', code, args);
    const worker = await last_worker();
    return { worker, exit };
}

// the prelude drops the program into a block and calls main(), the way the
// scripts in api/fs/bin are written
const program = 'async function main() { return 0; }';

describe('exec_js', () => {
    it('resolves with the code the program exits with', async () => {
        const { bash, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program);
        worker.exit(7);
        expect(await exit).toBe(7);
        cleanup();
    });

    it('wraps the program in the worker prelude', async () => {
        const { bash, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program, ['one', 'two']);
        expect(worker.code).toContain(program);
        expect(worker.code).toContain('["one","two"]');
        expect(worker.code).toContain('importScripts');
        worker.exit();
        await exit;
        cleanup();
    });

    it('points the prelude at the mitty build on the web root', async () => {
        const { bash, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program);
        expect(worker.code).toContain(`importScripts('http://localhost/mitty.js')`);
        worker.exit();
        await exit;
        cleanup();
    });

    it('keeps dollar sequences in the program intact', async () => {
        // a string replacement would read $&, $' and $` in the program as
        // replacement patterns and mangle it
        const { bash, cleanup } = await create_bash();
        const source = [
            'async function main() {',
            `  const $ = require('$');`,
            `  const text = "$& $' $\` $$";`,
            '  return 0;',
            '}'
        ].join('\n');
        const { worker, exit } = await start(bash, source);
        expect(worker.code).toContain(source);
        worker.exit();
        await exit;
        cleanup();
    });

    it('strips a shebang before running the program', async () => {
        const { bash, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, `#!/bin/js\n${program}`);
        expect(worker.code).not.toContain('#!/bin/js');
        expect(worker.code).toContain(program);
        worker.exit();
        await exit;
        cleanup();
    });

});

describe('the process table', () => {
    it('holds the program while it runs', async () => {
        const { bash, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program);
        expect(bash.procs).toContainEqual({
            name: 'program',
            path: '/bin/program',
            pid: worker.pid
        });
        worker.exit();
        await exit;
        expect(bash.procs.map(proc => proc.pid)).not.toContain(worker.pid);
        cleanup();
    });

    it('terminates the worker on kill', async () => {
        const { bash, cleanup } = await create_bash();
        const { worker } = await start(bash, program);
        await bash.kill(worker.pid);
        expect(worker.terminated).toBe(true);
        expect(bash.procs.map(proc => proc.pid)).not.toContain(worker.pid);
        cleanup();
    });

    it('gives concurrent programs channels of their own', async () => {
        const { bash, cleanup } = await create_bash();
        const first = await start(bash, program);
        const second = await start(bash, program);
        expect(second.worker.pid).not.toBe(first.worker.pid);
        // each one still talks to the shell without crosstalk
        expect(await first.worker.require('bash').pid).toBe(bash.pid);
        expect(await second.worker.require('bash').pid).toBe(bash.pid);
        first.worker.exit();
        second.worker.exit();
        await Promise.all([first.exit, second.exit]);
        cleanup();
    });
});

describe('require', () => {
    it('reaches the shell', async () => {
        const { bash, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program);
        expect(await worker.require('bash').cwd).toBe('/home/guest');
        expect(await worker.require('bash').user).toBe('guest');
        expect(await worker.require('bash').version).toBe(bash.version);
        worker.exit();
        await exit;
        cleanup();
    });

    it('calls a method on the shell', async () => {
        const { bash, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program);
        expect(await worker.require('bash').resolve_path('~/file')).toBe('/home/guest/file');
        worker.exit();
        await exit;
        cleanup();
    });

    it('reaches the filesystem', async () => {
        const { bash, cleanup } = await create_bash({
            fixture: { '/home/guest/notes.txt': 'hello\n' }
        });
        const { worker, exit } = await start(bash, program);
        const fs = worker.require('fs');
        expect(await fs.readFile('/home/guest/notes.txt', 'utf8')).toBe('hello\n');
        await fs.writeFile('/home/guest/written.txt', 'from the worker');
        worker.exit();
        await exit;
        cleanup();
    });

    it('writes to the terminal through stdout', async () => {
        const { bash, stdout, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program);
        await worker.require('stdout').writeln('from the worker');
        await worker.require('stdout').flush();
        expect(stdout.text).toBe('from the worker\n');
        worker.exit();
        await exit;
        cleanup();
    });

    it('writes to stderr', async () => {
        const { bash, stderr, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program);
        await worker.require('stderr').writeln('it broke');
        await worker.require('stderr').flush();
        expect(stderr.text).toBe('it broke\n');
        worker.exit();
        await exit;
        cleanup();
    });

    it('reads stdin', async () => {
        const { bash, cleanup } = await create_bash({ input: 'one\ntwo\n' });
        const { worker, exit } = await start(bash, program);
        expect(await worker.require('stdin').read_line()).toBe('one\n');
        worker.exit();
        await exit;
        cleanup();
    });

    it('reaches the path module', async () => {
        const { bash, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program);
        expect(await worker.require('path').join('/bin', 'ls')).toBe('/bin/ls');
        worker.exit();
        await exit;
        cleanup();
    });

    it('reaches a module the host application added', async () => {
        const modules: Modules = {
            greeter: () => ({ hello: (name: string) => `hello ${name}` })
        };
        const { bash, cleanup } = await create_bash({ modules });
        const { worker, exit } = await start(bash, program);
        expect(await worker.require('greeter').hello('bob')).toBe('hello bob');
        worker.exit();
        await exit;
        cleanup();
    });

    it('rejects a module that cannot be resolved', async () => {
        const { bash, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program);
        await expect(worker.require('no-such-module').anything()).rejects.toThrow();
        worker.exit();
        await exit;
        cleanup();
    });

    it('runs a bash command from the program', async () => {
        const { bash, stdout, cleanup } = await create_bash();
        const { worker, exit } = await start(bash, program);
        expect(await worker.require('bash').exec('echo', 'from bash')).toBe(0);
        expect(stdout.text).toBe('from bash\n');
        worker.exit();
        await exit;
        cleanup();
    });
});

describe('serialize', () => {
    // a value that cannot cross the channel is handed over as a handle the
    // worker calls methods on - this is how the terminal exposes itself
    class Widget {
        private _label = 'start';
        set(label: string) {
            this._label = label;
            return this;
        }
        get label() {
            return this._label;
        }
    }

    class WidgetBash extends Bash {
        protected serialize(value: unknown, remote: (value: unknown) => unknown) {
            if (value instanceof Widget) {
                return remote(value);
            }
            return value;
        }
    }

    it('hands a live object to the worker as a handle', async () => {
        const widget = new Widget();
        const { bash, cleanup } = await create_bash({
            ctor: WidgetBash,
            modules: { widget: () => ({ get: () => widget }) }
        });
        const { worker, exit } = await start(bash, program);
        const handle = await worker.require('widget').get();
        expect(await handle.label).toBe('start');
        await handle.set('changed');
        expect(widget.label).toBe('changed');
        worker.exit();
        await exit;
        cleanup();
    });

    it('sends a plain value through untouched', async () => {
        const { bash, cleanup } = await create_bash({
            ctor: WidgetBash,
            modules: { data: () => ({ get: () => ({ a: 1, b: [2, 3] }) }) }
        });
        const { worker, exit } = await start(bash, program);
        expect(await worker.require('data').get()).toEqual({ a: 1, b: [2, 3] });
        worker.exit();
        await exit;
        cleanup();
    });
});

// mitty keeps a value whose methods are the point of it on this side and
// hands the worker a handle, with no serialize() hook anywhere - this is that
// default working end to end over a real channel
describe('values that need their methods', () => {
    // the shape that started this: methods on the prototype, data of its own
    class Stat {
        type: string;
        size: number;
        constructor(type: string, size: number) {
            this.type = type;
            this.size = size;
        }
        isFile() {
            return this.type === 'file';
        }
    }

    async function stat_bash() {
        return create_bash({
            modules: {
                fs_like: () => ({
                    stat: (name: string) =>
                        new Stat(name.endsWith('/') ? 'dir' : 'file', 12),
                    readdir: () => ['one', 'two']
                })
            }
        });
    }

    it('keeps a prototype method callable from the worker', async () => {
        const { bash, cleanup } = await stat_bash();
        const { worker, exit } = await start(bash, program);
        const stat = await worker.require('fs_like').stat('/home/guest/notes.txt');
        expect(await stat.isFile()).toBe(true);
        expect(await stat.size).toBe(12);
        worker.exit();
        await exit;
        cleanup();
    });

    it('answers for a directory too', async () => {
        const { bash, cleanup } = await stat_bash();
        const { worker, exit } = await start(bash, program);
        const stat = await worker.require('fs_like').stat('/home/guest/');
        expect(await stat.isFile()).toBe(false);
        worker.exit();
        await exit;
        cleanup();
    });

    it('still copies an array of data across', async () => {
        const { bash, cleanup } = await stat_bash();
        const { worker, exit } = await start(bash, program);
        expect(await worker.require('fs_like').readdir()).toEqual(['one', 'two']);
        worker.exit();
        await exit;
        cleanup();
    });

    // an Error inherits toString() from Error.prototype, so has_methods() says
    // yes to one - mitty encodes errors before serialize() ever sees them, and
    // a program has to catch a real Error rather than a handle to one
    it('does not turn an error into a handle', async () => {
        const { bash, cleanup } = await create_bash({
            modules: {
                fails: () => ({
                    open: () => {
                        throw new Error('ENOENT: no such file or directory');
                    }
                })
            }
        });
        const { worker, exit } = await start(bash, program);
        let caught: unknown;
        try {
            await worker.require('fails').open();
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toBe('ENOENT: no such file or directory');
        // what a program printing the error actually gets
        expect(String(caught)).toBe('Error: ENOENT: no such file or directory');
        worker.exit();
        await exit;
        cleanup();
    });
});

describe('a program that does not parse', () => {
    it('is refused before a worker is started', async () => {
        const { bash, cleanup } = await create_bash();
        expect(() => bash.exec_js('/bin/broken', 'function (', [])).toThrow(SyntaxError);
        cleanup();
    });

    // the channel has to be opened after the syntax check, not before: pids
    // are reused, so a channel left behind here would answer on a name the
    // next program is handed, alongside the host that program really has
    it('leaves no channel behind', async () => {
        const { bash, cleanup } = await create_bash();
        expect(() => bash.exec_js('/bin/broken', 'function (', [])).toThrow(SyntaxError);
        const { worker, exit } = await start(bash, program);
        const spy = new BroadcastChannel(`__ipc__:${worker.pid}`);
        const messages: unknown[] = [];
        spy.onmessage = (event: MessageEvent) => messages.push(event.data);
        expect(await worker.require('bash').cwd).toBe('/home/guest');
        await new Promise(resolve => setTimeout(resolve, 10));
        spy.close();
        // one request, one answer
        expect(messages).toHaveLength(2);
        worker.exit();
        await exit;
        cleanup();
    });
});
