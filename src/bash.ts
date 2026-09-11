import { parse } from 'unbash';
import path from 'path-browserify';

export type PromisifiedFS = typeof import('fs/promises');

import type {
    Pipeline,
    Statement,
    Command,
    Node,
    Redirect
} from 'unbash';

type Suffix = Command['suffix'][0];

type PromiseOrType<T> = T | PromiseLike<T>;


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

export type Environment = {
    [key: string]: BashCommand;
};


export type BashContext = {
    cwd: string;
    fs: PromisifiedFS;
    stdout: Stdout;
    stderr: Stdout;
    stdin: Stdin;
};

export class Bash {
    private _env: Environment;
    private _context: BashContext;
    constructor(env = {}, context: BashContext) {
        this._env = env;
        this._context = context;
    }

    // -------------------------------------------------------------------------
    cwd() {
        return this._context.cwd;
    }

    // -------------------------------------------------------------------------
    command_exists(command: string) {
        return Object.hasOwn(this._env, command);
    }

    // -------------------------------------------------------------------------
    exec(command: string, ...args: string[]): ReturnType<BashCommand> {
        return this._env[command].apply(this._context, args);
    }

    // -------------------------------------------------------------------------
    async evaluate(code: string) {
        if (code.trim()) {
            const ast = parse(code);

            for (const command of ast.commands) {
                await this.dispatch(command);
            }
        }
    }

    // -------------------------------------------------------------------------
    dispatch(ast: Node): TypeOrPromise<void> {
        const type = ast.type.toLowerCase();
        const bash = this as unknown as Record<string, unknown>;
        if (typeof bash[type] === 'function') {
            return bash[type](ast);
        } else {
            throw new Error(`Unkown node '${type}'!`);
        }
    }

    // -------------------------------------------------------------------------
    pipeline(ast: Pipeline) {
        ast.commands;
        console.log(ast);
    }

    // -------------------------------------------------------------------------
    async redirect(ast: Redirect) {
        if (ast.target) {
            switch (ast.operator) {
                case '>': {
                    const { fs, stdout, stderr, cwd } = this._context;
                    const file = ast.target.value;
                    const fullname = path.resolve(cwd, file);
                    let content;
                    if (ast.fileDescriptor === 2) {
                        content = stderr.output();
                        stderr.clear();
                    } else {
                        content = stdout.output();
                        stdout.clear();
                    }
                    await fs.writeFile(fullname, content);
                    break;
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    suffix(ast: Suffix[]) {
        const args = [];
        for (const suffix of ast) {
            args.push(suffix.value);
        }
        return args;
    }

    // -------------------------------------------------------------------------
    async command(ast: Command) {
        if (!ast.name) {
            throw new Error('Invalid Command');
        }
        const command = ast.name.value;
        const args = this.suffix(ast.suffix);
        if (this.command_exists(command)) {
            await this.exec(command, ...args);

            if (ast.redirects.length) {
                for (const redirect of ast.redirects) {
                    await this.redirect(redirect);
                }
            }
            const { stdout, stderr } = this._context;
            stderr.flush();
            stdout.flush();
        } else {
            throw new Error(`command '${command}' not found!`);
        }
    }

    // -------------------------------------------------------------------------
    statement(ast: Statement) {
        return this.dispatch(ast.command);
    }
}
