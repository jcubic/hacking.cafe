import type { PromisifiedFS } from '@isomorphic-git/lightning-fs';

export type { PromisifiedFS };

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
    [key: string]: Variable | undefined;
};

export type BashContext = {
    cwd: string;
    home: string;
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

export interface BashInterpreter {
    get home(): string;
    get cwd(): string;
    set cwd(dir: string);
    evaluate(code: string): TypeOrPromise<void>;
    command_exists(command: any): command is keyof Commands;
    exec(command: string, ...args: string[]): ReturnType<BashCommand>;
    variable(name: string): Variable | undefined | never;
    completion(command: string, type: Completion): TypeOrPromise<string[]>;
}

export enum Completion {
    File = "File",
    Directory = "Directory"
}
