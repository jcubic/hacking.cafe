import { describe, expect, it } from 'vitest';

import { BufferOutput, PipeOutput, PipeStdin, SilientOutput } from '../src/bash/io';

describe('BufferOutput', () => {
    it('collects writes', () => {
        const out = new BufferOutput();
        out.write('a');
        out.write('b');
        expect(out.output()).toBe('ab');
    });

    it('appends a newline with writeln', () => {
        const out = new BufferOutput();
        out.writeln('line');
        expect(out.output()).toBe('line\n');
    });

    it('drops the buffer on flush', () => {
        const out = new BufferOutput();
        out.write('a');
        out.flush();
        expect(out.output()).toBe('');
    });

    it('drops the buffer on clear', () => {
        const out = new BufferOutput();
        out.write('a');
        out.clear();
        expect(out.output()).toBe('');
    });
});

describe('SilientOutput', () => {
    it('keeps its buffer when a command flushes', () => {
        const out = new SilientOutput();
        out.writeln('kept');
        out.flush();
        out.clear();
        expect(out.output()).toBe('kept\n');
    });
});

describe('PipeOutput', () => {
    it('exposes the buffer so it can be handed to the next command', () => {
        const out = new PipeOutput();
        out.write('one\n');
        out.write('two\n');
        expect(out.buffer).toEqual(['one\n', 'two\n']);
    });
});

describe('PipeStdin', () => {
    it('reads the whole input', () => {
        const stdin = new PipeStdin('one\ntwo\n');
        expect(stdin.read()).toBe('one\ntwo\n');
    });

    it('reads line by line, keeping the newline', () => {
        const stdin = new PipeStdin('one\ntwo\n');
        expect(stdin.read_line()).toBe('one\n');
        expect(stdin.read_line()).toBe('two\n');
        expect(stdin.read_line()).toBeNull();
    });

    it('returns the last line without a trailing newline', () => {
        const stdin = new PipeStdin('one\ntwo');
        expect(stdin.read_line()).toBe('one\n');
        expect(stdin.read_line()).toBe('two');
        expect(stdin.read_line()).toBeNull();
    });

    it('keeps empty lines', () => {
        const stdin = new PipeStdin('\n\n');
        expect(stdin.read_line()).toBe('\n');
        expect(stdin.read_line()).toBe('\n');
        expect(stdin.read_line()).toBeNull();
    });

    it('is empty for empty input', () => {
        const stdin = new PipeStdin('');
        expect(stdin.read()).toBe('');
        expect(stdin.read_line()).toBeNull();
    });

    it('read returns what is left after read_line', () => {
        const stdin = new PipeStdin('one\ntwo\nthree\n');
        stdin.read_line();
        expect(stdin.read()).toBe('two\nthree\n');
    });
});
