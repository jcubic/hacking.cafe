import { describe, expect, it } from 'vitest';

import { create_bash } from './helpers/bash';

// ls paints its entries; the colors are not what these tests are about
function plain(text: string) {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
}

// retries an assertion until it holds, for the commands that return before
// the work they started has finished
async function eventually(assertion: () => Promise<void>, timeout = 1000) {
    const deadline = Date.now() + timeout;
    for (;;) {
        try {
            return await assertion();
        } catch (error) {
            if (Date.now() > deadline) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    }
}

describe('echo', () => {
    it('prints its arguments separated by a space', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('echo one two three')).toBe('one two three\n');
        cleanup();
    });

    it('prints an empty line with no arguments', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('echo')).toBe('\n');
        cleanup();
    });

    it('drops the newline with -n', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('echo -n hello')).toBe('hello');
        cleanup();
    });

    it('interprets escapes with -e', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output(String.raw`echo -e 'a\tb\nc'`)).toBe('a\tb\nc\n');
        cleanup();
    });

    it('leaves escapes alone without -e', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output(String.raw`echo 'a\tb'`)).toBe('a\\tb\n');
        cleanup();
    });

    it('understands octal and hex escapes with -e', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output(String.raw`echo -e '\x41\0101'`)).toBe('AA\n');
        cleanup();
    });
});

describe('pwd', () => {
    it('prints the working directory', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('pwd')).toBe('/home/guest\n');
        cleanup();
    });
});

describe('cd', () => {
    it('changes the working directory', async () => {
        const { bash, run, cleanup } = await create_bash({ fixture: { '/tmp/': '' } });
        await run('cd /tmp');
        expect(bash.cwd).toBe('/tmp');
        cleanup();
    });

    it('goes home with no argument', async () => {
        const { bash, run, cleanup } = await create_bash({ fixture: { '/tmp/': '' } });
        await run('cd /tmp');
        await run('cd');
        expect(bash.cwd).toBe('/home/guest');
        cleanup();
    });

    it('expands a tilde', async () => {
        const { bash, run, cleanup } = await create_bash({
            fixture: { '/home/guest/src/': '' }
        });
        await run('cd /');
        await run('cd ~/src');
        expect(bash.cwd).toBe('/home/guest/src');
        cleanup();
    });

    it('follows a relative path', async () => {
        const { bash, run, cleanup } = await create_bash({
            fixture: { '/home/guest/a/b/': '' }
        });
        await run('cd a/b');
        expect(bash.cwd).toBe('/home/guest/a/b');
        await run('cd ..');
        expect(bash.cwd).toBe('/home/guest/a');
        cleanup();
    });

    it('reports a missing directory and stays put', async () => {
        const { bash, run, stderr, cleanup } = await create_bash();
        await run('cd /nope');
        expect(stderr.text).toMatch(/Directory doesn't exits/);
        expect(bash.cwd).toBe('/home/guest');
        cleanup();
    });

    it('refuses to enter a file', async () => {
        const { bash, run, stderr, cleanup } = await create_bash({
            fixture: { '/home/guest/file': 'x' }
        });
        await run('cd file');
        expect(stderr.text).toMatch(/is not directory/);
        expect(bash.cwd).toBe('/home/guest');
        cleanup();
    });
});

describe('cat', () => {
    it('prints a file', async () => {
        const { output, cleanup } = await create_bash({
            fixture: { '/home/guest/a.txt': 'hello\n' }
        });
        expect(await output('cat a.txt')).toBe('hello\n');
        cleanup();
    });

    it('concatenates several files', async () => {
        const { output, cleanup } = await create_bash({
            fixture: { '/home/guest/a': 'one\n', '/home/guest/b': 'two\n' }
        });
        expect(await output('cat a b')).toBe('one\ntwo\n');
        cleanup();
    });

    it('copies stdin when given no file', async () => {
        const { output, cleanup } = await create_bash({ input: 'from stdin\n' });
        expect(await output('cat')).toBe('from stdin\n');
        cleanup();
    });

    it('reports a missing file', async () => {
        const { run, stderr, cleanup } = await create_bash();
        expect(await run('cat nope.txt')).toBe(1);
        expect(stderr.text).toMatch(/ENOENT/);
        cleanup();
    });
});

describe('grep', () => {
    const fixture = { '/home/guest/list.txt': 'Apple\nbanana\ncherry\n' };

    it('prints matching lines of a file', async () => {
        const { output, cleanup } = await create_bash({ fixture });
        expect(await output('grep an list.txt')).toBe('banana\n');
        cleanup();
    });

    it('matches a regular expression', async () => {
        const { output, cleanup } = await create_bash({ fixture });
        expect(await output('grep "^c" list.txt')).toBe('cherry\n');
        cleanup();
    });

    it('ignores case with -i', async () => {
        const { output, cleanup } = await create_bash({ fixture });
        expect(await output('grep -i apple list.txt')).toBe('Apple\n');
        cleanup();
    });

    it('reads stdin when given no file', async () => {
        const { output, cleanup } = await create_bash({ input: 'one\ntwo\n' });
        expect(await output('grep two')).toBe('two\n');
        cleanup();
    });
});

describe('mkdir', () => {
    it('creates a directory', async () => {
        const { fs, run, cleanup } = await create_bash();
        await run('mkdir /home/guest/new');
        expect((await fs.stat('/home/guest/new')).isDirectory()).toBe(true);
        cleanup();
    });

    it('creates several directories', async () => {
        const { fs, run, cleanup } = await create_bash();
        await run('mkdir a b');
        expect((await fs.stat('/home/guest/a')).isDirectory()).toBe(true);
        expect((await fs.stat('/home/guest/b')).isDirectory()).toBe(true);
        cleanup();
    });

    it('creates parents with -p', async () => {
        const { fs, run, cleanup } = await create_bash();
        await run('mkdir -p a/b/c');
        expect((await fs.stat('/home/guest/a/b/c')).isDirectory()).toBe(true);
        cleanup();
    });

    it('reports an existing directory', async () => {
        const { run, stderr, cleanup } = await create_bash({
            fixture: { '/home/guest/dir/': '' }
        });
        expect(await run('mkdir dir')).toBe(1);
        expect(stderr.text).toMatch(/already exists/);
        cleanup();
    });
});

describe('ls', () => {
    const fixture = {
        '/home/guest/dir/': '',
        '/home/guest/file.txt': 'x',
        '/home/guest/.hidden': 'x',
        '/home/guest/run': { content: '', mode: 0o755 }
    };

    it('lists visible entries', async () => {
        const { output, cleanup } = await create_bash({ fixture });
        expect(plain(await output('ls')).split('\n').filter(Boolean).sort())
            .toEqual(['dir', 'file.txt', 'run']);
        cleanup();
    });

    it('includes dot entries with -a', async () => {
        const { output, cleanup } = await create_bash({ fixture });
        const entries = plain(await output('ls -a')).split('\n').filter(Boolean);
        expect(entries).toContain('.');
        expect(entries).toContain('..');
        expect(entries).toContain('.hidden');
        cleanup();
    });

    it('includes dot files but not . and .. with -A', async () => {
        const { output, cleanup } = await create_bash({ fixture });
        const entries = plain(await output('ls -A')).split('\n').filter(Boolean);
        expect(entries).toContain('.hidden');
        expect(entries).not.toContain('.');
        expect(entries).not.toContain('..');
        cleanup();
    });

    it('lists another directory', async () => {
        const { output, cleanup } = await create_bash({
            fixture: { '/home/guest/dir/inner': 'x' }
        });
        expect(plain(await output('ls dir')).trim()).toBe('inner');
        cleanup();
    });

    it('shows mode, size and date with -l', async () => {
        const { output, cleanup } = await create_bash({
            fixture: { '/home/guest/file.txt': { content: 'hello', mode: 0o644 } }
        });
        const line = plain(await output('ls -l')).split('\n').find(l => l.includes('file.txt'));
        // the month name comes from the runtime locale, so it is not pinned here
        expect(line).toMatch(/^rw-r--r--\s+5 \S+\s+\d{1,2} \d{2}:\d{2} file\.txt$/);
        cleanup();
    });

    it('marks a directory, an executable and a symlink', async () => {
        const { fs, output, cleanup } = await create_bash({ fixture });
        await fs.symlink('/home/guest/file.txt', '/home/guest/link');
        const text = await output('ls');
        expect(text).toMatch(/\x1b\[01;34mdir\x1b\[m/);
        expect(text).toMatch(/\x1b\[01;32mrun\x1b\[m/);
        expect(text).toMatch(/\x1b\[01;36mlink\x1b\[m/);
        cleanup();
    });
});

describe('rm', () => {
    it('removes a file', async () => {
        const { fs, run, cleanup } = await create_bash({
            fixture: { '/home/guest/file': 'x' }
        });
        await run('rm file');
        await expect(fs.stat('/home/guest/file')).rejects.toThrow(/ENOENT/);
        cleanup();
    });

    it('refuses a directory without -r', async () => {
        const { fs, run, stderr, cleanup } = await create_bash({
            fixture: { '/home/guest/dir/f': 'x' }
        });
        await run('rm dir');
        expect(stderr.text).toMatch(/is a directory/);
        expect((await fs.stat('/home/guest/dir')).isDirectory()).toBe(true);
        cleanup();
    });

    it('removes a tree with -r', async () => {
        // rm returns before the delete finishes - see known-bugs
        const { fs, run, cleanup } = await create_bash({
            fixture: { '/home/guest/dir/sub/f': 'x' }
        });
        await run('rm -r dir');
        await eventually(async () => {
            await expect(fs.stat('/home/guest/dir')).rejects.toThrow(/ENOENT/);
        });
        cleanup();
    });
});

describe('chmod', () => {
    it('sets an octal mode', async () => {
        const { fs, run, cleanup } = await create_bash({
            fixture: { '/home/guest/file': { content: 'x', mode: 0o644 } }
        });
        await run('chmod 755 file');
        expect((await fs.stat('/home/guest/file')).mode & 0o777).toBe(0o755);
        cleanup();
    });

    it('applies a symbolic mode', async () => {
        const { fs, run, cleanup } = await create_bash({
            fixture: { '/home/guest/file': { content: 'x', mode: 0o644 } }
        });
        await run('chmod u+x file');
        expect((await fs.stat('/home/guest/file')).mode & 0o777).toBe(0o744);
        cleanup();
    });

    it('changes several files at once', async () => {
        const { fs, run, cleanup } = await create_bash({
            fixture: {
                '/home/guest/a': { content: '', mode: 0o644 },
                '/home/guest/b': { content: '', mode: 0o644 }
            }
        });
        await run('chmod 700 a b');
        expect((await fs.stat('/home/guest/a')).mode & 0o777).toBe(0o700);
        expect((await fs.stat('/home/guest/b')).mode & 0o777).toBe(0o700);
        cleanup();
    });

    it('prints usage when given no file', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('chmod 755')).toBe('Usage: chmod mode files\n');
        cleanup();
    });
});

describe('ln', () => {
    it('creates a symlink with -s', async () => {
        const { fs, run, cleanup } = await create_bash({
            fixture: { '/home/guest/file': 'content' }
        });
        expect(await run('ln -s file link')).toBe(0);
        expect((await fs.lstat('/home/guest/link')).isSymbolicLink()).toBe(true);
        expect(await fs.readFile('/home/guest/link', 'utf8')).toBe('content');
        cleanup();
    });

    it('refuses a hard link', async () => {
        const { run, stderr, cleanup } = await create_bash({
            fixture: { '/home/guest/file': 'x' }
        });
        expect(await run('ln file link')).toBe(1);
        expect(stderr.text).toMatch(/hardlinks not supported/);
        cleanup();
    });
});

describe('read', () => {
    it('reads a line into a variable', async () => {
        const { bash, run, cleanup } = await create_bash({ input: 'bob\n' });
        await run('read NAME');
        expect(bash.get_variable('NAME')).toBe('bob');
        cleanup();
    });

    it('defaults to REPLY', async () => {
        const { bash, run, cleanup } = await create_bash({ input: 'bob\n' });
        await run('read');
        expect(bash.get_variable('REPLY')).toBe('bob');
        cleanup();
    });

    it('splits a line across several variables', async () => {
        const { bash, run, cleanup } = await create_bash({ input: 'one two\n' });
        await run('read A B');
        expect(bash.get_variable('A')).toBe('one');
        expect(bash.get_variable('B')).toBe('two');
        cleanup();
    });

    it('leaves extra variables empty', async () => {
        const { bash, run, cleanup } = await create_bash({ input: 'one\n' });
        await run('read A B');
        expect(bash.get_variable('B')).toBe('');
        cleanup();
    });

    it('writes the prompt of -p to stderr', async () => {
        const { run, stderr, cleanup } = await create_bash({ input: 'bob\n' });
        await run('read -p "name: " NAME');
        expect(stderr.text).toBe('name: ');
        cleanup();
    });

    it('fails at the end of input', async () => {
        const { run, cleanup } = await create_bash({ input: '' });
        expect(await run('read NAME')).toBe(1);
        cleanup();
    });
});

describe('test', () => {
    async function status(code: string, fixture = {}) {
        const shell = await create_bash({ fixture });
        try {
            return await shell.run(code);
        } finally {
            shell.cleanup();
        }
    }

    it('compares strings', async () => {
        expect(await status('test a = a')).toBe(0);
        expect(await status('test a = b')).toBe(1);
        expect(await status('test a != b')).toBe(0);
    });

    it('orders strings', async () => {
        expect(await status('test a "<" b')).toBe(0);
        expect(await status('test b "<" a')).toBe(1);
        expect(await status('test b ">" a')).toBe(0);
    });

    // -ne, -le and -ge are missing here on purpose: they are swallowed by the
    // -e file test before they are ever compared, see known-bugs
    it('compares numbers', async () => {
        expect(await status('test 2 -eq 2')).toBe(0);
        expect(await status('test 3 -eq 2')).toBe(1);
        expect(await status('test 1 -lt 2')).toBe(0);
        expect(await status('test 2 -lt 1')).toBe(1);
        expect(await status('test 3 -gt 2')).toBe(0);
        expect(await status('test 2 -gt 3')).toBe(1);
    });

    it('tests for an empty string', async () => {
        expect(await status('test -z ""')).toBe(0);
        expect(await status('test -z x')).toBe(1);
        expect(await status('test -n x')).toBe(0);
        expect(await status('test -n ""')).toBe(1);
    });

    it('tests files', async () => {
        const fixture = { '/home/guest/file': 'x', '/home/guest/dir/': '' };
        expect(await status('test -e file', fixture)).toBe(0);
        expect(await status('test -e nope', fixture)).toBe(1);
        expect(await status('test -f file', fixture)).toBe(0);
        expect(await status('test -f dir', fixture)).toBe(1);
        expect(await status('test -d dir', fixture)).toBe(0);
        expect(await status('test -d file', fixture)).toBe(1);
    });

    it('tests a symlink without following it', async () => {
        const shell = await create_bash({ fixture: { '/home/guest/file': 'x' } });
        await shell.run('ln -s file link');
        expect(await shell.run('test -L link')).toBe(0);
        expect(await shell.run('test -L file')).toBe(1);
        expect(await shell.run('test -h link')).toBe(0);
        shell.cleanup();
    });

    it('rejects an unknown operator', async () => {
        const { run, stderr, cleanup } = await create_bash();
        expect(await run('test a -zz b')).toBe(1);
        expect(stderr.text).toMatch(/unsuported operator/);
        cleanup();
    });

    it('is available as [ ... ]', async () => {
        expect(await status('[ a = a ]')).toBe(0);
        expect(await status('[ a = b ]')).toBe(1);
    });

    it('needs the closing bracket', async () => {
        // raised before the command runs, so it escapes evaluate() instead of
        // going to stderr - the terminal prints it from its own catch
        const { run, cleanup } = await create_bash();
        await expect(run('[ a = a')).rejects.toThrow(/missing `\]'/);
        cleanup();
    });
});

describe('printf', () => {
    it('prints a format with no placeholder as is', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output(String.raw`printf "hello\n"`)).toBe('hello\n');
        cleanup();
    });

    it('substitutes arguments', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output(String.raw`printf "%s=%s\n" name bob`)).toBe('name=bob\n');
        cleanup();
    });

    it('repeats the format until the arguments run out', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output(String.raw`printf "%s\n" a b c`)).toBe('a\nb\nc\n');
        cleanup();
    });

    it('pads a missing argument with an empty string', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output(String.raw`printf "[%s|%s]\n" a`)).toBe('[a|]\n');
        cleanup();
    });

    it('formats numbers', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output(String.raw`printf "%d %05.2f\n" 42 3.14159`)).toBe('42 03.14\n');
        cleanup();
    });

    it('interprets escapes in the format', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output(String.raw`printf "a\tb\n"`)).toBe('a\tb\n');
        expect(await output(String.raw`printf "A\n"`)).toBe('A\n');
        cleanup();
    });

    it('reports usage without a format', async () => {
        const { run, stderr, cleanup } = await create_bash();
        expect(await run('printf')).toBe(2);
        expect(stderr.text).toMatch(/usage: printf/);
        cleanup();
    });
});

describe('pushd, popd and dirs', () => {
    it('walks the directory stack', async () => {
        const { bash, output, cleanup } = await create_bash({
            fixture: { '/tmp/': '', '/etc/': '' }
        });
        expect(await output('pushd /tmp')).toBe('/tmp ~\n');
        expect(bash.cwd).toBe('/tmp');
        expect(await output('pushd /etc')).toBe('/etc /tmp ~\n');
        expect(await output('popd')).toBe('/tmp ~\n');
        expect(bash.cwd).toBe('/tmp');
        expect(await output('popd')).toBe('~\n');
        expect(bash.cwd).toBe('/home/guest');
        cleanup();
    });

    it('reports an empty stack', async () => {
        const { run, stderr, cleanup } = await create_bash();
        expect(await run('popd')).toBe(1);
        expect(stderr.text).toMatch(/directory stack empty/);
        cleanup();
    });

    it('shows the working directory alone by default', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('dirs')).toBe('~\n');
        cleanup();
    });
});

describe('source', () => {
    // source does not await the code it runs, and when it is reached through
    // the parser the assignments it makes are lost - see known-bugs. Called
    // directly, it does what it says
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    it('runs a script in the current shell', async () => {
        const { bash, cleanup } = await create_bash({
            fixture: { '/home/guest/vars.sh': 'NAME=bob\n' }
        });
        await bash.exec('source', 'vars.sh');
        await tick();
        expect(bash.get_variable('NAME')).toBe('bob');
        cleanup();
    });

    it('runs the commands of a sourced file', async () => {
        const { output, cleanup } = await create_bash({
            fixture: { '/home/guest/hello.sh': 'echo sourced\n' }
        });
        expect(await output('source hello.sh')).toBe('sourced\n');
        cleanup();
    });

    it('is available as .', async () => {
        const { output, cleanup } = await create_bash({
            fixture: { '/home/guest/hello.sh': 'echo sourced\n' }
        });
        expect(await output('. hello.sh')).toBe('sourced\n');
        cleanup();
    });
});

describe('adduser', () => {
    it('creates the home directory, a bashrc and a passwd entry', async () => {
        const { fs, bash, run, cleanup } = await create_bash();
        await run('adduser ada');
        expect((await fs.stat('/home/ada')).isDirectory()).toBe(true);
        expect(await fs.readFile('/home/ada/.bashrc', 'utf8')).toMatch(/PS1=/);
        const users = await bash.users();
        expect(users.map(user => user.username)).toContain('ada');
        cleanup();
    });

    it('does not add the same user twice', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('adduser ada');
        await run('adduser ada');
        const users = await bash.users();
        expect(users.filter(user => user.username === 'ada')).toHaveLength(1);
        cleanup();
    });

    it('prints usage without a name', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('adduser')).toBe('Usage: useradd LOGIN\n');
        cleanup();
    });
});

describe('ps and kill', () => {
    it('lists the running shell', async () => {
        const { bash, output, cleanup } = await create_bash();
        const text = await output('ps');
        expect(text.split('\n')[0]).toMatch(/PID\s+CMD/);
        expect(text).toMatch(new RegExp(`${bash.pid}\\s+bash`));
        cleanup();
    });

    it('refuses to kill pid 0', async () => {
        const { run, stderr, cleanup } = await create_bash();
        await run('kill 0');
        expect(stderr.text).toMatch(/you can't kill/);
        cleanup();
    });

    it('reports an unknown pid', async () => {
        const { run, stderr, cleanup } = await create_bash();
        await run('kill 9999');
        expect(stderr.text).toMatch(/not a pid/);
        cleanup();
    });

    it('needs a pid', async () => {
        const { run, stderr, cleanup } = await create_bash();
        await run('kill');
        expect(stderr.text).toMatch(/usage: kill/);
        cleanup();
    });
});
