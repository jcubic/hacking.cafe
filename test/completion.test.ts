import { describe, expect, it } from 'vitest';

import { Completion } from '../src/bash/types';
import { create_bash } from './helpers/bash';

const fixture = {
    '/home/guest/notes.txt': 'x',
    '/home/guest/projects/readme': 'x',
    '/home/guest/src/main': 'x',
    '/bin/ls': 'x',
    '/bin/lib/': ''
};

async function shell() {
    return create_bash({ fixture });
}

describe('file completion', () => {
    it('lists the working directory, directories first and with a slash', async () => {
        const { bash, cleanup } = await shell();
        const result = await bash.completion('', Completion.File);
        expect(result).toEqual(['projects/', 'src/', '.bashrc', 'notes.txt']);
        cleanup();
    });

    it('lists the directory named by an absolute path', async () => {
        const { bash, cleanup } = await shell();
        const result = await bash.completion('/bin/l', Completion.File);
        expect(result.sort()).toEqual(['/bin/lib/', '/bin/ls']);
        cleanup();
    });

    it('lists the root', async () => {
        const { bash, cleanup } = await shell();
        const result = await bash.completion('/', Completion.File);
        expect(result.sort()).toEqual(['/bin/', '/etc/', '/home/']);
        cleanup();
    });

    it('expands a leading tilde but keeps it in the candidates', async () => {
        const { bash, cleanup } = await shell();
        bash.cwd = '/bin';
        const result = await bash.completion('~/', Completion.File);
        expect(result).toContain('~/notes.txt');
        expect(result).toContain('~/projects/');
        cleanup();
    });

    it('follows the current directory', async () => {
        const { bash, cleanup } = await shell();
        bash.cwd = '/home/guest/projects';
        expect(await bash.completion('', Completion.File)).toEqual(['readme']);
        cleanup();
    });
});

describe('directory completion', () => {
    it('lists directories only', async () => {
        const { bash, cleanup } = await shell();
        expect(await bash.completion('', Completion.Directory)).toEqual([
            'projects/',
            'src/'
        ]);
        cleanup();
    });

    it('lists directories under an absolute path', async () => {
        const { bash, cleanup } = await shell();
        expect(await bash.completion('/bin/', Completion.Directory)).toEqual(['/bin/lib/']);
        cleanup();
    });
});
