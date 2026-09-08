/**
 * RPCBackend — LightningFS storage backend that persists data
 * on the server through the JSON-RPC fs_* methods.
 *
 * Drop it in via the `db` option when constructing LightningFS:
 *
 * ```ts
 * import LightningFS from '@isomorphic-git/lightning-fs';
 * import rpc from '@jcubic/json-rpc';
 * import { RPCBackend } from './fs';
 *
 * const service = await rpc({ url: '/api' });
 * const fs = new LightningFS('rpc', { db: new RPCBackend(service) });
 * ```
 *
 * Values are serialized to base64 before sending, so both text
 * and binary files are supported (Uint8Array, and the superblock
 * Map serialized as [key, value] entries).
 */

import type { RPCService } from '@jcubic/json-rpc';

// -----------------------------------------------------------------------------
// base64 helpers that work with binary data
// -----------------------------------------------------------------------------

function uint8_to_base64(data: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < data.length; i += chunk) {
        binary += String.fromCharCode(...data.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function base64_to_uint8(base64: string): Uint8Array {
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        data[i] = binary.charCodeAt(i);
    }
    return data;
}

// -----------------------------------------------------------------------------
// value (de)serialization: LightningFS stores Uint8Array for file content
// and a Map (inode -> stat entry) for the superblock
// -----------------------------------------------------------------------------

type SerializedValue =
    | { __type: 'uint8array'; data: string }
    | { __type: 'map'; data: [unknown, unknown][] }
    | { __type: 'json'; data: unknown };

function serialize(value: unknown): string {
    let payload: SerializedValue;
    if (value instanceof Uint8Array) {
        payload = { __type: 'uint8array', data: uint8_to_base64(value) };
    } else if (value instanceof Map) {
        payload = { __type: 'map', data: [...value.entries()] };
    } else {
        payload = { __type: 'json', data: value };
    }
    return uint8_to_base64(new TextEncoder().encode(JSON.stringify(payload)));
}

function deserialize(base64: string): unknown {
    const json = new TextDecoder().decode(base64_to_uint8(base64));
    const payload = JSON.parse(json) as SerializedValue;
    switch (payload.__type) {
        case 'uint8array':
            return base64_to_uint8(payload.data);
        case 'map':
            return new Map(payload.data);
        default:
            return payload.data;
    }
}

// -----------------------------------------------------------------------------

export class RPCBackend {
    private _service: RPCService;

    constructor(service: RPCService) {
        this._service = service;
    }

    /** Persist the serialized directory tree (superblock). */
    async saveSuperblock(superblock: Map<unknown, unknown>): Promise<void> {
        await this._service.fs_set('!root', serialize(superblock));
    }

    /** Load the superblock on startup; null when the fs is fresh. */
    async loadSuperblock(): Promise<Map<unknown, unknown> | null> {
        const data = await this._service.fs_get('!root');
        return data === null ? null : deserialize(data as string) as Map<unknown, unknown>;
    }

    /** Read raw file bytes by inode key. */
    async readFile(inode: number): Promise<Uint8Array | null> {
        const data = await this._service.fs_get(String(inode));
        return data === null ? null : deserialize(data as string) as Uint8Array;
    }

    /** Write raw file bytes by inode key. */
    async writeFile(inode: number, data: Uint8Array): Promise<void> {
        await this._service.fs_set(String(inode), serialize(data));
    }

    /** Delete a file by inode key. */
    async unlink(inode: number): Promise<void> {
        await this._service.fs_delete(String(inode));
    }

    /** Wipe is not supported: the store is shared on the server. */
    async wipe(): Promise<void> {
        throw new Error('RPCBackend: wipe is not supported');
    }

    /** No-op: there is no connection to close. */
    close(): void {}
}

export default RPCBackend;
