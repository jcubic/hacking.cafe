/*
 *  Building a Bash instance wired to buffers instead of a terminal.
 *
 *  Copyright (c) 2026 Jakub T. Jankiewicz <https://jakub.jankiewicz.org>
 *
 *  This file is part of Hacking Cafe.
 *
 *  Hacking Cafe is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as published by
 *  the Free Software Foundation; either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  Hacking Cafe is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with Hacking Cafe.  If not, see <http://www.gnu.org/licenses/>.
 *
 */
import { Bash, BufferOutput } from '../../src/bash';
import { PipeStdin } from '../../src/bash/io';
import type { Modules, PromisifiedFS, Stdin } from '../../src/bash/types';

import { create_fs, system } from './fs';
import type { Fixture } from './fs';

// -----------------------------------------------------------------------------
// The terminal's stdout clears its buffer on flush and echoes the text; here it
// is kept so a test can assert on everything a command printed, flushed or not
// -----------------------------------------------------------------------------
export class RecordOutput extends BufferOutput {
    private _written: string[] = [];
    flush() {
        if (this._buffer.length) {
            this._written.push(this.output());
            this.clear();
        }
    }
    // everything written so far, including what is still buffered
    get text() {
        return this._written.join('') + this.output();
    }
    get lines() {
        return this.text.replace(/\n$/, '').split('\n');
    }
    reset() {
        this._written = [];
        this.clear();
    }
}

// -----------------------------------------------------------------------------
// stdin fed from a fixed string; read_line() returns null once it runs out,
// which is how the real terminal signals end of input
// -----------------------------------------------------------------------------
export class StringInput extends PipeStdin implements Stdin { }

export type TestShell = {
    bash: Bash;
    fs: PromisifiedFS;
    stdout: RecordOutput;
    stderr: RecordOutput;
    stdin: Stdin;
    // run bash code and return the exit code
    run(code: string): Promise<number>;
    // run bash code and return what it printed on stdout
    output(code: string): Promise<string>;
    // drop the shell from the process table
    cleanup(): void;
};

export type ShellOptions = {
    fixture?: Fixture;
    user?: string;
    host?: string;
    input?: string;
    modules?: Modules;
    commands?: Record<string, never> | object;
    // a Bash subclass, for the hooks a host application overrides
    ctor?: typeof Bash;
};

// -----------------------------------------------------------------------------
export async function create_bash(options: ShellOptions = {}): Promise<TestShell> {
    const {
        user = 'guest',
        host = 'hacking.cafe',
        input = '',
        modules = {},
        commands = {},
        ctor: Ctor = Bash
    } = options;
    const fs = await create_fs({ ...system(user), ...(options.fixture ?? {}) });
    const stdout = new RecordOutput();
    const stderr = new RecordOutput();
    const stdin = new StringInput(input);
    const bash = new Ctor(commands, {
        home: `/home/${user}`,
        user,
        host,
        fs,
        stdout,
        stderr,
        stdin
    }, modules);
    return {
        bash,
        fs,
        stdout,
        stderr,
        stdin,
        run(code: string) {
            return bash.evaluate(code);
        },
        async output(code: string) {
            stdout.reset();
            await bash.evaluate(code);
            return stdout.text;
        },
        cleanup() {
            bash.remove_process(bash.pid);
        }
    };
}
