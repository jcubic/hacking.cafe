/*
 *  IO classes
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

import type {
    Stdout,
    Stdin
} from './types';

/*
 * We need to use buffers in order to redirect them with pipes.
 * the command write to stdout when no pipes or last in pipe
 * the buffer are flushed.
 */
export class BufferOutput implements Stdout {
    protected _buffer: string[];
    constructor(buffer = []) {
        this._buffer = buffer;
    }
    output() {
        return this._buffer.join('');
    }
    flush() {
        if (this._buffer.length) {
            this.clear();
        }
    }
    clear() {
        this._buffer = [];
    }
    write(str: string) {
        this._buffer.push(str);
    }
    writeln(str: string) {
        this.write(str + '\n');
    }
}

export class SilientOutput extends BufferOutput {
    flush() { }
    clear() { }
}

/*
 * PipeOutput exposes internal buffer so it can be passed
 * to PipeStdin
 */
export class PipeOutput extends BufferOutput {
    get buffer() {
        return this._buffer;
    }
}

/*
 * PipeStdin accept buffer from stdout as constructor
 * and return the content of that buffer when command reads the data
 */
export class PipeStdin implements Stdin {
    protected _lines: string[];
    constructor(buff: string) {
        this._lines = buff.match(/.*?\n|.+$/g) || [];
    }
    read() {
        return this._lines.join('');
    }
    read_line() {
        if (!this._lines.length) {
            return null;
        }
        return this._lines.shift() as string;
    }
}
