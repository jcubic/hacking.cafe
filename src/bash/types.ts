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
    read_line(): TypeOrPromise<string | null>;
}

export type BashCommand = (this: BashContext, ...args: string[]) =>
    PromiseOrType<void | number>;

export type Commands = {
    [key: string]: BashCommand;
};

export type Variable = string | string[];

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

export type Module = () => unknown;
export type Modules = Record<string, Module>

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

type ProcessData = {
    name: string;
    path: string;
    pid: number;
};

export interface BashInterpreter {
    get commands(): string[];
    get is_pipe(): boolean;
    get home(): string;
    get user(): string;
    get host(): string;
    get version(): string;
    get env(): Environment;
    get cwd(): string;
    set cwd(dir: string);
    get procs(): ProcessData[];
    init(): Promise<void>;
    // create a copy of Bash you always need to call remove_process to clean up
    fork(): BashInterpreter;
    // clean up after the process is killed
    remove_process(pid: number): void;
    kill(pid: number): Promise<void>;
    users(): Promise<UserData[]>;
    // return array of executable scripts from filesystem
    executables(dir: string): Promise<string[]>;
    // resolve path using $CWD and $PATH
    resolve_path(path: string): string;
    // read and intepret bash prompt from PS1
    prompt(string: string): string;
    // evaluate bash code
    evaluate(code: string): TypeOrPromise<number>;
    command_exists(command: any): command is keyof Commands;
    // execute a command or a file. The filename needs to be absolute path
    exec(command: string, ...args: string[]): Promise<number>;
    // execute JavaScript file as a web worker process
    exec_js(filename: string, code: string, args: string[]): Promise<number>;
    // execute bash code from a file as a different bash process
    exec_bash(filename: string, code: string, args: string[]): Promise<number>;
    get_variable(name: string): Variable;
    set_variable(name: string, value: Variable): void;
    completion(command: string, type: Completion): TypeOrPromise<string[]>;
}

export enum Completion {
    File = "File",
    Directory = "Directory"
}
