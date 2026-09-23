/*
 *  Bugs found while writing these tests, each written the way the shell is
 *  supposed to behave and marked `it.fails` so the suite stays green until
 *  somebody fixes them. When a fix lands, vitest reports the test as failing
 *  *because it passed* - drop the `.fails` at that point.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { create_bash } from './helpers/bash';
import { install_worker, last_worker } from './helpers/worker';

describe('known bugs', () => {
    // `echo` parses its arguments with lily, which treats anything starting
    // with a dash as an option no matter where it appears
    it.fails('echo prints an argument that starts with a dash', async () => {
        const { output, cleanup } = await create_bash();
        try {
            expect(await output('echo "- item"')).toBe('- item\n');
        } finally {
            cleanup();
        }
    });

    // Bash::Command swaps stdout/stderr for a SilientOutput before running a
    // command with an output redirect, and only swaps them back after the
    // command returns - a command that throws skips the restore, and every
    // later command in the session writes into the discarded buffer
    it.fails('a failing redirect does not silence the shell', async () => {
        const { run, output, cleanup } = await create_bash();
        try {
            await run('cat /does/not/exist > out.txt');
            expect(await output('echo visible')).toBe('visible\n');
        } finally {
            cleanup();
        }
    });

    // `exit` raises a Signal, and Bash::Command turns any Signal into the
    // 128+n exit code a *killed* process reports; a script that exits 3 should
    // report 3
    it.fails('a script reports the code it exits with', async () => {
        const { run, cleanup } = await create_bash({
            fixture: { '/bin/three': { content: 'exit 3\n', mode: 0o755 } }
        });
        try {
            await run('export PATH=/bin');
            expect(await run('three')).toBe(3);
        } finally {
            cleanup();
        }
    });

    // grep splits its input on \n, so the empty field after the final newline
    // is treated as a line - it matches -v and gets printed
    it.fails('grep -v does not invent a trailing empty line', async () => {
        const { output, cleanup } = await create_bash();
        try {
            expect(await output('printf "a\\nb\\n" | grep -v a')).toBe('b\n');
        } finally {
            cleanup();
        }
    });

    // unbash parses `( ... )` into a Subshell node and the interpreter has no
    // handler for it, so the README's "subshells" checkbox only covers $( ... )
    it.fails('runs a subshell in parentheses', async () => {
        const { run, cleanup } = await create_bash();
        try {
            await run('(NAME=inner)');
        } finally {
            cleanup();
        }
    });
});

describe('known bugs: commands', () => {
    // `test` parses its arguments with lily before looking at them, and in a
    // run of short flags the last one takes the value: `-le 2` comes out as
    // `l: true, e: "2"`, which `test` then reads as the `-e FILE` existence
    // test against a file named "2". Every operator that ends in an `e` is
    // affected - -ne, -le and -ge - while -eq, -lt and -gt come through intact
    it.fails('test compares with -ne', async () => {
        const { run, cleanup } = await create_bash();
        try {
            expect(await run('test 1 -ne 2')).toBe(0);
            expect(await run('test 2 -ne 2')).toBe(1);
        } finally {
            cleanup();
        }
    });

    it.fails('test compares with -le', async () => {
        const { run, cleanup } = await create_bash();
        try {
            expect(await run('test 2 -le 2')).toBe(0);
            expect(await run('test 3 -le 2')).toBe(1);
        } finally {
            cleanup();
        }
    });

    it.fails('test compares with -ge', async () => {
        const { run, cleanup } = await create_bash();
        try {
            expect(await run('test 2 -ge 2')).toBe(0);
            expect(await run('test 1 -ge 2')).toBe(1);
        } finally {
            cleanup();
        }
    });

    // find_executable() tests `!this.is_executable(filename)` without awaiting
    // it: the promise is always truthy, so the check never fires and a file
    // without an execute bit runs like any other script
    it.fails('a file without an execute bit is refused', async () => {
        const { run, stderr, cleanup } = await create_bash({
            fixture: { '/bin/plain': { content: 'echo ran anyway\n', mode: 0o644 } }
        });
        try {
            await run('export PATH=/bin');
            expect(await run('plain')).toBe(1);
            expect(stderr.text).toMatch(/Permission denied/);
        } finally {
            cleanup();
        }
    });

    // exec_script() has the same missing await for the interpreter named by a
    // shebang, so an interpreter that is not executable is used anyway instead
    // of being reported as a bad interpreter. When the interpreter does not
    // exist at all the unawaited stat rejects on its own, which surfaces as an
    // unhandled rejection rather than an error the shell prints
    it.fails('a shebang naming an interpreter that is not executable says so', async () => {
        const { run, stderr, cleanup } = await create_bash({
            fixture: {
                '/bin/notexec': { content: 'async function main() { return 0; }', mode: 0o644 },
                '/bin/weird': { content: '#!/bin/notexec\ncode\n', mode: 0o755 }
            }
        });
        try {
            await run('export PATH=/bin');
            await run('weird');
            expect(stderr.text).toMatch(/bad interpreter/);
        } finally {
            cleanup();
        }
    });

    // rm never awaits rmdir()/unlink(), so it returns while the tree is still
    // being deleted - the directory is still there when the next command runs,
    // and a failure surfaces as an unhandled rejection instead of an error
    it.fails('rm -r has removed the directory when it returns', async () => {
        const { fs, run, cleanup } = await create_bash({
            fixture: { '/home/guest/dir/sub/f': 'x' }
        });
        try {
            await run('rm -r dir');
            await expect(fs.stat('/home/guest/dir')).rejects.toThrow(/ENOENT/);
        } finally {
            cleanup();
        }
    });

    // source does not await bash.evaluate(), so the sourced script runs
    // alongside the `source` command that started it. Both of them assign
    // through the one `_tmp_env` the shell owns, and the outer command clears
    // it when it finishes - which lands in the middle of the sourced
    // assignment and drops it. `. ~/.bashrc` at the prompt silently sets
    // nothing; only .bashrc at startup works, because init() awaits evaluate
    it.fails('an assignment in a sourced file reaches the shell', async () => {
        const { bash, run, cleanup } = await create_bash({
            fixture: { '/home/guest/vars.sh': 'NAME=bob\n' }
        });
        try {
            await run('source vars.sh');
            await new Promise(resolve => setTimeout(resolve, 5));
            expect(bash.get_variable('NAME')).toBe('bob');
        } finally {
            cleanup();
        }
    });
});

/*
 *  Bash::use_default() looks up `ast.parameter.substring(1)`, but unbash puts
 *  the bare name in `parameter` - so it reads a variable one character short of
 *  the one that was asked for and every one of these operators decides on the
 *  wrong value. ${VAR:+alt} and ${VAR:?msg} are unaffected: they use
 *  `ast.parameter` as it comes.
 */
describe('known bugs: default value expansions', () => {
    async function expand(code: string, setup = '') {
        const shell = await create_bash();
        try {
            const script = [setup, `echo "[${code}]"`].filter(Boolean).join('\n');
            return (await shell.output(script)).replace(/^\[|\]\n$/g, '');
        } finally {
            shell.cleanup();
        }
    }

    it.fails('${VAR:-default} keeps the value of a set variable', async () => {
        expect(await expand('${NAME:-anon}', 'NAME=bob')).toBe('bob');
    });

    it('${VAR:-default} falls back for an unset variable', async () => {
        expect(await expand('${NAME:-anon}')).toBe('anon');
    });

    it.fails('${VAR-default} keeps the value of a set variable', async () => {
        expect(await expand('${NAME-anon}', 'NAME=bob')).toBe('bob');
    });

    it.fails('${VAR-default} falls back for an unset variable', async () => {
        expect(await expand('${NAME-anon}')).toBe('anon');
    });

    it.fails('${VAR:=default} keeps the value of a set variable', async () => {
        expect(await expand('${DATABASE_URL:="remote"}', 'DATABASE_URL=local')).toBe('local');
    });

    it('${VAR:=default} assigns to an unset variable', async () => {
        const { output, cleanup } = await create_bash();
        try {
            expect(await output('X=${DATABASE_URL:="localhost"}\necho $DATABASE_URL'))
                .toBe('localhost\n');
        } finally {
            cleanup();
        }
    });

    it.fails('${VAR+alternative} yields nothing for an unset variable', async () => {
        expect(await expand('${NAME+yes}')).toBe('');
    });

    it('${VAR+alternative} yields the alternative for a set variable', async () => {
        expect(await expand('${NAME+yes}', 'NAME=bob')).toBe('yes');
    });

    it.fails('${VAR?message} raises for an unset variable', async () => {
        const { run, cleanup } = await create_bash();
        try {
            await expect(run('echo ${NAME?missing}')).rejects.toThrow('missing');
        } finally {
            cleanup();
        }
    });

    // `${NAME^}` indexes into the variable before checking that it has a first
    // character, so an unset name crashes with a TypeError instead of expanding
    // to the empty string
    it.fails('${VAR^} expands an unset variable to nothing', async () => {
        expect(await expand('${NAME^}')).toBe('');
    });
});

/*
 *  exec_js() opens the worker's BroadcastChannel and builds its mitty Host
 *  before it syntax-checks the program. When the check throws, the process is
 *  never registered, so nothing ever closes either of them. pids are recycled,
 *  so the abandoned host ends up sharing a channel with the next program and
 *  answers its requests alongside the real host - the worker gets two replies
 *  to every call, and handles minted by one host are unknown to the other.
 */
describe('known bugs: a refused program leaks its channel', () => {
    let uninstall: () => void;

    beforeEach(() => {
        uninstall = install_worker();
    });

    afterEach(() => {
        uninstall();
    });

    it.fails('closes the channel of a program that does not parse', async () => {
        const { bash, cleanup } = await create_bash();
        try {
            expect(() => bash.exec_js('/bin/broken', 'function (', [])).toThrow(SyntaxError);
            // the next program is handed the pid - and the channel - that the
            // refused one opened
            const exit = bash.exec_js('/bin/program', 'async function main() {}', []);
            const worker = await last_worker();
            const spy = new BroadcastChannel(`__ipc__:${worker.pid}`);
            const messages: unknown[] = [];
            spy.onmessage = (event: MessageEvent) => messages.push(event.data);
            await worker.require('bash').cwd;
            await new Promise(resolve => setTimeout(resolve, 10));
            spy.close();
            // one request, one answer
            expect(messages).toHaveLength(2);
            worker.exit();
            await exit;
        } finally {
            cleanup();
        }
    });
});
