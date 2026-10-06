import { describe, expect, it } from 'vitest';

import { version } from '../package.json';
import { create_bash } from './helpers/bash';

describe('resolve_path', () => {
    it('leaves an absolute path alone', async () => {
        const { bash, cleanup } = await create_bash();
        expect(bash.resolve_path('/etc/passwd')).toBe('/etc/passwd');
        cleanup();
    });

    it('resolves a relative path against the working directory', async () => {
        const { bash, cleanup } = await create_bash();
        expect(bash.resolve_path('file')).toBe('/home/guest/file');
        bash.cwd = '/tmp';
        expect(bash.resolve_path('file')).toBe('/tmp/file');
        cleanup();
    });

    it('expands a leading tilde to the home directory', async () => {
        const { bash, cleanup } = await create_bash();
        expect(bash.resolve_path('~/src')).toBe('/home/guest/src');
        expect(bash.resolve_path('~')).toBe('/home/guest');
        cleanup();
    });

    it('normalises . and ..', async () => {
        const { bash, cleanup } = await create_bash();
        expect(bash.resolve_path('./a/../b')).toBe('/home/guest/b');
        expect(bash.resolve_path('..')).toBe('/home');
        cleanup();
    });
});

describe('prompt', () => {
    // PS1 is set directly: going through the parser would add a layer of
    // quoting on top of the escapes under test
    async function prompt(ps1: string) {
        const shell = await create_bash({ user: 'ada', host: 'example.com' });
        try {
            shell.bash.set_variable('PS1', ps1);
            return shell.bash.prompt();
        } finally {
            shell.cleanup();
        }
    }

    it('uses the default PS1', async () => {
        const { bash, cleanup } = await create_bash();
        expect(await bash.prompt()).toBe(`bash-${version}$ `);
        cleanup();
    });

    it('expands the user, host and shell', async () => {
        expect(await prompt('\\u@\\h')).toBe('ada@example.com');
        expect(await prompt('\\s')).toBe('bash');
        expect(await prompt('\\v')).toBe(version);
    });

    it('expands the working directory', async () => {
        const shell = await create_bash({ fixture: { '/home/guest/src/': '' } });
        await shell.run('PS1="\\w"');
        expect(await shell.bash.prompt()).toBe('~');
        await shell.run('cd src');
        expect(await shell.bash.prompt()).toBe('~/src');
        await shell.run('PS1="\\W"');
        expect(await shell.bash.prompt()).toBe('src');
        await shell.run('cd ~');
        expect(await shell.bash.prompt()).toBe('~');
        shell.cleanup();
    });

    it('drops the non-printing markers', async () => {
        expect(await prompt('\\[\\e[01;32m\\]x\\[\\e[00m\\]')).toBe('\x1b[01;32mx\x1b[00m');
    });

    it('expands an octal escape', async () => {
        expect(await prompt('\\033')).toBe('\x1b');
    });

    it('expands a literal backslash and the prompt sign', async () => {
        expect(await prompt('\\\\\\$')).toBe('\\$');
    });

    it('expands the date', async () => {
        expect(await prompt('\\d')).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
    });

    it('leaves an unknown escape as the letter', async () => {
        expect(await prompt('\\j')).toBe('j');
    });
});

describe('prompt expressions', () => {
    // the backticks are escaped in the assignment on purpose: unescaped, double
    // quotes would substitute them once, when PS1 is set. Escaped, the
    // expression is what PS1 holds and the prompt is what runs it
    it('runs a backtick expression', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('PS1="[\\`echo hello\\`]"');
        expect(await bash.prompt()).toBe('[hello]');
        cleanup();
    });

    it('keeps the expression in PS1 instead of its output', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('PS1="[\\`echo hello\\`]"');
        expect(bash.get_variable('PS1')).toBe('[`echo hello`]');
        cleanup();
    });

    it('runs the expression on every call, not once', async () => {
        const { bash, fs, run, cleanup } = await create_bash();
        await run('PS1="[\\`cat n.txt\\`]"');
        await fs.writeFile('/home/guest/n.txt', 'one');
        expect(await bash.prompt()).toBe('[one]');
        await fs.writeFile('/home/guest/n.txt', 'two');
        expect(await bash.prompt()).toBe('[two]');
        cleanup();
    });

    it('runs every expression of the prompt', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('PS1="[\\`echo one\\`][\\`echo two\\`]"');
        expect(await bash.prompt()).toBe('[one][two]');
        cleanup();
    });

    it('combines an expression with the escapes around it', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('PS1="(\\u@\\h)-[\\[\\w\\]]\\`echo hello\\`"');
        expect(await bash.prompt()).toBe('(guest@hacking.cafe)-[~]hello');
        cleanup();
    });

    it('strips the trailing newline of the output but keeps the inner ones', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('PS1="[\\`echo a; echo b\\`]"');
        expect(await bash.prompt()).toBe('[a\nb]');
        cleanup();
    });

    it('expands an expression that prints nothing to nothing', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('PS1="[\\`true\\`]"');
        expect(await bash.prompt()).toBe('[]');
        cleanup();
    });

    it('leaves a prompt without an expression alone', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('PS1="plain$ "');
        expect(await bash.prompt()).toBe('plain$ ');
        cleanup();
    });

    // the expression runs in a forked shell, so drawing the prompt cannot
    // change the shell the user is typing into
    it('does not let the expression touch the shell', async () => {
        const { bash, run, cleanup } = await create_bash({ fixture: { '/tmp/': '' } });
        await run('NAME=mine');
        await run('PS1="[\\`NAME=theirs; cd /tmp; echo x\\`]"');
        expect(await bash.prompt()).toBe('[x]');
        expect(bash.get_variable('NAME')).toBe('mine');
        expect(bash.cwd).toBe('/home/guest');
        cleanup();
    });

    it('leaves no process behind', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('PS1="[\\`echo hello\\`]"');
        const before = bash.procs.length;
        await bash.prompt();
        await bash.prompt();
        expect(bash.procs).toHaveLength(before);
        cleanup();
    });

    // jQuery Terminal redraws the prompt from a dozen places, so calls overlap.
    // Nothing of the expansion may live in shell state, or one call would wipe
    // what another is about to read and the prompt would render without it
    it('is safe to call while another call is still running', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('PS1="[\\`echo hello\\`]"');
        const calls = await Promise.all(Array.from({ length: 5 }, () => bash.prompt()));
        expect(calls).toEqual(Array(5).fill('[hello]'));
        cleanup();
    });
});

describe('users', () => {
    it('parses /etc/passwd', async () => {
        const { bash, cleanup } = await create_bash();
        const users = await bash.users();
        expect(users.map(user => user.username)).toEqual(['root', 'guest']);
        expect(users[1]).toMatchObject({
            username: 'guest',
            password: 'x',
            uid: 502,
            gid: 502,
            fullname: 'Guest User',
            home: '/home/guest',
            shell: '/bin/bash'
        });
        cleanup();
    });

    it('is empty without a passwd file', async () => {
        const { fs, bash, cleanup } = await create_bash();
        await fs.unlink('/etc/passwd');
        expect(await bash.users()).toEqual([]);
        cleanup();
    });

    it('skips malformed lines', async () => {
        const { fs, bash, cleanup } = await create_bash();
        await fs.writeFile('/etc/passwd', 'root:x:0:0:root:/root:/bin/bash\ngarbage\n');
        expect(await bash.users()).toHaveLength(1);
        cleanup();
    });
});

describe('executables', () => {
    it('lists the executable files of a directory', async () => {
        const { bash, cleanup } = await create_bash({
            fixture: {
                '/bin/ls': { content: '', mode: 0o755 },
                '/bin/cat': { content: '', mode: 0o755 },
                '/bin/notes': { content: '', mode: 0o644 }
            }
        });
        expect((await bash.executables('/bin')).sort()).toEqual(['cat', 'ls']);
        cleanup();
    });
});

describe('commands', () => {
    it('lists the builtins', async () => {
        const { bash, cleanup } = await create_bash();
        expect(bash.commands).toContain('echo');
        expect(bash.commands).toContain('cd');
        cleanup();
    });

    it('knows which commands exist', async () => {
        const { bash, cleanup } = await create_bash();
        expect(bash.command_exists('echo')).toBe(true);
        expect(bash.command_exists('nope')).toBe(false);
        cleanup();
    });

    it('takes commands from the host application', async () => {
        const { output, cleanup } = await create_bash({
            commands: {
                greet(this: { stdout: { writeln(s: string): void } }, name: string) {
                    this.stdout.writeln(`hello ${name}`);
                    return 0;
                }
            }
        });
        expect(await output('greet bob')).toBe('hello bob\n');
        cleanup();
    });

    it('reports an unknown command', async () => {
        const { run, stderr, cleanup } = await create_bash();
        expect(await run('nope')).toBe(1);
        expect(stderr.text).toMatch(/bash: nope: Command not found/);
        cleanup();
    });
});

describe('scripts', () => {
    const fixture = {
        '/bin/hello': { content: 'echo hello from script\n', mode: 0o755 },
        '/bin/args': { content: 'echo "$1-$2"\n', mode: 0o755 }
    };

    it('runs a script found on PATH', async () => {
        const { run, output, cleanup } = await create_bash({ fixture });
        await run('export PATH=/bin');
        expect(await output('hello')).toBe('hello from script\n');
        cleanup();
    });

    it('does not look in the working directory unless PATH says so', async () => {
        const { run, stderr, cleanup } = await create_bash({
            fixture: { '/home/guest/local': { content: 'echo x\n', mode: 0o755 } }
        });
        await run('export PATH=/bin');
        expect(await run('local')).toBe(1);
        expect(stderr.text).toMatch(/Command not found/);
        cleanup();
    });

    it('runs a script named by a path', async () => {
        const { run, output, cleanup } = await create_bash({
            fixture: { '/home/guest/local': { content: 'echo local\n', mode: 0o755 } }
        });
        await run('export PATH=/bin');
        expect(await output('./local')).toBe('local\n');
        cleanup();
    });

    it('passes arguments to the script', async () => {
        const { run, output, cleanup } = await create_bash({ fixture });
        await run('export PATH=/bin');
        expect(await output('args one two')).toBe('one-two\n');
        cleanup();
    });

    it('runs the script in its own shell', async () => {
        const { bash, run, cleanup } = await create_bash({
            fixture: { '/bin/setter': { content: 'INNER=x\n', mode: 0o755 } }
        });
        await run('export PATH=/bin');
        await run('setter');
        expect(bash.get_variable('INNER')).toBe('');
        cleanup();
    });

    it('gives the script the exported environment', async () => {
        const { run, output, cleanup } = await create_bash({
            fixture: { '/bin/show': { content: 'echo "[$NAME]"\n', mode: 0o755 } }
        });
        await run('export PATH=/bin');
        await run('export NAME=bob');
        expect(await output('show')).toBe('[bob]\n');
        cleanup();
    });

    it('passes a prefix assignment to the script only', async () => {
        const { bash, run, output, cleanup } = await create_bash({
            fixture: { '/bin/show': { content: 'echo "[$NAME]"\n', mode: 0o755 } }
        });
        await run('export PATH=/bin');
        expect(await output('NAME=once show')).toBe('[once]\n');
        expect(bash.get_variable('NAME')).toBe('');
        cleanup();
    });

    it('refuses a file without an execute bit', async () => {
        const { run, stderr, cleanup } = await create_bash({
            fixture: { '/bin/plain': { content: 'echo ran anyway\n', mode: 0o644 } }
        });
        await run('export PATH=/bin');
        expect(await run('plain')).toBe(1);
        expect(stderr.text).toMatch(/bash: plain: Permission denied/);
        cleanup();
    });

    it('reports a shebang naming an interpreter that is not there', async () => {
        const { run, stderr, cleanup } = await create_bash({
            fixture: { '/bin/weird': { content: '#!/bin/nothing\ncode\n', mode: 0o755 } }
        });
        await run('export PATH=/bin');
        expect(await run('weird')).toBe(1);
        expect(stderr.text).toMatch(/\/bin\/nothing: bad interpreter/);
        cleanup();
    });

    it('reports a shebang naming an interpreter that cannot be run', async () => {
        const { run, stderr, cleanup } = await create_bash({
            fixture: {
                '/bin/notexec': { content: 'async function main() {}', mode: 0o644 },
                '/bin/weird': { content: '#!/bin/notexec\ncode\n', mode: 0o755 }
            }
        });
        await run('export PATH=/bin');
        expect(await run('weird')).toBe(1);
        expect(stderr.text).toMatch(/\/bin\/notexec: bad interpreter/);
        cleanup();
    });

    it('searches every entry of PATH', async () => {
        const { run, output, cleanup } = await create_bash({
            fixture: {
                '/bin/one': { content: 'echo one\n', mode: 0o755 },
                '/usr/bin/two': { content: 'echo two\n', mode: 0o755 }
            }
        });
        await run('export PATH=/bin:/usr/bin');
        expect(await output('two')).toBe('two\n');
        cleanup();
    });
});

describe('exec_bash', () => {
    it('runs code as a separate process', async () => {
        const { bash, stdout, cleanup } = await create_bash();
        const code = await bash.exec_bash('/tmp/script', 'echo "$1"\nNAME=inner\n', ['arg']);
        expect(code).toBe(0);
        expect(stdout.text).toBe('arg\n');
        expect(bash.get_variable('NAME')).toBe('');
        cleanup();
    });

    it('removes the process when it is done', async () => {
        const { bash, cleanup } = await create_bash();
        const before = bash.procs.length;
        await bash.exec_bash('/tmp/script', 'true\n', []);
        expect(bash.procs).toHaveLength(before);
        cleanup();
    });
});

describe('fork', () => {
    it('inherits the environment and the working directory', async () => {
        const { bash, run, cleanup } = await create_bash({ fixture: { '/tmp/': '' } });
        await run('export NAME=bob');
        await run('cd /tmp');
        const child = bash.fork();
        expect(child.env.NAME).toBe('bob');
        expect(child.cwd).toBe('/tmp');
        bash.remove_process(child.pid);
        cleanup();
    });

    it('does not inherit locals', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('NAME=local');
        const child = bash.fork();
        expect(child.get_variable('NAME')).toBe('');
        bash.remove_process(child.pid);
        cleanup();
    });

    it('does not write back to the parent', async () => {
        const { bash, cleanup } = await create_bash();
        const child = bash.fork();
        child.cwd = '/etc';
        child.set_variable('NAME', 'child');
        expect(bash.cwd).toBe('/home/guest');
        expect(bash.get_variable('NAME')).toBe('');
        bash.remove_process(child.pid);
        cleanup();
    });

    it('joins the process table', async () => {
        const { bash, cleanup } = await create_bash();
        const child = bash.fork();
        expect(bash.procs.map(proc => proc.pid)).toContain(child.pid);
        bash.remove_process(child.pid);
        expect(bash.procs.map(proc => proc.pid)).not.toContain(child.pid);
        cleanup();
    });
});

describe('processes', () => {
    it('reports the name and path of a process', async () => {
        const { bash, cleanup } = await create_bash();
        expect(bash.procs).toContainEqual({ name: 'bash', path: '/bin/bash', pid: bash.pid });
        cleanup();
    });

    it('kills a process by pid', async () => {
        const { bash, cleanup } = await create_bash();
        const child = bash.fork();
        // terminate() raises the signal in the caller
        await expect(bash.kill(child.pid)).rejects.toHaveProperty('code', 128 + 15);
        expect(bash.procs.map(proc => proc.pid)).not.toContain(child.pid);
        cleanup();
    });

    it('refuses to kill pid 0', async () => {
        const { bash, cleanup } = await create_bash();
        await expect(bash.kill(0)).rejects.toThrow(/you can't kill/);
        cleanup();
    });

    it('rejects an unknown pid', async () => {
        const { bash, cleanup } = await create_bash();
        await expect(bash.kill(9999)).rejects.toThrow(/not a pid/);
        cleanup();
    });
});

describe('init', () => {
    it('runs /etc/bashrc and then the user bashrc', async () => {
        const { bash, cleanup } = await create_bash({
            fixture: {
                '/etc/bashrc': 'SHARED=etc\nBOTH=etc\n',
                '/home/guest/.bashrc': 'PATH=/bin\nBOTH=home\n'
            }
        });
        await bash.init();
        expect(bash.get_variable('SHARED')).toBe('etc');
        expect(bash.get_variable('BOTH')).toBe('home');
        expect(bash.get_variable('PATH')).toBe('/bin');
        cleanup();
    });

    it('is fine without any bashrc', async () => {
        const { fs, bash, cleanup } = await create_bash();
        await fs.unlink('/home/guest/.bashrc');
        await expect(bash.init()).resolves.toBeUndefined();
        cleanup();
    });
});

describe('version', () => {
    it('comes from package.json', async () => {
        const { bash, cleanup } = await create_bash();
        expect(bash.version).toBe(version);
        cleanup();
    });
});
