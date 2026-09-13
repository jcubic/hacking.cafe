import path from 'path-browserify';

import type { ListDir, PromisifiedFS } from './types';

export function char(int: number) {
    return String.fromCharCode(int);
}

// -----------------------------------------------------------------------------
export async function make_directory(fs: PromisifiedFS, dir: string, parent = false) {
    if (parent) {
        const parts = dir.split('/').filter(part => part !== '');
        if (!parts.length) {
            throw new Error('Invalid argument');
        }
        let full_path = '/';
        for (const part of parts) {
            full_path = path.join(full_path, part);
            const stat = await stat_or_null(fs, full_path);
            if (!stat) {
                await fs.mkdir(full_path);
            } else if (stat.isFile()) {
                throw new Error(`${full_path} is a file`);
            }
        }
    } else {
        const stat = await stat_or_null(fs, dir);
        if (!stat) {
            await fs.mkdir(dir);
        } else if (stat.isDirectory()) {
            throw new Error('Directory already exists');
        } else if (stat.isFile()) {
            throw new Error(`${dir} is a File`);
        }
    }
}

// -----------------------------------------------------------------------------
export async function rmdir(fs: PromisifiedFS, dir: string) {
    const list = await fs.readdir(dir);
    for(const name of list) {
        const filename = path.join(dir, name);
        const stat = await fs.stat(filename);
        if (!filename.match(/^\.{1,2}$/)) {
            if(stat.isDirectory()) {
                await rmdir(fs, filename);
            } else {
                fs.unlink(filename);
            }
        }
    }
    await fs.rmdir(dir);
}

// -----------------------------------------------------------------------------
async function stat_or_null(fs: PromisifiedFS, path: string) {
    try {
        return await fs.stat(path);
    } catch (e) {
        return null;
    }
}

// -----------------------------------------------------------------------------
export async function list_dir(fs: PromisifiedFS, dir: string): Promise<ListDir> {
    const dir_list = await fs.readdir(dir);
    const files: string[] = [];
    const dirs: string[] = [];
    for (const name of dir_list) {
        const file = path.join(dir, name);
        try {
            const stat = await fs.stat(file);
            if (stat.isFile()) {
                files.push(name);
            } else {
                dirs.push(name);
            }
        } catch(e) {
            throw new Error(`Internal: scaned file ${file} doesn't exist`);
        }
    }
    return { files, dirs };
}

const COLORS = {
    blue:   '#55f',
    green:  '#4d4',
    grey:   '#999',
    red:    '#A00',
    yellow: '#FF5',
    violet: '#a320ce',
    white:  '#fff',
    'persian-green': '#0aa'
} as const;

export type COLOR = keyof typeof COLORS;

function is_color(color: any): color is COLOR {
    return Object.hasOwn(COLORS, color);
}

export function color(name: string, string: string) {
    if (is_color(name)) {
        return '[[;' + COLORS[name] + ';]' + string + ']';
    } else {
        return string;
    }
}
