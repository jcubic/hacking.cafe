import { parse } from 'unbash';
import path from 'path-browserify';

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

import type {
    Stdout,
    Stdin,
    PromisifiedFS,
    Environment,
    Commands,
    BashCommand,
    BashContext,
    BashInterpreter,
    ListDir
} from './types';

import * as builtins from './commands';

export { color } from './utils';

import { Completion } from './types';

export { Completion };

export type { Stdout, Stdin, PromisifiedFS, Environment, Commands, BashContext, ListDir };

import { complete_file, complete_directory } from './completion';

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

class PipeStdin implements Stdin {
    protected _buffer: string[];
    constructor(buffer: string[]) {
        this._buffer = buffer;
    }
    read() {
        return this._buffer.join('');
    }
}

export class Bash implements BashInterpreter {
    private _commands: Commands;
    private _env: Environment;
    private _context: BashContext;
    constructor(commands = {}, context: Omit<BashContext, 'cwd' | 'bash'>) {
        this._commands = {...builtins, ...commands}
        this._context = { cwd: context.home, bash: this, ...context };
        this._env = Object.create(null);
    }

    // -------------------------------------------------------------------------
    get home() {
        return this._context.home;
    }

    // -------------------------------------------------------------------------
    get cwd() {
        return this._context.cwd;
    }
    set cwd(dir: string) {
        this._context.cwd = dir;
    }

    // -------------------------------------------------------------------------
    public completion(command: string, type: Completion): TypeOrPromise<string[]> {
        switch (type) {
            case Completion.File:
                return complete_file(this._context, command);
            case Completion.Directory:
                return complete_directory(this._context, command);
        }
        return [];
    }
    // -------------------------------------------------------------------------
    public command_exists(command: any): command is keyof Commands {
        console.log({command});
        console.log(this._commands[command]);
        console.log(this._commands);
        return Object.hasOwn(this._commands, command);
    }

    // -------------------------------------------------------------------------
    public exec(command: string, ...args: string[]): ReturnType<BashCommand> {
        return this._commands[command].apply(this._context, args);
    }

    // -------------------------------------------------------------------------
    public variable(name: string) {
        if (Object.hasOwn(this._env, name)) {
            return this._env[name];
        }
        throw new Error(`Undefined variable ${name}`);
    }

    // -------------------------------------------------------------------------
    public async evaluate(code: string) {
        if (code.trim()) {
            const ast = parse(code);

            for (const command of ast.commands) {
                await this.dispatch(command);
            }
        }
    }

    // -------------------------------------------------------------------------
    protected dispatch(ast: Node): TypeOrPromise<void> {
        const type = ast.type.toLowerCase();
        const bash = this as unknown as Record<string, unknown>;
        if (typeof bash[type] === 'function') {
            return bash[type](ast);
        } else {
            throw new Error(`Unkown node '${type}'!`);
        }
    }

    // -------------------------------------------------------------------------
    protected async redirect(ast: Redirect) {
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
    protected resolve(ast: Word) {
        if (!ast.parts?.length) {
            return ast.value;
        }
        const [ part ] = ast.parts;
        return this.simple(part);
    }

    // -------------------------------------------------------------------------
    protected simple(ast: WordPart | DoubleQuotedChild) {
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
    protected suffix(ast: Word[]) {
        const args = [];
        for (const suffix of ast) {
            args.push(this.resolve(suffix));
        }
        return args;
    }

    // -------------------------------------------------------------------------
    protected quote(ast: DoubleQuotedPart): string {
        return ast.parts.map(part => {
            return this.simple(part);
        }).join('');
    }

    // -------------------------------------------------------------------------
    protected async pipeline(ast: Pipeline) {
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
    protected async command(ast: Command, pipe = false) {
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
    protected statement(ast: Statement) {
        return this.dispatch(ast.command);
    }
}
