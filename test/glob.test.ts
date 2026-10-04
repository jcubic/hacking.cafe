import { describe, expect, it } from 'vitest';

import { create_bash } from './helpers/bash';
import type { ShellOptions } from './helpers/bash';

// Glob runs inside words(), so it reaches every place a word list is built:
// command arguments, array assignments and the word list of a `for`.
//
// The names here are deliberately not created in alphabetical order - a test
// that cares about the order of the matches cannot then pass by accident. Note
// that create_bash adds /home/guest/.bashrc on top of this, which is why the
// dotfile tests expect two names and not one.
const tree = {
    '/home/guest/b.txt': 'B',
    '/home/guest/a.txt': 'A',
    '/home/guest/notes.md': 'M',
    '/home/guest/two.js': '2',
    '/home/guest/one.js': '1',
    '/home/guest/.hidden': 'H',
    '/home/guest/sub/': '',
    '/home/guest/sub/deep.txt': 'D',
    '/home/guest/dir/': '',
    '/home/guest/dir/x.js': 'X'
};

// -----------------------------------------------------------------------------
// what matched, as a set: the matches come back in readdir order, so asserting
// the order here would be asserting the fixture. The order bash guarantees is
// pinned on its own, in the skipped test that covers sorting
// -----------------------------------------------------------------------------
async function matches(code: string, options: ShellOptions = {}) {
    const { output, cleanup } = await create_bash({ fixture: tree, ...options });
    try {
        const text = await output(code);
        return text.replace(/\n$/, '').split(/\s+/).sort();
    } finally {
        cleanup();
    }
}

async function text(code: string, options: ShellOptions = {}) {
    const { output, cleanup } = await create_bash({ fixture: tree, ...options });
    try {
        return await output(code);
    } finally {
        cleanup();
    }
}

describe('glob expansion', () => {
    it('expands * to the names that match', async () => {
        expect(await matches('echo *.txt')).toEqual(['a.txt', 'b.txt']);
    });

    it('expands ? to exactly one character', async () => {
        expect(await matches('echo ?.txt')).toEqual(['a.txt', 'b.txt']);
        // nothing in the tree has a two character stem, so the pattern stands
        expect(await text('echo ??.txt')).toBe('??.txt\n');
    });

    it('expands a character class', async () => {
        expect(await matches('echo [ab].txt')).toEqual(['a.txt', 'b.txt']);
        expect(await matches('echo [b].txt')).toEqual(['b.txt']);
    });

    it('expands a brace alternation', async () => {
        expect(await matches('echo *.{txt,md}')).toEqual(['a.txt', 'b.txt', 'notes.md']);
    });

    it('does not let a single * cross a directory separator', async () => {
        // dir/x.js is not a match for *.js, only the two in the home directory
        expect(await matches('echo *.js')).toEqual(['one.js', 'two.js']);
    });

    it('crosses directories with **', async () => {
        expect(await matches('echo **/*.txt')).toEqual(['a.txt', 'b.txt', 'sub/deep.txt']);
    });

    // with no match bash hands the pattern to the command unchanged, which is
    // what every shell script that tests for "did this expand" relies on
    it('leaves the pattern alone when nothing matches', async () => {
        expect(await text('echo *.zip')).toBe('*.zip\n');
        expect(await text('echo nosuchdir/*.txt')).toBe('nosuchdir/*.txt\n');
    });

    it('yields absolute paths for an absolute pattern', async () => {
        expect(await matches('echo /home/guest/*.txt'))
            .toEqual(['/home/guest/a.txt', '/home/guest/b.txt']);
    });

    it('expands a pattern that names a directory', async () => {
        expect(await text('echo sub/*.txt')).toBe('sub/deep.txt\n');
    });

    it('resolves a relative pattern against the working directory', async () => {
        expect(await text('cd sub\necho *.txt')).toBe('deep.txt\n');
    });

    it('matches a dotfile only when the pattern says so', async () => {
        expect(await matches('echo .*')).toEqual(['.bashrc', '.hidden']);
    });

    it('expands every pattern on the command line', async () => {
        expect(await matches('echo *.md *.txt')).toEqual(['a.txt', 'b.txt', 'notes.md']);
    });

    it('mixes expanded and literal arguments', async () => {
        expect(await matches('echo start *.txt end'))
            .toEqual(['a.txt', 'b.txt', 'end', 'start'].sort());
    });

    it('hands the names to the command', async () => {
        // one match, so this does not depend on the order they come back in
        expect(await text('cat sub/*.txt')).toBe('D');
    });

    it('is left alone inside double quotes', async () => {
        expect(await text('echo "*.txt"')).toBe('*.txt\n');
    });

    it('is left alone when the star is escaped', async () => {
        expect(await text('echo \\*.txt')).toBe('*.txt\n');
    });

    it('expands in an array assignment', async () => {
        expect(await text('L=(*.txt)\necho ${#L}')).toBe('2\n');
        expect(await matches('L=(*.txt)\necho ${L[0]} ${L[1]}')).toEqual(['a.txt', 'b.txt']);
    });

    it('expands in the word list of a for loop', async () => {
        const out = await text('for f in *.txt; do echo "[$f]"; done');
        expect(out.replace(/\n$/, '').split('\n').sort()).toEqual(['[a.txt]', '[b.txt]']);
    });

    it('gives a for loop one iteration of the pattern when nothing matches', async () => {
        const code = 'for f in *.zip; do echo "[$f]"; done';
        expect(await text(code)).toBe('[*.zip]\n');
    });

    it('sorts the matches', async () => {
        expect(await text('echo *.txt')).toBe('a.txt b.txt\n');
        expect(await text('L=(*.txt)\necho ${L[0]}')).toBe('a.txt\n');
        expect(await text('for f in *.txt; do echo $f; done')).toBe('a.txt\nb.txt\n');
    });

    it('skips a dotfile unless the pattern starts with a dot', async () => {
        expect(await matches('echo *'))
            .toEqual(['a.txt', 'b.txt', 'dir', 'notes.md', 'one.js', 'sub', 'two.js']);
    });

    it('is left alone inside single quotes', async () => {
        expect(await text("echo '*.txt'")).toBe('*.txt\n');
        expect(await text("echo '*.zip'")).toBe('*.zip\n');
    });

    it('matches only directories with a trailing slash', async () => {
        expect(await matches('echo */')).toEqual(['dir/', 'sub/']);
    });

    it('expands a tilde in front of a pattern', async () => {
        expect(await matches('echo ~/*.txt'))
            .toEqual(['/home/guest/a.txt', '/home/guest/b.txt']);
    });

    it('expands a pattern built from a variable', async () => {
        expect(await text('D=sub\necho $D/*.txt')).toBe('sub/deep.txt\n');
        expect(await matches('V="*.txt"\necho $V')).toEqual(['a.txt', 'b.txt']);
    });
});
