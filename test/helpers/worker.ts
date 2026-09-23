/*
 *  A stand-in for the Web Worker that Bash::exec_js() spawns.
 *
 *  The worker's own prelude (src/bash/process.js) cannot run here - it starts
 *  with importScripts() and only makes sense in a browser. What *can* be
 *  exercised in Node is the half of the conversation that lives on this side:
 *  the mitty Host the shell sets up, the modules it hands out, and the process
 *  bookkeeping around the worker's lifetime. So the fake worker skips the
 *  prelude and connects a mitty client to the channel the shell is listening
 *  on, exactly as the real prelude does with Mitty.connect().
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
import { connect } from '@jcubic/mitty';

type Client = ReturnType<typeof connect>;
type Listener = (event: { data: unknown }) => void;

const blobs = new Map<string, Blob>();
let counter = 0;

// An open BroadcastChannel keeps Node's event loop alive, so every channel
// opened while the fake worker is installed is recorded and closed on the way
// out - a test that leaves one behind would hold up the whole run.
const channels: BroadcastChannel[] = [];

class TrackedChannel extends BroadcastChannel {
    constructor(name: string) {
        super(name);
        channels.push(this);
    }
}

export class FakeWorker {
    static instances: FakeWorker[] = [];
    // resolves once the worker has read its source and joined the channel
    readonly ready: Promise<void>;
    terminated = false;
    code = '';
    pid = -1;
    private _listeners: Listener[] = [];
    private _channel?: BroadcastChannel;
    private _client?: Client;

    constructor(url: string) {
        FakeWorker.instances.push(this);
        this.ready = this._start(url);
    }

    private async _start(url: string) {
        const blob = blobs.get(url);
        if (!blob) {
            throw new Error(`FakeWorker: nothing was registered for ${url}`);
        }
        this.code = await blob.text();
        const match = this.code.match(/__ipc__:(\d+)/);
        if (!match) {
            throw new Error('FakeWorker: the prelude names no channel');
        }
        this.pid = parseInt(match[1], 10);
        this._channel = new BroadcastChannel(`__ipc__:${this.pid}`);
        this._client = connect(this._channel);
    }

    // the modules the shell exposes, as the script inside the worker sees them
    get require() {
        if (!this._client) {
            throw new Error('FakeWorker: await worker.ready first');
        }
        return this._client.require;
    }

    addEventListener(_type: string, listener: Listener) {
        this._listeners.push(listener);
    }

    // what the prelude does when main() returns
    exit(code = 0) {
        for (const listener of this._listeners) {
            listener({ data: { exit: code } });
        }
    }

    terminate() {
        this.terminated = true;
        this._client?.close();
        this._channel?.close();
    }
}

// -----------------------------------------------------------------------------
// swap in the fake Worker and a URL.createObjectURL that keeps the blob around
// so the worker can read its own source. Returns the uninstall function
// -----------------------------------------------------------------------------
export function install_worker() {
    const globals = globalThis as Record<string, unknown>;
    const worker = globals.Worker;
    const channel = globals.BroadcastChannel;
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;

    globals.Worker = FakeWorker;
    globals.BroadcastChannel = TrackedChannel;
    URL.createObjectURL = (blob: Blob) => {
        const url = `blob:test/${++counter}`;
        blobs.set(url, blob);
        return url;
    };
    URL.revokeObjectURL = (url: string) => {
        blobs.delete(url);
    };

    return () => {
        for (const instance of FakeWorker.instances) {
            instance.terminate();
        }
        FakeWorker.instances = [];
        while (channels.length) {
            channels.pop()?.close();
        }
        blobs.clear();
        globals.Worker = worker;
        globals.BroadcastChannel = channel;
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
    };
}

// -----------------------------------------------------------------------------
// the worker exec_js() spawned last, once it is connected
// -----------------------------------------------------------------------------
export async function last_worker() {
    const worker = FakeWorker.instances.at(-1);
    if (!worker) {
        throw new Error('no worker was created');
    }
    await worker.ready;
    return worker;
}
