import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    char,
    color,
    date,
    escape,
    file_date,
    format_bytes,
    glob_to_regex,
    is_permission,
    list_dir,
    list_executables,
    make_directory,
    mode_to_string,
    parse_mode,
    rmdir,
    Signal
} from '../src/bash/utils';

import { create_fs } from './helpers/fs';

describe('char', () => {
    it('returns the character for a code point', () => {
        expect(char(65)).toBe('A');
        expect(char(0x1b)).toBe('\x1b');
    });
});

describe('date', () => {
    it('formats today as weekday, month and day', () => {
        expect(date()).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
    });
});

describe('color', () => {
    it('wraps the text in a jQuery Terminal color formatter', () => {
        expect(color('red', 'error')).toBe('[[;#A00;]error]');
    });

    it('returns the text untouched for an unknown color', () => {
        expect(color('chartreuse', 'error')).toBe('error');
    });
});

describe('escape', () => {
    afterEach(() => {
        delete (globalThis as { $?: unknown }).$;
    });

    it('escapes terminal brackets and html', () => {
        // the real implementation comes from jQuery Terminal, which needs a DOM
        const escape_brackets = vi.fn((text: string) => {
            return text.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
        });
        (globalThis as { $?: unknown }).$ = { terminal: { escape_brackets } };
        expect(escape('<b>[x]</b>')).toBe('&lt;b&gt;&#91;x&#93;&lt;/b&gt;');
        expect(escape_brackets).toHaveBeenCalledOnce();
    });
});

describe('format_bytes', () => {
    it('returns a bare number below a kilobyte', () => {
        expect(format_bytes(0)).toBe('0');
        expect(format_bytes(512)).toBe('512');
    });

    it('scales to binary units', () => {
        expect(format_bytes(1024)).toBe('1KiB');
        expect(format_bytes(1536)).toBe('1.5KiB');
        expect(format_bytes(1024 * 1024)).toBe('1MiB');
        expect(format_bytes(1024 ** 3)).toBe('1GiB');
    });

    it('honours the number of decimals', () => {
        expect(format_bytes(1536, 0)).toBe('2KiB');
        expect(format_bytes(1234567, 3)).toBe('1.177MiB');
    });
});

describe('mode_to_string', () => {
    it('renders posix permission bits', () => {
        expect(mode_to_string(0o755)).toBe('rwxr-xr-x');
        expect(mode_to_string(0o644)).toBe('rw-r--r--');
        expect(mode_to_string(0o000)).toBe('---------');
        expect(mode_to_string(0o777)).toBe('rwxrwxrwx');
    });

    it('ignores the file type bits', () => {
        expect(mode_to_string(0o100644)).toBe('rw-r--r--');
    });
});

describe('file_date', () => {
    it('formats a timestamp the way ls -l does', () => {
        const stamp = new Date(2026, 0, 5, 9, 7).getTime();
        expect(file_date(stamp)).toMatch(/^[A-Za-z]{3}\s{1,2}5 09:07$/);
    });
});

describe('is_permission', () => {
    it.each(['u+x', 'a-w', 'g=r', 'u+x,g-w,o=r'])('accepts %s', (arg) => {
        expect(is_permission(arg)).toBeTruthy();
    });

    it.each(['755', 'u+z', 'x+w', 'u++x', ''])('rejects %s', (arg) => {
        expect(is_permission(arg)).toBeNull();
    });
});

describe('parse_mode', () => {
    it('adds bits', () => {
        expect(parse_mode('u+x', 0o644)).toBe(0o744);
        expect(parse_mode('a+x', 0o644)).toBe(0o755);
    });

    it('removes bits', () => {
        expect(parse_mode('a-w', 0o666)).toBe(0o444);
        expect(parse_mode('o-r', 0o644)).toBe(0o640);
    });

    it('sets a class, clearing the rest of that class only', () => {
        expect(parse_mode('u=r', 0o777)).toBe(0o477);
        expect(parse_mode('g=x', 0o666)).toBe(0o616);
    });

    it('applies every clause of a comma separated list', () => {
        expect(parse_mode('u+x,g-r,o=w', 0o644)).toBe(0o702);
    });

    it('ignores a malformed clause', () => {
        expect(parse_mode('nonsense', 0o644)).toBe(0o644);
    });
});

describe('glob_to_regex', () => {
    function match(glob: string, string: string, greedy = false) {
        return new RegExp('^' + glob_to_regex(glob, greedy) + '$').test(string);
    }

    it('translates * into a lazy any-run by default', () => {
        expect(glob_to_regex('*.txt')).toBe('.*?\\.txt');
        expect(glob_to_regex('*.txt', true)).toBe('.*\\.txt');
    });

    it('translates ? into a single character', () => {
        expect(match('a?c', 'abc')).toBe(true);
        expect(match('a?c', 'ac')).toBe(false);
    });

    it('keeps character classes', () => {
        expect(match('[a-c]x', 'bx')).toBe(true);
        expect(match('[a-c]x', 'dx')).toBe(false);
    });

    it('turns a negated class into a regex one', () => {
        expect(glob_to_regex('[!0-9]')).toBe('[^0-9]');
        expect(match('[!0-9]', 'a')).toBe(true);
        expect(match('[!0-9]', '5')).toBe(false);
    });

    it('escapes an unterminated bracket', () => {
        expect(glob_to_regex('[abc')).toBe('\\[abc');
        expect(match('[abc', '[abc')).toBe(true);
    });

    it('escapes regex metacharacters', () => {
        expect(glob_to_regex('a.b+c(d)')).toBe('a\\.b\\+c\\(d\\)');
        expect(match('a.b+c(d)', 'a.b+c(d)')).toBe(true);
        expect(match('a.b+c(d)', 'axbbc(d)')).toBe(false);
    });
});

describe('Signal', () => {
    it('reports the shell exit code for a signal', () => {
        expect(new Signal(Signal.SIGINT).code).toBe(130);
        expect(new Signal(Signal.SIGKILL).code).toBe(137);
        expect(new Signal(Signal.SIGTERM).code).toBe(143);
    });

    it('carries a plain exit code through unchanged bar the offset', () => {
        expect(new Signal(0).code).toBe(128);
    });
});

describe('make_directory', () => {
    it('creates a directory', async () => {
        const fs = await create_fs();
        await make_directory(fs, '/tmp');
        expect((await fs.stat('/tmp')).isDirectory()).toBe(true);
    });

    it('throws when the directory exists', async () => {
        const fs = await create_fs({ '/tmp/': '' });
        await expect(make_directory(fs, '/tmp')).rejects.toThrow('Directory already exists');
    });

    it('throws when the name is taken by a file', async () => {
        const fs = await create_fs({ '/tmp': 'x' });
        await expect(make_directory(fs, '/tmp')).rejects.toThrow('/tmp is a File');
    });

    it('creates missing parents with the parent flag', async () => {
        const fs = await create_fs();
        await make_directory(fs, '/a/b/c', true);
        expect((await fs.stat('/a/b/c')).isDirectory()).toBe(true);
    });

    it('is a no-op for parents that already exist', async () => {
        const fs = await create_fs({ '/a/b/keep': 'data' });
        await make_directory(fs, '/a/b/c', true);
        expect(await fs.readFile('/a/b/keep', 'utf8')).toBe('data');
    });

    it('rejects an empty path with the parent flag', async () => {
        const fs = await create_fs();
        await expect(make_directory(fs, '/', true)).rejects.toThrow('Invalid argument');
    });

    it('rejects a parent that is a file', async () => {
        const fs = await create_fs({ '/a': 'file' });
        await expect(make_directory(fs, '/a/b', true)).rejects.toThrow('/a is a file');
    });
});

describe('rmdir', () => {
    it('removes a directory tree', async () => {
        const fs = await create_fs({
            '/a/b/c/file': 'x',
            '/a/other': 'y'
        });
        await rmdir(fs, '/a');
        await expect(fs.stat('/a')).rejects.toThrow();
    });

    it('empties the root without removing it', async () => {
        const fs = await create_fs({ '/file': 'x', '/dir/nested': 'y' });
        await rmdir(fs, '/');
        expect(await fs.readdir('/')).toEqual([]);
        expect((await fs.stat('/')).isDirectory()).toBe(true);
    });
});

describe('list_dir', () => {
    it('splits the listing into files and directories', async () => {
        const fs = await create_fs({
            '/dir/file.txt': 'x',
            '/dir/sub/nested': 'y',
            '/dir/.hidden': 'z'
        });
        const { files, dirs } = await list_dir(fs, '/dir');
        expect(files.sort()).toEqual(['.hidden', 'file.txt']);
        expect(dirs).toEqual(['sub']);
    });

    it('counts a symlink to a directory as a directory', async () => {
        const fs = await create_fs({ '/dir/sub/f': 'x' });
        await fs.symlink('/dir/sub', '/dir/link');
        const { files, dirs } = await list_dir(fs, '/dir');
        expect(dirs.sort()).toEqual(['link', 'sub']);
        expect(files).toEqual([]);
    });

    it('lists a broken symlink as a file', async () => {
        const fs = await create_fs({ '/dir/keep': 'x' });
        await fs.symlink('/dir/gone', '/dir/broken');
        const { files } = await list_dir(fs, '/dir');
        expect(files.sort()).toEqual(['broken', 'keep']);
    });
});

describe('list_executables', () => {
    it('returns only files with an execute bit', async () => {
        const fs = await create_fs({
            '/bin/run': { content: '#!/bin/js\n', mode: 0o755 },
            '/bin/group': { content: '', mode: 0o010 },
            '/bin/data': { content: 'x', mode: 0o644 },
            '/bin/sub/nested': 'x'
        });
        expect((await list_executables(fs, '/bin')).sort()).toEqual(['group', 'run']);
    });
});
