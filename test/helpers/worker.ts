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
import { connect, Channel, ChannelListener } from '@jcubic/mitty';

type Client = ReturnType<typeof connect>;

const blobs = new Map<string, Blob>();
let counter = 0;

// A Worker and the `self` inside it are two endpoints, and neither ever hears
// its own messages. Modelling them as one endpoint deadlocks the run: the
// client resolves its own request with undefined, and the host reads its own
// reply back as a request, finds no module name in it, and answers its own
// error report forever.
//
// So the two directions are kept apart. The FakeWorker is the main thread's
// view - post to it and the code inside hears it. `worker.self` is the view
// from inside, and is what the prelude passes to Mitty.connect().
export class FakeWorker implements Channel {
    static instances: FakeWorker[] = [];
    // resolves once the worker has read its source and joined the channel
    readonly ready: Promise<void>;
    terminated = false;
    code = '';
    // listeners on the main thread, waiting for worker -> main
    private _outside: ChannelListener[] = [];
    // listeners inside the worker, waiting for main -> worker
    private _inside: ChannelListener[] = [];
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
        await new Promise(resolve => {
            setTimeout(resolve, 100);
        });
        this.code = await blob.text();
        this._client = connect(this.self);
    }

    // the modules the shell exposes, as the script inside the worker sees them
    get require() {
        if (!this._client) {
            throw new Error('FakeWorker: await worker.ready first');
        }
        return this._client.require;
    }

    // -------------------------------------------------------------------------
    // the main thread's side: this object stands in for the Worker
    // -------------------------------------------------------------------------
    postMessage(message: string) {
        FakeWorker._deliver(this._inside, message);
    }

    addEventListener(_type: 'message', listener: ChannelListener) {
        this._outside.push(listener);
    }

    removeEventListener(_type: 'message', listener: ChannelListener) {
        this._outside = this._outside.filter(fn => fn !== listener);
    }

    // -------------------------------------------------------------------------
    // the worker's side: what `self` is to the code running inside
    // -------------------------------------------------------------------------
    get self(): Channel {
        return {
            postMessage: (message: string) => {
                FakeWorker._deliver(this._outside, message);
            },
            addEventListener: (_type: 'message', listener: ChannelListener) => {
                this._inside.push(listener);
            },
            removeEventListener: (_type: 'message', listener: ChannelListener) => {
                this._inside = this._inside.filter(fn => fn !== listener);
            }
        };
    }

    // postMessage queues rather than calling straight through, so a listener
    // never runs inside the send that caused it
    private static _deliver(listeners: ChannelListener[], data: unknown) {
        for (const listener of [...listeners]) {
            queueMicrotask(() => listener({ data } as { data: string }));
        }
    }

    // what the prelude does when main() returns: self.postMessage({ exit }).
    // An object, not a string, and it reaches the main thread - the same pipe
    // mitty uses, which is why exec_js has to tell the two apart.
    exit(code = 0) {
        FakeWorker._deliver(this._outside, { exit: code });
    }

    terminate() {
        this.terminated = true;
        this._client?.close();
    }
}

// -----------------------------------------------------------------------------
// swap in the fake Worker and a URL.createObjectURL that keeps the blob around
// so the worker can read its own source. Returns the uninstall function
// -----------------------------------------------------------------------------
export function install_worker() {
    const globals = globalThis as Record<string, unknown>;
    const worker = globals.Worker;
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;

    globals.Worker = FakeWorker;
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
        blobs.clear();
        globals.Worker = worker;
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
