import { parse } from 'unbash';
import path from 'path-browserify';

export type PromisifiedFS = typeof import('fs/promises');

import type {
    Statement,
    Command,
    Node,
    Word,
    Pipeline,
    WordPart,
    DoubleQuotedPart,
    DoubleQuotedChild,
    Redirect
} from 'unbash';

type PromiseOrType<T> = T | PromiseLike<T>;

export interface Stdout {
    output(): string;
    flush(): void;
    clear(): void;
    write(str: string): void;
    writeln(str: string): void;
}

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

class PipeOutput extends BufferOutput {
    get buffer() {
        return this._buffer;
    }
}

export interface Stdin {
    read(): TypeOrPromise<string>;
}

class PipeStdin implements Stdin {
    protected _buffer: string[];
    constructor(buffer: string[]) {
        this._buffer = buffer;
    }
    read() {
        return this._buffer.join('');
    }
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
    fs: PromisifiedFS;
    stdout: Stdout;
    stderr: Stdout;
    stdin: Stdin;
};

export class Bash {
    private _commands: Commands;
    private _env: Environment;
    private _context: BashContext;
    constructor(commands = {}, context: BashContext) {
        this._commands = commands;
        this._context = context;
        this._env = Object.create(null);
    }

    // -------------------------------------------------------------------------
    cwd() {
        return this._context.cwd;
    }

    // -------------------------------------------------------------------------
    command_exists(command: any): command is keyof Commands {
        return Object.hasOwn(this._commands, command);
    }

    // -------------------------------------------------------------------------
    exec(command: string, ...args: string[]): ReturnType<BashCommand> {
        return this._commands[command].apply(this._context, args);
    }

    // -------------------------------------------------------------------------
    variable(name: string) {
        if (Object.hasOwn(this._env, name)) {
            return this._env[name];
        }
        throw new Error(`Undefined variable ${name}`);
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
    resolve(ast: Word) {
        if (!ast.parts?.length) {
            return ast.value;
        }
        const [ part ] = ast.parts;
        return this.simple(part);
    }

    // -------------------------------------------------------------------------
    simple(ast: WordPart | DoubleQuotedChild) {
        switch (ast.type) {
            case 'DoubleQuoted':
                return this.quote(ast);
            case 'SingleQuoted':
            case 'Literal':
                return ast.value;
            case 'SimpleExpansion': {
                const value = ast.text;
                if (value.startsWith('$')) {
                    return this.variable(value);
                }
                break;
            }
            case 'ParameterExpansion': {
                if (ast.operator) {
                    throw new Error(`Unkown Bash substitution ${ast.text}`);
                }
                return this.variable(ast.parameter);
            }
            case 'CommandExpansion':
            case 'ArithmeticExpansion':
        }
        throw new Error(`Unkown Bash expression ${ast.text}`);
    }

    // -------------------------------------------------------------------------
    suffix(ast: Word[]) {
        const args = [];
        for (const suffix of ast) {
            args.push(this.resolve(suffix));
        }
        return args;
    }

    quote(ast: DoubleQuotedPart): string {
        return ast.parts.map(part => {
            return this.simple(part);
        }).join('');
    }

    // -------------------------------------------------------------------------
    async pipeline(ast: Pipeline) {
        const { stdin, stdout, stderr } = this._context;
        const commands = [...ast.commands];
        const output = new PipeOutput();
        this._context.stdout = output;
        while (commands.length > 1) {
            const command = commands.shift();
            await this.command(command as Command, true);
            this._context.stdin = new PipeStdin(output.buffer);
            output.flush();
        }
        Object.assign(this._context, { stdout, stderr });
        await this.command(commands.pop() as Command);
        this._context.stdin = stdin;
    }

    // -------------------------------------------------------------------------
    async command(ast: Command, pipe = false) {
        if (!ast.name) {
            if (ast.prefix.length) {
                const [ prefix ] = ast.prefix;
                if (prefix.type === 'Assignment' && prefix.value) {
                    this._env['$' + prefix.name] = this.resolve(prefix.value);
                }
            }
            return;
        }
        const command = this.resolve(ast.name);
        const args = this.suffix(ast.suffix) as string[];
        if (this.command_exists(command)) {
            await this.exec(command, ...args);

            if (ast.redirects.length) {
                for (const redirect of ast.redirects) {
                    await this.redirect(redirect);
                }
            }
            if (!pipe) {
                const { stdout, stderr } = this._context;
                stderr.flush();
                stdout.flush();
            }
        } else {
            throw new Error(`command '${command}' not found!`);
        }
    }

    // -------------------------------------------------------------------------
    statement(ast: Statement) {
        return this.dispatch(ast.command);
    }
}
