import { describe, expect, it } from 'vitest';

import { Exit } from '../src/bash/utils';
import { create_bash } from './helpers/bash';

describe('evaluate', () => {
    it('returns 0 for empty code', async () => {
        const { run, cleanup } = await create_bash();
        expect(await run('')).toBe(0);
        expect(await run('   \n  ')).toBe(0);
        cleanup();
    });

    it('throws on a syntax error, naming the position', async () => {
        const { run, cleanup } = await create_bash();
        await expect(run('if true; then')).rejects.toThrow(/at \d+/);
        cleanup();
    });

    it('runs every command of a script', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('echo one\necho two')).toBe('one\ntwo\n');
        cleanup();
    });

    it('returns the exit code of the last command', async () => {
        const { run, cleanup } = await create_bash();
        expect(await run('true')).toBe(0);
        expect(await run('false')).toBe(1);
        expect(await run('true\nfalse')).toBe(1);
        cleanup();
    });
});

describe('words', () => {
    it('joins double quoted text into one argument', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('echo "a  b"')).toBe('a  b\n');
        cleanup();
    });

    it('does not expand inside single quotes', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output("NAME=bob\necho '$NAME'")).toBe('$NAME\n');
        cleanup();
    });

    it('concatenates adjacent parts of a word', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('NAME=bob\necho "hi $NAME"!')).toBe('hi bob!\n');
        cleanup();
    });
});

describe('variables', () => {
    it('assigns and reads back', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('NAME=bob\necho $NAME')).toBe('bob\n');
        cleanup();
    });

    it('expands an unset variable to nothing', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('echo "[$NOPE]"')).toBe('[]\n');
        cleanup();
    });

    it('keeps an assignment without a command local to the shell', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('NAME=bob');
        expect(bash.get_variable('NAME')).toBe('bob');
        // locals are not exported
        expect(bash.env.NAME).toBeUndefined();
        cleanup();
    });

    it('export puts a variable in the environment', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('export NAME=bob');
        expect(bash.env.NAME).toBe('bob');
        cleanup();
    });

    it('unset removes a variable', async () => {
        const { output, run, cleanup } = await create_bash();
        await run('export NAME=bob');
        await run('unset NAME');
        expect(await output('echo "[$NAME]"')).toBe('[]\n');
        cleanup();
    });

    it('assigns an array and indexes into it', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('LIST=(a b c)\necho ${LIST[1]}')).toBe('b\n');
        cleanup();
    });

    it('expands a bare array reference to its first element', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('LIST=(a b c)\necho $LIST')).toBe('a\n');
        cleanup();
    });

    it('exposes the shell defaults', async () => {
        const { bash, cleanup } = await create_bash({ user: 'ada', host: 'example.com' });
        expect(bash.get_variable('USER')).toBe('ada');
        expect(bash.get_variable('HOSTNAME')).toBe('example.com');
        expect(bash.get_variable('PWD')).toBe('/home/ada');
        expect(bash.get_variable('0')).toBe('bash');
        cleanup();
    });

    it('PWD follows the working directory', async () => {
        const { bash, run, cleanup } = await create_bash({ fixture: { '/tmp/': '' } });
        await run('cd /tmp');
        expect(bash.get_variable('PWD')).toBe('/tmp');
        cleanup();
    });

    it('a local shadows an exported variable', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('export NAME=global');
        await run('NAME=local');
        expect(bash.get_variable('NAME')).toBe('local');
        expect(bash.env.NAME).toBe('global');
        cleanup();
    });

    it('env is a copy, not the shell state', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('export NAME=bob');
        bash.env.NAME = 'hacked';
        expect(bash.get_variable('NAME')).toBe('bob');
        cleanup();
    });
});

describe('$?', () => {
    it('holds the exit code of the previous command', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('true\necho $?')).toBe('0\n');
        expect(await output('false\necho $?')).toBe('1\n');
        cleanup();
    });

    it('is set from a failing command', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('cat /does/not/exist\necho $?')).toBe('1\n');
        cleanup();
    });
});

describe('command substitution', () => {
    it('substitutes the output of a command', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('echo "[$(echo hi)]"')).toBe('[hi]\n');
        cleanup();
    });

    it('strips trailing newlines', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('echo "[$(echo one; echo two)]"')).toBe('[one\ntwo]\n');
        cleanup();
    });

    it('runs in a subshell, so assignments do not leak', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('X=$(NAME=inner; echo $NAME)');
        expect(bash.get_variable('X')).toBe('inner');
        expect(bash.get_variable('NAME')).toBe('');
        cleanup();
    });

    it('inherits exported variables', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('export NAME=bob\necho $(echo $NAME)')).toBe('bob\n');
        cleanup();
    });
});

describe('pipelines', () => {
    it('feeds stdout of one command into the next', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('echo hello | cat')).toBe('hello\n');
        cleanup();
    });

    it('filters with grep', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'printf "one\\ntwo\\nthree\\n" | grep t';
        expect(await output(code)).toBe('two\nthree\n');
        cleanup();
    });

    it('chains more than two commands', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'printf "one\\ntwo\\nthree\\n" | grep t | grep e';
        expect(await output(code)).toBe('three\n');
        cleanup();
    });

    it('runs in a subshell, so a cd inside does not move the shell', async () => {
        const { bash, run, cleanup } = await create_bash({ fixture: { '/tmp/': '' } });
        await run('cd /tmp | cat');
        expect(bash.cwd).toBe('/home/guest');
        cleanup();
    });
});

describe('redirects', () => {
    it('writes stdout to a file', async () => {
        const { fs, run, stdout, cleanup } = await create_bash();
        await run('echo hello > /home/guest/out.txt');
        expect(await fs.readFile('/home/guest/out.txt', 'utf8')).toBe('hello\n');
        expect(stdout.text).toBe('');
        cleanup();
    });

    it('truncates on >', async () => {
        const { fs, run, cleanup } = await create_bash({
            fixture: { '/home/guest/out.txt': 'old\n' }
        });
        await run('echo new > out.txt');
        expect(await fs.readFile('/home/guest/out.txt', 'utf8')).toBe('new\n');
        cleanup();
    });

    it('appends on >>', async () => {
        const { fs, run, cleanup } = await create_bash({
            fixture: { '/home/guest/out.txt': 'one\n' }
        });
        await run('echo two >> out.txt');
        expect(await fs.readFile('/home/guest/out.txt', 'utf8')).toBe('one\ntwo\n');
        cleanup();
    });

    it('redirects stderr with 2>', async () => {
        // `read -p` is the builtin that writes to stderr on a successful run
        const { fs, run, stderr, cleanup } = await create_bash({ input: 'bob\n' });
        await run('read -p "name: " NAME 2> err.txt');
        expect(await fs.readFile('/home/guest/err.txt', 'utf8')).toBe('name: ');
        expect(stderr.text).toBe('');
        cleanup();
    });

    it('appends to a file that does not exist yet', async () => {
        const { fs, run, cleanup } = await create_bash();
        await run('echo one >> out.txt');
        await run('echo two >> out.txt');
        expect(await fs.readFile('/home/guest/out.txt', 'utf8')).toBe('one\ntwo\n');
        cleanup();
    });

    it('leaves stdout alone for the next command', async () => {
        const { output, run, cleanup } = await create_bash();
        await run('echo hidden > out.txt');
        expect(await output('echo visible')).toBe('visible\n');
        cleanup();
    });

    it('keeps the shell usable after the command fails', async () => {
        const { output, run, cleanup } = await create_bash();
        expect(await run('cat /does/not/exist > out.txt')).toBe(1);
        expect(await output('echo visible')).toBe('visible\n');
        cleanup();
    });

    it('still creates the file when the command fails', async () => {
        const { fs, run, cleanup } = await create_bash();
        await run('cat /does/not/exist > out.txt');
        expect(await fs.readFile('/home/guest/out.txt', 'utf8')).toBe('');
        cleanup();
    });

    it('lets the error through on stderr when only stdout is redirected', async () => {
        const { run, stderr, cleanup } = await create_bash();
        await run('cat /does/not/exist > out.txt');
        expect(stderr.text).toMatch(/ENOENT/);
        cleanup();
    });

    it('reads stdin from a file with <', async () => {
        const { output, cleanup } = await create_bash({
            fixture: { '/home/guest/in.txt': 'one\ntwo\n' }
        });
        expect(await output('grep two < in.txt')).toBe('two\n');
        cleanup();
    });

    it('restores stdin after the command', async () => {
        const { output, cleanup } = await create_bash({
            fixture: { '/home/guest/in.txt': 'from file\n' },
            input: 'from terminal\n'
        });
        await output('cat < in.txt');
        expect(await output('cat')).toBe('from terminal\n');
        cleanup();
    });
});

describe('&& and ||', () => {
    it('runs the right side only when the left succeeds', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('true && echo yes')).toBe('yes\n');
        expect(await output('false && echo yes')).toBe('');
        cleanup();
    });

    it('runs the right side only when the left fails', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('false || echo fallback')).toBe('fallback\n');
        expect(await output('true || echo fallback')).toBe('');
        cleanup();
    });

    it('chains', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('true && echo one && echo two')).toBe('one\ntwo\n');
        cleanup();
    });
});

describe('if', () => {
    it('takes the then branch when the clause succeeds', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('if true; then echo yes; fi')).toBe('yes\n');
        cleanup();
    });

    it('takes the else branch when the clause fails', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('if false; then echo yes; else echo no; fi')).toBe('no\n');
        cleanup();
    });

    it('skips everything when the clause fails and there is no else', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('if false; then echo yes; fi')).toBe('');
        cleanup();
    });

    it('uses test as the clause', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'NAME=bob\nif [ "$NAME" = bob ]; then echo hi bob; fi';
        expect(await output(code)).toBe('hi bob\n');
        cleanup();
    });
});

describe('while and until', () => {
    it('loops while the clause succeeds', async () => {
        const { output, cleanup } = await create_bash({ input: 'one\ntwo\n' });
        expect(await output('while read line; do echo "[$line]"; done')).toBe('[one]\n[two]\n');
        cleanup();
    });

    it('loops until the clause succeeds', async () => {
        const { output, cleanup } = await create_bash({ input: 'one\ntwo\n' });
        const code = 'until read line; do echo never; done\necho done';
        expect(await output(code)).toBe('done\n');
        cleanup();
    });

    it('reads a piped file line by line', async () => {
        const { output, cleanup } = await create_bash({
            fixture: { '/home/guest/list.txt': 'a\nb\n' }
        });
        const code = 'cat list.txt | while read line; do echo "[$line]"; done';
        expect(await output(code)).toBe('[a]\n[b]\n');
        cleanup();
    });
});

describe('case', () => {
    it('runs the matching branch', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'X=b\ncase $X in\n  a) echo first ;;\n  b) echo second ;;\nesac';
        expect(await output(code)).toBe('second\n');
        cleanup();
    });

    it('falls back to the default branch', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'X=z\ncase $X in\n  a) echo first ;;\n  *) echo other ;;\nesac';
        expect(await output(code)).toBe('other\n');
        cleanup();
    });

    it('matches any of several patterns', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'X=y\ncase $X in\n  x|y) echo matched ;;\n  *) echo other ;;\nesac';
        expect(await output(code)).toBe('matched\n');
        cleanup();
    });
});

describe('functions', () => {
    it('runs the body when the name is called', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('greet() { echo hello; }\ngreet')).toBe('hello\n');
        cleanup();
    });

    it('runs every command of the body', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo one; echo two; }\nf')).toBe('one\ntwo\n');
        cleanup();
    });

    it('accepts the function keyword', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('function greet { echo hello; }\ngreet')).toBe('hello\n');
        cleanup();
    });

    it('accepts the function keyword together with parentheses', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('function greet() { echo hello; }\ngreet')).toBe('hello\n');
        cleanup();
    });

    // defining a function only records the body - nothing of it runs until the
    // name is called, and the definition itself always succeeds
    it('does not run the body on definition', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo hi; }\necho $?')).toBe('0\n');
        cleanup();
    });

    it('a later definition replaces the earlier one', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo one; }\nf() { echo two; }\nf')).toBe('two\n');
        cleanup();
    });

    it('takes the exit code of the last command of the body', async () => {
        const { run, cleanup } = await create_bash();
        await run('ok() { false; true; }\nbad() { true; false; }');
        expect(await run('ok')).toBe(0);
        expect(await run('bad')).toBe(1);
        cleanup();
    });

    it('reports a body that could not run', async () => {
        const { run, stderr, cleanup } = await create_bash();
        expect(await run('f() { nosuchcommand; }\nf')).toBe(1);
        expect(stderr.text).toMatch(/nosuchcommand: Command not found/);
        cleanup();
    });

    it('calls another function', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'a() { echo A; }\nb() { a; echo B; }\nb';
        expect(await output(code)).toBe('A\nB\n');
        cleanup();
    });

    it('can be defined inside a compound command', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'if true; then f() { echo hi; }; fi\nf';
        expect(await output(code)).toBe('hi\n');
        cleanup();
    });

    // the inner definition is recorded when the outer body runs, not when it is
    // parsed, so the name only resolves after the first call to the outer one
    it('records a nested definition once the outer function runs', async () => {
        const { output, run, stderr, cleanup } = await create_bash();
        await run('outer() { inner() { echo in; }; }');
        expect(await run('inner')).toBe(1);
        expect(stderr.text).toMatch(/inner: Command not found/);
        expect(await output('outer\ninner')).toBe('in\n');
        cleanup();
    });

    it('is usable as the clause of a compound command', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'ok() { true; }\nbad() { false; }\n' +
            'if ok; then echo yes; fi\nbad || echo no\nok && echo and';
        expect(await output(code)).toBe('yes\nno\nand\n');
        cleanup();
    });

    it('honours a redirect inside the body', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'f() { echo inner > out.txt; }\nf\ncat out.txt';
        expect(await output(code)).toBe('inner\n');
        cleanup();
    });

    // there is no `local`, and bash without it behaves the same way: the body
    // assigns in the shell that called it
    it('assigns variables in the calling shell', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('f() { NAME=inner; }\nf');
        expect(bash.get_variable('NAME')).toBe('inner');
        cleanup();
    });

    it('unwinds the shell when the body exits', async () => {
        const { run, cleanup } = await create_bash();
        await expect(run('f() { exit 7; }\nf')).rejects.toBeInstanceOf(Exit);
        await expect(run('f() { exit 7; }\nf')).rejects.toHaveProperty('code', 7);
        cleanup();
    });

    it('rejects a name that is not an identifier', async () => {
        const { run, cleanup } = await create_bash();
        await expect(run('$x() { echo hi; }'))
            .rejects.toThrow("bash: `$x': not a valid identifier");
        cleanup();
    });

    it('rejects a body that is not a brace group', async () => {
        const { run, cleanup } = await create_bash();
        await expect(run('f() ( echo hi )'))
            .rejects.toThrow("bash: syntax error for function `f'");
        cleanup();
    });

    it('is private to the shell it was defined in', async () => {
        const { run, stderr, cleanup } = await create_bash();
        const other = await create_bash();
        await run('f() { echo hi; }');
        expect(await other.run('f')).toBe(1);
        expect(other.stderr.text).toMatch(/f: Command not found/);
        expect(stderr.text).toBe('');
        other.cleanup();
        cleanup();
    });

    // a function shadows a command of the same name, the way bash resolves a
    // name against functions before anything on PATH
    it('shadows a command on PATH', async () => {
        const { output, cleanup } = await create_bash({
            fixture: { '/bin/hi': { content: 'echo from-path\n', mode: 0o755 } }
        });
        expect(await output('export PATH=/bin\nhi')).toBe('from-path\n');
        expect(await output('hi() { echo from-function; }\nhi')).toBe('from-function\n');
        cleanup();
    });
});

describe('function arguments', () => {
    it('passes the call arguments as positional parameters', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo "$1 $2"; }\nf one two')).toBe('one two\n');
        cleanup();
    });

    it('counts them in $#', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo $#; }\nf a b c')).toBe('3\n');
        expect(await output('f')).toBe('0\n');
        cleanup();
    });

    it('joins them in $* and $@', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo "$*"; }\nf a b c')).toBe('a b c\n');
        expect(await output('g() { echo $@; }\ng a b c')).toBe('a b c\n');
        cleanup();
    });

    it('reaches past the ninth with braces', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'f() { echo "${10}"; }\nf 1 2 3 4 5 6 7 8 9 ten';
        expect(await output(code)).toBe('ten\n');
        cleanup();
    });

    it('expands the arguments before the call', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo "[$1]"; }\nX=val\nf $X')).toBe('[val]\n');
        cleanup();
    });

    it('leaves them unset when called without arguments', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo "[$1]"; }\nf')).toBe('[]\n');
        cleanup();
    });

    // the shell's own parameters are the script's, and a call must not be able
    // to overwrite them for whatever runs after it
    it('restores the parameters of the caller', async () => {
        const { output, cleanup } = await create_bash({
            fixture: {
                '/bin/script': {
                    content: 'f() { echo in=$1 n=$#; }\nf inner\necho out=$1 n=$#\n',
                    mode: 0o755
                }
            }
        });
        expect(await output('export PATH=/bin\nscript outer')).toBe(
            'in=inner n=1\nout=outer n=1\n'
        );
        cleanup();
    });

    it('restores them around a nested call', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'a() { echo a1=$1; }\nb() { a inner; echo b1=$1; }\nb outer';
        expect(await output(code)).toBe('a1=inner\nb1=outer\n');
        cleanup();
    });

    it('keeps $0 as the name of the shell', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo $0; }\nf arg')).toBe('bash\n');
        cleanup();
    });
});

// -----------------------------------------------------------------------------
// a function is called through exec(), which puts it where every other command
// already sits: inside the redirect handling, and in a shell that fork() hands
// the function table to
// -----------------------------------------------------------------------------
describe('functions in a forked shell', () => {
    it('is visible inside a subshell', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo hi; }\n( f )')).toBe('hi\n');
        cleanup();
    });

    it('is visible inside a pipeline', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo hi; }\nf | cat')).toBe('hi\n');
        expect(await output('g() { cat; }\necho hi | g')).toBe('hi\n');
        cleanup();
    });

    it('is visible inside a command substitution', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { echo hi; }\necho "[$(f)]"')).toBe('[hi]\n');
        cleanup();
    });

    // a definition belongs to the forked shell, the way a variable does - the
    // parent is left with the body it had
    it('a definition in a subshell does not reach the parent', async () => {
        const { output, run, stderr, cleanup } = await create_bash();
        await run('( f() { echo inner; } )');
        expect(await run('f')).toBe(1);
        expect(stderr.text).toMatch(/f: Command not found/);
        expect(await output('f() { echo outer; }\n( f() { echo inner; } )\nf'))
            .toBe('outer\n');
        cleanup();
    });

    // exit inside a function only unwinds the shell the body runs in, so a
    // subshell should take the status and let the script carry on. Subshell()
    // does not catch Exit, so it unwinds the parent too - nothing to do with
    // functions, a bare `( exit 7 )` behaves the same way
    it('an exit in the body stays inside the subshell', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { exit 7; }\n( f )\necho after=$?')).toBe('after=7\n');
        cleanup();
    });
});

describe('function call redirects', () => {
    it('writes stdout of the body to a file', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'f() { echo out; }\nf > out.txt\ncat out.txt';
        expect(await output(code)).toBe('out\n');
        cleanup();
    });

    it('redirects stderr of the body with 2>', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'f() { nosuchcommand; }\nf 2> err.txt\ncat err.txt';
        expect(await output(code)).toMatch(/nosuchcommand: Command not found/);
        cleanup();
    });

    it('feeds the body stdin from a file with <', async () => {
        const { output, cleanup } = await create_bash();
        const code = 'echo data > in.txt\nf() { cat; }\nf < in.txt';
        expect(await output(code)).toBe('data\n');
        cleanup();
    });

    // the redirect is written on the way out, so what the body printed before
    // it exited still reaches the file
    it('writes the file even when the body exits', async () => {
        const { bash, fs, cleanup } = await create_bash();
        await expect(bash.evaluate('f() { echo hi; exit 7; }\nf > out.txt'))
            .rejects.toHaveProperty('code', 7);
        expect(await fs.readFile('/home/guest/out.txt', 'utf8')).toBe('hi\n');
        cleanup();
    });
});

// -----------------------------------------------------------------------------
// What functions cannot do yet. These are the behaviours bash has, written out
// so the fix has something to turn green - they are skipped, not missing, on
// purpose: each one is a gap in the current implementation, not a wrong
// expectation.
// -----------------------------------------------------------------------------
describe('functions (exit shift)', () => {
    // there is no `return` builtin, so the body always runs to the end and the
    // name resolves as an ordinary command that is not found
    it('return leaves the body early with a status', async () => {
        const { run, output, cleanup } = await create_bash();
        expect(await output('f() { echo a; return; echo b; }\nf')).toBe('a\n');
        expect(await run('g() { return 3; }\ng')).toBe(3);
        cleanup();
    });

    // there is no `shift` builtin either, and walking the arguments of a
    // function is most of what it is for
    it('shift drops the first positional parameter', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('f() { shift; echo "$1 $#"; }\nf a b')).toBe('b 1\n');
        cleanup();
    });
});

describe('prefix assignments', () => {
    it('passes a variable to one command only', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('NAME=once true');
        expect(bash.get_variable('NAME')).toBe('');
        cleanup();
    });
});

describe('exit', () => {
    // exit unwinds the shell it runs in; whoever started that shell - a script
    // runner, or the terminal - is the one that turns it into a status
    it('raises an Exit carrying the code', async () => {
        const { run, cleanup } = await create_bash();
        await expect(run('exit 3')).rejects.toBeInstanceOf(Exit);
        await expect(run('exit 3')).rejects.toHaveProperty('code', 3);
        cleanup();
    });

    it('stops the rest of the script', async () => {
        const { bash, stdout, cleanup } = await create_bash();
        await expect(bash.evaluate('echo before\nexit 0\necho after'))
            .rejects.toBeInstanceOf(Exit);
        expect(stdout.text).toBe('before\n');
        cleanup();
    });

    it('is the status a script reports', async () => {
        const { run, cleanup } = await create_bash({
            fixture: {
                '/bin/three': { content: 'exit 3\n', mode: 0o755 },
                '/bin/clean': { content: 'echo done\nexit 0\n', mode: 0o755 }
            }
        });
        await run('export PATH=/bin');
        expect(await run('three')).toBe(3);
        expect(await run('clean')).toBe(0);
        cleanup();
    });

    it('takes the status of the last command with no argument', async () => {
        const { run, cleanup } = await create_bash({
            fixture: { '/bin/failed': { content: 'false\nexit\n', mode: 0o755 } }
        });
        await run('export PATH=/bin');
        expect(await run('failed')).toBe(1);
        cleanup();
    });
});

describe('subshell', () => {
    it('does not leak variables to the parent shell', async () => {
        const { bash, run, cleanup } = await create_bash();
        await run('NAME=outer');
        await run('(NAME=inner)');
        expect(bash.get_variable('NAME')).toBe('outer');
        cleanup();
    });

    it('does not move the parent shell', async () => {
        const { bash, run, cleanup } = await create_bash({ fixture: { '/tmp/': '' } });
        await run('(cd /tmp)');
        expect(bash.cwd).toBe('/home/guest');
        cleanup();
    });

    it('runs its commands', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('(echo one; echo two)')).toBe('one\ntwo\n');
        cleanup();
    });

    it('sees the environment of the parent shell', async () => {
        const { output, cleanup } = await create_bash();
        expect(await output('export NAME=bob\n(echo $NAME)')).toBe('bob\n');
        cleanup();
    });

    it('leaves the process table as it found it', async () => {
        const { bash, run, cleanup } = await create_bash();
        const before = bash.procs.length;
        await run('(echo x)');
        expect(bash.procs).toHaveLength(before);
        cleanup();
    });
});

describe('background commands', () => {
    it('does not wait for the command and reports success', async () => {
        const { run, cleanup } = await create_bash();
        expect(await run('true &')).toBe(0);
        cleanup();
    });
});
