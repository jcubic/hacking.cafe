import { describe, expect, it } from 'vitest';

import { create_bash } from './helpers/bash';

// every case runs `echo "[...]"` so an empty expansion is visible
async function expand(code: string, setup = '') {
    const shell = await create_bash();
    try {
        const script = [setup, `echo "[${code}]"`].filter(Boolean).join('\n');
        const output = await shell.output(script);
        return output.replace(/^\[|\]\n$/g, '');
    } finally {
        shell.cleanup();
    }
}

describe('${VAR:+alternative}', () => {
    it('yields the alternative when the variable is set', async () => {
        expect(await expand('${NAME:+yes}', 'NAME=bob')).toBe('yes');
    });

    it('yields nothing when the variable is unset', async () => {
        expect(await expand('${NAME:+yes}')).toBe('');
    });

    it('expands the alternative itself', async () => {
        expect(await expand('${NAME:+$OTHER}', 'NAME=bob\nOTHER=sue')).toBe('sue');
    });
});

describe('${VAR:?message}', () => {
    it('yields the value when the variable is set', async () => {
        expect(await expand('${NAME:?missing}', 'NAME=bob')).toBe('bob');
    });

    it('raises the message when the variable is unset', async () => {
        const { run, cleanup } = await create_bash();
        await expect(run('echo ${NAME:?"Error, arg missing!"}'))
            .rejects.toThrow('Error, arg missing!');
        cleanup();
    });

    it('raises for a missing positional argument', async () => {
        const { run, cleanup } = await create_bash();
        await expect(run('USER_ID=${1:?"arg missing"}')).rejects.toThrow('arg missing');
        cleanup();
    });
});

describe('${VAR/pattern/replacement}', () => {
    it('replaces the first match', async () => {
        expect(await expand('${P/-/+}', 'P=a-b-c')).toBe('a+b-c');
    });

    it('replaces every match with //', async () => {
        expect(await expand('${P//-/+}', 'P=a-b-c')).toBe('a+b+c');
    });

    it('treats the pattern as a glob', async () => {
        expect(await expand('${F/*./}', 'F=archive.tar')).toBe('tar');
    });

    it('replaces with the empty string', async () => {
        expect(await expand('${P//-/}', 'P=a-b-c')).toBe('abc');
    });
});

describe('${VAR#prefix} and ${VAR##prefix}', () => {
    it('trims the shortest matching prefix', async () => {
        expect(await expand('${F#*/}', 'F=/usr/local/bin')).toBe('usr/local/bin');
    });

    it('trims the longest matching prefix', async () => {
        expect(await expand('${F##*/}', 'F=/usr/local/bin')).toBe('bin');
    });

    it('extracts an extension', async () => {
        expect(await expand('${FILE#*.}', 'FILE=archive.tar.gz')).toBe('tar.gz');
    });

    it('leaves a string that does not match', async () => {
        expect(await expand('${F#x}', 'F=abc')).toBe('abc');
    });
});

describe('${VAR%suffix} and ${VAR%%suffix}', () => {
    it('trims the shortest matching suffix', async () => {
        expect(await expand('${F%.*}', 'F=archive.tar.gz')).toBe('archive.tar');
    });

    it('trims the longest matching suffix', async () => {
        expect(await expand('${F%%.*}', 'F=archive.tar.gz')).toBe('archive');
    });

    it('takes the first entry of a path list', async () => {
        expect(await expand('${P%%:*}', 'P=/bin:/usr/bin:/sbin')).toBe('/bin');
    });

    it('takes all but the last entry of a path list', async () => {
        expect(await expand('${P%:*}', 'P=/bin:/usr/bin:/sbin')).toBe('/bin:/usr/bin');
    });

    it('leaves a string that does not match', async () => {
        expect(await expand('${F%x}', 'F=abc')).toBe('abc');
    });
});

describe('${VAR^} and ${VAR^^}', () => {
    it('upper cases the first character', async () => {
        expect(await expand('${N^}', 'N=bob')).toBe('Bob');
    });

    it('upper cases everything', async () => {
        expect(await expand('${N^^}', 'N=bob')).toBe('BOB');
    });
});

describe('${#VAR}', () => {
    it('is the length of the string', async () => {
        expect(await expand('${#N}', 'N=hello')).toBe('5');
    });

    it('is zero for an unset variable', async () => {
        expect(await expand('${#N}')).toBe('0');
    });

    it('is the element count of an array', async () => {
        expect(await expand('${#L}', 'L=(a b c)')).toBe('3');
    });
});

describe('${!POINTER}', () => {
    it('reads the variable the pointer names', async () => {
        expect(await expand('${!P}', 'NAME=bob\nP=NAME')).toBe('bob');
    });
});

describe('${VAR:offset:length}', () => {
    it('slices from an offset to the end', async () => {
        expect(await expand('${T:6}', 'T="hello world"')).toBe('world');
    });

    it('slices a length from an offset', async () => {
        expect(await expand('${T:0:5}', 'T="hello world"')).toBe('hello');
        expect(await expand('${T:3:5}', 'T="hello world"')).toBe('lo wo');
    });

    it('takes the offset from a variable', async () => {
        expect(await expand('${T:$N}', 'T="hello world"\nN=6')).toBe('world');
    });
});

describe('${LIST[index]}', () => {
    it('reads an element of an array', async () => {
        expect(await expand('${L[0]}', 'L=(a b c)')).toBe('a');
        expect(await expand('${L[2]}', 'L=(a b c)')).toBe('c');
    });
});

describe('positional parameters', () => {
    const fixture = {
        '/bin/args': { content: 'echo "[$0][$1][$2][$#]"\n', mode: 0o755 },
        '/bin/all': { content: 'echo "[$*]"\necho "[$@]"\n', mode: 0o755 }
    };

    it('passes arguments to a script', async () => {
        const { run, output, cleanup } = await create_bash({ fixture });
        await run('export PATH=/bin');
        expect(await output('args one two')).toBe('[args][one][two][2]\n');
        cleanup();
    });

    it('expands a missing argument to nothing', async () => {
        const { run, output, cleanup } = await create_bash({ fixture });
        await run('export PATH=/bin');
        expect(await output('args one')).toBe('[args][one][][1]\n');
        cleanup();
    });

    it('joins every argument with $* and $@', async () => {
        const { run, output, cleanup } = await create_bash({ fixture });
        await run('export PATH=/bin');
        expect(await output('all one two three')).toBe('[one two three]\n[one two three]\n');
        cleanup();
    });
});
