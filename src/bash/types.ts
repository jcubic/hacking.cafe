/*
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
import type { PromisifiedFS } from '@isomorphic-git/lightning-fs';

export type { PromisifiedFS };

export type Stats = Awaited<ReturnType<PromisifiedFS['stat']>>;

export type PromiseOrType<T> = T | PromiseLike<T>;

export interface Stdout {
    output(): string;
    flush(): void;
    clear(): void;
    write(str: string): void;
    writeln(str: string): void;
}

export interface Stdin {
    read(): TypeOrPromise<string>;
}

export type BashCommand = (this: BashContext, ...args: string[]) =>
    PromiseOrType<void | number>;

export type Commands = {
    [key: string]: BashCommand;
};

export type Variable = string | string[] | {[key: string]: string};

export type Environment = {
    [key: string]: Variable;
};

export type BashContext = {
    cwd: string;
    home: string;
    user: string;
    host: string;
    bash: BashInterpreter;
    fs: PromisifiedFS;
    stdout: Stdout;
    stderr: Stdout;
    stdin: Stdin;
};

export type ListDir = {
    files: string[],
    dirs: string[]
};

export type UserData = {
    username: string;
    password: string;
    uid: number;
    gid: number;
    fullname: string;
    home: string;
    shell: string;
    text: string;
}

export interface BashInterpreter {
    get commands(): string[];
    get home(): string;
    get user(): string;
    get host(): string;
    get env(): Environment;
    get cwd(): string;
    set cwd(dir: string);
    fork(): BashInterpreter;
    init(): Promise<void>;
    users(): Promise<UserData[]>;
    executables(dir: string): Promise<string[]>;
    resolve_path(path: string): string;
    prompt(string: string): string;
    evaluate(code: string): TypeOrPromise<number>;
    command_exists(command: any): command is keyof Commands;
    exec(command: string, ...args: string[]): ReturnType<BashCommand>;
    variable(name: string): Variable | undefined | never;
    completion(command: string, type: Completion): TypeOrPromise<string[]>;
}

export enum Completion {
    File = "File",
    Directory = "Directory"
}
