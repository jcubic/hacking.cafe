/*
 *  Export types and main Bash class
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
import { parse } from 'unbash';
import path from 'path-browserify';

import type {
    If,
    Node,
    Word,
    AndOr,
    While,
    Script,
    Command,
    Redirect,
    Pipeline,
    WordPart,
    Statement,
    ParsedScript,
    CompoundList,
    DoubleQuotedPart,
    DoubleQuotedChild,
    ParameterExpansionPart
} from 'unbash';

type AstNode = Node | Script | ParsedScript;

import type {
    Stdout,
    Stdin,
    PromisifiedFS,
    Environment,
    Commands,
    BashContext,
    BashInterpreter,
    ListDir,
    UserData,
    Variable
} from './types';

import { fs_constants } from './constants';

import proceess_wrapper from './process.js?raw';

import * as builtins from './commands';

import { date, char, import_module, list_executables, glob_to_regex } from './utils';

export { color } from './utils';

import { Completion } from './types';

export { Completion };

export type { Stdout, Stdin, PromisifiedFS, Environment, Commands, BashContext, ListDir };

import { complete_file, complete_directory } from './completion';

/*
 * We need to use buffers in order to redirect them with pipes.
 * the command write to stdout when no pipes or last in pipe
 * the buffer are flushed.
 */
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

class SilientOutput extends BufferOutput {
    flush() { }
    clear() { }
}

/*
 * PipeOutput exposes internal buffer so it can be passed
 * to PipeStdin
 */
class PipeOutput extends BufferOutput {
    get buffer() {
        return this._buffer;
    }
}

/*
 * PipeStdin accept buffer from stdout as constructor
 * and return the content of that buffer when command reads the data
 */
class PipeStdin implements Stdin {
    protected _lines: string[];
    constructor(buff: string) {
        this._lines = buff.match(/.*?\n|.+$/g) || [];
    }
    read() {
        return this._lines.join('');
    }
    read_line() {
        if (!this._lines.length) {
            return null;
        }
        return this._lines.shift() as string;
    }
}

type Module = BashInterpreter | PromisifiedFS | Stdin | Stdout;

type ReplaceCallback = (pattern: string) => RegExp;


/*
 * Bash class is more like a Unix system
 *
 * TODO: separate bash parser from Unix like behavior
 *
 */
export class Bash implements BashInterpreter {
    // object containing builtin and user commands
    private _commands: Commands;
    // env contain variables defined in bash
    private _env: Environment;
    // context is object that is passed to builtin commands as this
    private _context: BashContext;
    // BroadcastChannel is used to access modules from inside web worker process
    private _channel: BroadcastChannel;
    // list of exposed modules for the webworker process
    private _modules: Record<string, () => Module>;
    private _shorcuts = {
        '.': 'source'
    } as const;
    // indicator to not flush the output in Command
    private _pipe: boolean;
    private _args: string[];
    private _name: string;
    constructor(commands = {}, context: Omit<BashContext, 'cwd' | 'bash'>) {
        this._commands = { ...builtins, ...commands };
        this._context = { cwd: context.home, bash: this, ...context };
        this._env = Object.create(null);
        this._channel = new BroadcastChannel('__ipc__');
        this._pipe = false;
        this._args = [];
        this._name = 'bash';
        this._modules = {
            fs: () => this.fs,
            bash: () => this,
            stdout: () => this._context.stdout,
            stderr: () => this._context.stderr,
            stdin: () => this._context.stdin,
            path: () => path as unknown as Module,
            '$.terminal': () => $.terminal as unknown as Module
        };
        this.init_ipc_channel();
    }

    // -------------------------------------------------------------------------
    get is_pipe() {
        return this._pipe;
    }
    // -------------------------------------------------------------------------

    get commands() {
        return Object.keys(this._commands);
    }

    // -------------------------------------------------------------------------
    get host() {
        return this._context.host;
    }

    // -------------------------------------------------------------------------
    get user() {
        return this._context.user;
    }

    // -------------------------------------------------------------------------
    get home() {
        return this._context.home;
    }

    // -------------------------------------------------------------------------
    get fs() {
        return this._context.fs;
    }

    // -------------------------------------------------------------------------
    // read only copy of internal env
    // -------------------------------------------------------------------------
    get env() {
        return Object.assign(Object.create(null), this._env);
    }

    // -------------------------------------------------------------------------
    get cwd() {
        return this._context.cwd;
    }
    set cwd(dir: string) {
        this._context.cwd = dir;
    }

    // -------------------------------------------------------------------------
    // hack to fix Vite dynamic module preloading
    // -------------------------------------------------------------------------
    private async _import(module: string) {
        return await import_module(`https://esm.sh/${module}`);
    }

    // -------------------------------------------------------------------------
    // spin a new Bash instance to run script as a new proccess, so environment
    // like variables are not modified by the script
    // -------------------------------------------------------------------------
    public fork() {
        const {
            stdout,
            stderr,
            stdin,
            fs,
            home,
            user,
            host
        } = this._context;
        const bash = new Bash(this._commands, {
            stdout,
            stderr,
            stdin,
            fs,
            user,
            host,
            home
        });
        // we need to inherit the state of parent bash
        // we set interal env using public read only getter
        bash._env = this.env;
        bash.cwd = this.cwd;
        return bash;
    }

    // -------------------------------------------------------------------------
    // we need to add aditional code to the worker scripts for them to work
    // -------------------------------------------------------------------------
    private process(code: string, args: string[] = []) {
        const _args = JSON.stringify(args)
        return proceess_wrapper.replace('{{ARGS}}', _args)
            .replace('{{CODE}}', code);
    }

    // -------------------------------------------------------------------------
    // boroadcast channel for communication with web worker scripts
    // it exposes modules via RPC-like mechanizm using Proxy objects
    // inside prefix scripts added by this._process() the modules
    // are accessed via require() helper. When user try to import a module
    // that doesn't exist it load it from dynamic import
    // -------------------------------------------------------------------------
    private init_ipc_channel() {
        this._channel.addEventListener('message', async (message) => {
            const { data } = message;
            const id = data.id;
            if (!data.namespace) {
                return;
            }
            try {
                let object: any;
                if (this._modules[data.namespace]) {
                    object = this._modules[data.namespace]();
                } else {
                    object = await this._import(data.namespace);
                    this._modules[data.namespace] = () => object;
                }
                let fn: any;
                if (!data.method) {
                    fn = object;
                } else if (typeof object[data.method] === 'function') {
                    fn = object[data.method].bind(object);
                }
                if (fn) {
                    const result = await fn(...data.args);
                    this._channel.postMessage({
                        id,
                        result
                    });
                } else {
                    throw new Error(`Invalid call ${data.namespace}::${data.method}`);
                }
            } catch (error) {
                this._channel.postMessage({
                    id,
                    error
                });
            }
        });
    }

    // -------------------------------------------------------------------------
    public resolve_path(pathname: string) {
        return path.resolve(this.cwd, pathname.replace(/^~/, this.home));
    }

    // -------------------------------------------------------------------------
    // run user defined script (a JavaScript code) from FS
    // the file always exist and is executable when this function is called
    // -------------------------------------------------------------------------
    private async exec_script(filename: string, ...args: string[]): Promise<number> {
        let file = await this.fs.readFile(filename, 'utf8');
        const re = /^#!(.+)\n/;
        const shebang = file.match(re);
        if (shebang) {
            const interpreter = shebang[1];
            file = file.replace(re, '');
            if (interpreter === '/bin/js') {
                const code = this.process(file, args);
                const blob = new Blob([code], {
                    type: 'application/javascript'
                });
                const worker = new Worker(URL.createObjectURL(blob), {
                    type: 'module'
                });
                return new Promise((resolve) => {
                    worker.addEventListener('message', message => {
                        if ('exit' in message.data) {
                            const code = message.data.exit;
                            resolve(code);
                        }
                    });
                });
            }
        }
        const bash = this.fork();
        const name = path.basename(filename);
        bash._name = name;
        bash._args = args;
        return bash.evaluate(file);
    }

    // -------------------------------------------------------------------------
    private async content(pathname: string) {
        try {
            return await this.fs.readFile(pathname, 'utf8');
        } catch(e) {
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // init should be called after setup() it initalize bash
    // -------------------------------------------------------------------------
    public async init() {
        const home = await this.content(`/home/${this.user}/.bashrc`);
        const etc = await this.content('/etc/bashrc');
        if (etc) {
            await this.evaluate(etc);
        }
        if (home) {
            await this.evaluate(home);
        }
    }

    // -------------------------------------------------------------------------
    public async users() {
        let passwd = await this.content('/etc/passwd');
        if (!passwd) {
            return [];
        }
        const result: UserData[] = [];
        for (const line of passwd.split('\n')) {
            const parts = line.split(':');
            if (parts.length === 7) {
                result.push({
                    username: parts[0],
                    password: parts[1],
                    uid: parseInt(parts[2]),
                    gid: parseInt(parts[3]),
                    fullname: parts[4],
                    home: parts[5],
                    shell: parts[6],
                    text: line
                } as const);
            }
        }
        return result;
    }

    // -------------------------------------------------------------------------
    // function parses bash prompt variable
    // -------------------------------------------------------------------------
    // example Ubuntu prompts:
    // PS1="\u@\h:\w\$ "
    // PS1="\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "
    // -------------------------------------------------------------------------
    prompt() {
        let prompt;
        try {
            prompt = this.get_variable('$PS1');
        } catch (e) {
            // ignore
        } finally {
            if (typeof prompt !== 'string') {
                prompt = '\\$ ';
            }
        }
        return prompt.replace(/\\([dhHjlstT@uvVwW!#nrea\\\[\]]|[0-7]{3})/g, (_, seq) => {
            if (seq.match(/^[0-7]+$/)) {
                return char(parseInt(seq, 8));
            }
            switch (seq[0]) {
                case '\\':
                    return '\\';
                case 's':
                    return 'bash';
                case '$':
                    // # for root
                    return '$';
                case '[':
                case ']':
                    return '';
                case 'e':
                    return char(0x1b);
                case 'd':
                    return date();
                case 'h':
                    return this.host;
                case 'w':
                    return this.cwd.replace(this.home, '~');
                case 'W':
                    if (this.cwd === this.home) {
                        return '~';
                    } else {
                        return path.basename(this.cwd);
                    }
                case 'u':
                    return this.user;
            }
            return seq;
        });
    }

    // -------------------------------------------------------------------------
    public executables(dir: string) {
        return list_executables(this.fs, dir);
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
        return Object.hasOwn(this._commands, command);
    }

    // -------------------------------------------------------------------------
    public shortcut_exists(command: any): command is keyof typeof this._shorcuts {
        return Object.hasOwn(this._shorcuts, command);
    }

    // -------------------------------------------------------------------------
    private async find_name(command: string): Promise<string | null> {
        try {
            const PATH = this.get_variable('$PATH') as string;
            const paths = PATH.split(':')
            try {
                const pathname = this.resolve_path(command);
                const stat = await this.fs.stat(pathname);
                if (stat.isFile()) {
                    // don't allow exec from cwd when cwd not in PATH
                    if (!command.match(/\//) && !paths.includes('.')) {
                        return null;
                    }
                    return pathname;
                }
            } catch(e) {
                // ignore
            }
            for (const search_path of paths) {
                const fullpath = this.resolve_path(search_path);
                const files = await this.fs.readdir(fullpath);
                if (files.includes(command)) {
                    return path.join(fullpath, command);
                }
            }
            return null;
        } catch(e) {
            // ignore invalid path
            return null;
        }
    }

    // -------------------------------------------------------------------------
    public async exec(command: string, ...args: string[]): Promise<number | void> {
        if (this.command_exists(command)) {
            return this._commands[command].apply(this._context, args);
        } else {
            const filename = await this.find_name(command as any);
            if (!filename) {
                throw new Error(`bash: ${command}: Command not found`);
            }
            const stat = await this.fs.stat(filename);
            if (!stat.isFile()) {
                throw new Error(`bash: ${command}: Command not found`);
            }
            const executable = fs_constants.S_IXUSR | fs_constants.S_IXGRP | fs_constants.S_IXOTH;
            if ((stat.mode & executable) === 0) {
                throw new Error(`bash: ${command}: Permission denied`);
            }
            let code;
            try {
                code = await this.exec_script(filename, ...args);
            } catch(e) {
                this._context.stderr.writeln((e as Error).message);
                return 1;
            }
            return code;
        }
    }

    // -------------------------------------------------------------------------
    public get_variable(name: string) {
        if (Object.hasOwn(this._env, name)) {
            return this._env[name];
        }
        if (name === '$0') {
            return this._name;
        }
        if (name === '$*') {
            return this._args.join(' ');
        }
        if (name === '$#') {
            return this._args.length.toString();
        }
        if (name.match(/\$[0-9]+/)) {
            const index = parseInt(name.substring(1), 10);
            return this._args[index - 1] ?? '';
        }
        throw new Error(`Undefined variable ${name}`);
    }

    // -------------------------------------------------------------------------
    public set_variable(name: string, value: Variable) {
        this._env[name] = value;
    }

    // -------------------------------------------------------------------------
    // main entry point for executing Bash code
    // -------------------------------------------------------------------------
    public async evaluate(code: string): Promise<number> {
        if (code.trim()) {
            const ast = parse(code);

            if (ast.errors) {
                const err = ast.errors[0];
                throw new Error(`${err.message} at ${err.pos}`);
            }
            return this.dispatch(ast);
        }
        return 0;
    }

    // -------------------------------------------------------------------------
    protected async Script(ast: Script | ParsedScript) {
        let result;
        for (const command of ast.commands) {
            result = await this.dispatch(command);
        }
        return result;
    }

    // -------------------------------------------------------------------------
    // main function used by evaluate to call dedicated method for a given
    // AST Node type
    // -------------------------------------------------------------------------
    protected async dispatch(ast: AstNode): Promise<number> {
        const bash = this as unknown as Record<string, unknown>;
        const type = ast.type as string;
        if (typeof bash[type] === 'function') {
            const result = await bash[type](ast);
            return typeof result === 'number' ? result : 0;
        }
        throw new Error(`Unkown node '${type}'!`);
    }

    // -------------------------------------------------------------------------
    // we split redirects becasue we have one method to handle all redirects
    // but input redirects need to be called before the command and output
    // redirect after the command
    // -------------------------------------------------------------------------
    protected split_redirects(ast: Command) {
        const input: Redirect[] = [];
        const output: Redirect[] = [];
        for (const redirect of ast.redirects) {
            if (redirect.target) {
                switch (redirect.operator) {
                    case '>':
                        output.push(redirect);
                        break;
                    case '<':
                        input.push(redirect);
                        break;
                }
            }
        }
        return [input, output];
    }

    // -------------------------------------------------------------------------
    // input direct must always call the callback that execute the comand
    // -------------------------------------------------------------------------
    protected async redirect(ast: Redirect, callback?: () => TypeOrPromise<void>) {
        if (ast.target) {
            switch (ast.operator) {
                case '>': {
                    const { fs, stdout, stderr } = this._context;
                    // TODO: resolve ast.target
                    const file = ast.target.value;
                    const fullname = this.resolve_path(file);
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
                case '<': {
                    const { fs, stdin } = this._context;
                    // TODO: resolve ast.target
                    const file = ast.target.value;
                    const fullname = this.resolve_path(file);
                    const content = await fs.readFile(fullname, 'utf8');
                    this._context.stdin = new PipeStdin(content);
                    if (callback) {
                        await callback();
                    }
                    this._context.stdin = stdin;
                    break;
                }
                default:
                    throw new Error(`Redirect ${ast.operator} not supported`);
            }
        }
    }

    // -------------------------------------------------------------------------
    protected async resolve(ast: Word): Promise<string> {
        if (!ast.parts?.length) {
            return ast.value;
        }
        const result = await Promise.all(ast.parts.map((part) => {
            return this.simple(part);
        }));
        return result.join('');
    }

    // -------------------------------------------------------------------------
    // method to parse expressions. It's double purpose for standalone
    // expressions and inside double quoted parts.
    // -------------------------------------------------------------------------
    protected async simple(ast: WordPart | DoubleQuotedChild) {
        switch (ast.type) {
            case 'DoubleQuoted':
                return this.quote(ast);
            case 'SingleQuoted':
            case 'Literal':
                return ast.value;
            case 'SimpleExpansion': {
                const value = ast.text;
                if (value.match(/\$@/)) {
                    return value;
                }
                if (value.startsWith('$')) {
                    return this.get_variable(value);
                }
                break;
            }
            case 'ParameterExpansion': {
                return this.expansion(ast);
            }
            case 'CommandExpansion':
                const bash = this.fork();
                const buffer = new SilientOutput();
                bash._context.stdout = buffer;
                if (ast.script) {
                    await bash.dispatch(ast.script);
                }
                return buffer.output().replace(/\n+$/, '');
            case 'ArithmeticExpansion':
        }
        throw new Error(`Unkown Bash expression ${ast.text}`);
    }

    // -------------------------------------------------------------------------
    protected async replace(ast: ParameterExpansionPart, callback: ReplaceCallback) {
        if (ast.replace) {
            const variable = this.get_variable('$' + ast.parameter);
            const repl = ast.replace;
            let pattern;
            if (!repl.pattern.parts) {
                pattern = callback(glob_to_regex(repl.pattern.value));
            } else {
                pattern = await this.resolve(repl.pattern);
            }
            const replacement = await this.resolve(repl.replacement);
            return variable.toString().replace(pattern, replacement);
        }
        return '';
    }

    // -------------------------------------------------------------------------
    // # / ## trim the shortest/longest matching PREFIX. Since the match is
    // anchored at position 0, the only thing that varies is how much the
    // pattern consumes, so a plain ^-anchored regex with a greedy/lazy
    // quantifier (from glob_to_regex) is enough.
    //
    // % / %% trim the shortest/longest matching SUFFIX. Here the match can
    // start anywhere, and a $-anchored regex with no ^ always finds the
    // *leftmost* start position that reaches the end - regardless of the
    // quantifier's greediness, since every starting '.' can be stretched to
    // the end anyway. That makes % (shortest suffix) behave like %% (longest
    // suffix) if we just flip the quantifier. Instead we test candidate
    // suffix lengths directly - shortest-first for %, longest-first for %% -
    // against a fully ^...$ anchored pattern, where greedy vs lazy no longer
    // matters because the whole candidate has to match either way.
    // -------------------------------------------------------------------------
    protected async trim(ast: ParameterExpansionPart, front: boolean, greedy: boolean) {
        if (ast.operand) {
            const variable = this.get_variable('$' + ast.parameter);
            const string = variable.toString();
            let pattern;
            if (!ast.operand.parts) {
                pattern = glob_to_regex(ast.operand.value, greedy);
            } else {
                pattern = await this.resolve(ast.operand);
            }
            if (front) {
                return string.replace(new RegExp('^' + pattern), '');
            }
            const re = new RegExp('^' + pattern + '$');
            for (let i = 0; i <= string.length; i++) {
                const len = greedy ? string.length - i : i;
                const suffix = string.slice(string.length - len);
                if (re.test(suffix)) {
                    return string.slice(0, string.length - len);
                }
            }
            return string;
        }
        return '';
    }

    // -------------------------------------------------------------------------
    protected async use_default(ast: ParameterExpansionPart, strict: boolean, set = false) {
        if (ast.operand) {
            let variable;
            try {
                variable = this.get_variable('$' + ast.parameter);
                if (strict && !variable) {
                    return '';
                }
            } catch(e) {
                // ignore
            }
            if (ast.operand && !variable) {
                const value = await this.resolve(ast.operand);
                if (set) {
                    this.set_variable('$' + ast.parameter, value);
                }
                return value;
            }
        }
        return '';
    }

    // -------------------------------------------------------------------------
    protected async use_alternative(ast: ParameterExpansionPart, strict: boolean) {
        if (ast.operand) {
            try {
                const variable = this.get_variable('$' + ast.parameter);
                if (!variable && !strict) {
                    return '';
                }
                if (ast.operand) {
                    return await this.resolve(ast.operand);
                }
            } catch(e) {
                // ignore
            }
        }
        return '';
    }

    // -------------------------------------------------------------------------
    protected async show_error(ast: ParameterExpansionPart, strict: boolean) {
        if (ast.operator) {
            try {
                const variable = this.get_variable('$' + ast.parameter);
                if (!variable && !strict) {
                    throw new Error();
                }
                return variable;
            } catch(e) {
                if (ast.operand) {
                    const err = await this.resolve(ast.operand);
                    throw new Error(err || 'bash: var: parameter null or not set');
                }
            }
        }
        return '';
    }

    // -------------------------------------------------------------------------
    protected async expansion(ast: ParameterExpansionPart) {
        if (ast.operator) {
            switch (ast.operator) {
                case '/':
                    return this.replace(ast, (pattern) => {
                        return new RegExp(pattern);
                    });
                case '//':
                    return this.replace(ast, (pattern) => {
                        return new RegExp(pattern, 'g');
                    });
                case '#':
                    return this.trim(ast, true, false);
                case '##':
                    return this.trim(ast, true, true);
                case '%':
                    return this.trim(ast, false, false);
                case '%%':
                    return this.trim(ast, false, true);
                case '-':
                    return this.use_default(ast, true);
                case ':-':
                    return this.use_default(ast, false);
                case '=':
                    return this.use_default(ast, true, true);
                case ':=':
                    return this.use_default(ast, false, true);
                case '+':
                    return this.use_alternative(ast, true);
                case ':+':
                    return this.use_alternative(ast, false);
                case '?':
                    return this.show_error(ast, true);
                case ':?':
                    return this.show_error(ast, false);
                case '^': {
                    const variable = this.get_variable('$' + ast.parameter).toString();
                    return variable[0].toUpperCase() + variable.substring(1);
                }
                case '^^': {
                    const variable = this.get_variable('$' + ast.parameter).toString();
                    return variable.toUpperCase();
                }
            }
            throw new Error(`Unkown Bash substitution ${ast.text}`);
        }
        const variable = this.get_variable('$' + ast.parameter);
        if (ast.length) {
            return variable.length;
        }
        if (ast.indirect) {
            return this.get_variable('$' + variable);
        }
        if (ast.slice) {
            const offset = parseInt(await this.resolve(ast.slice.offset), 10);
            const length = ast.slice.length ?
                parseInt(await this.resolve(ast.slice.length), 10) + offset:
                undefined;
            return variable.toString().substring(offset, length);
        }
        return variable;
    }

    // -------------------------------------------------------------------------
    protected async words(ast: Word[]) {
        const args = [];
        for (const arg of ast) {
            args.push(await this.resolve(arg));
        }
        return args;
    }

    // -------------------------------------------------------------------------
    protected async quote(ast: DoubleQuotedPart): Promise<string> {
        const string = await Promise.all(ast.parts.map(part => {
            return this.simple(part);
        }));
        return string.join('');
    }

    // -------------------------------------------------------------------------
    // swap stdin and stdout for the pipeline. Pipes are not line oriented
    // like in Unix, they process whole input and then call next command
    // in the pipe. This is handled by the Buffered Output and buffer swaping
    // by PipeInput/Output class. Pipeline run in the subshell.
    // -------------------------------------------------------------------------
    protected async Pipeline(ast: Pipeline) {
        const bash = this.fork();
        const { stdin, stdout, stderr } = bash._context;
        const output = new PipeOutput();
        const commands = [...ast.commands];
        bash._context.stdout = output;
        bash._pipe = true;
        while (commands.length > 1) {
            const command = commands.shift() as Node;
            await bash.dispatch(command);
            bash._context.stdin = new PipeStdin(output.output());
            output.flush();
        }
        Object.assign(bash._context, { stdout, stderr });
        bash._pipe = false;
        await bash.dispatch(commands.pop() as Node);
        bash._context.stdin = stdin;
    }

    // -------------------------------------------------------------------------
    // argument wrapper that resolve special bash $@ operator
    // -------------------------------------------------------------------------
    protected async args(ast: Command) {
        const args = await this.words(ast.suffix);
        return args.reduce((result: string[], item: Variable) => {
            item = item.toString();
            if (item.match(/\$@/)) {
                if (item === '$@') {
                    return result.concat(this._args);
                }
                const [prefix, suffix] = item.split('$@');
                if (this._args.length <= 1) {
                    result.push(prefix + (this._args[0] ?? '') + suffix);
                    return result;
                } else {
                    const first = prefix + this._args[0];
                    const last = this._args.at(-1) + suffix;
                    const rest = this._args.slice(1, -1);
                    return result.concat([first], rest, [last]);
                }
            }
            result.push(item);
            return result;
        }, []);
    }

    // -------------------------------------------------------------------------
    // command can be a user script (from fs) or builtin command
    // -------------------------------------------------------------------------
    protected async Command(ast: Command) {
        if (!ast.name) {
            if (ast.prefix.length) {
                const [ prefix ] = ast.prefix;
                if (prefix.type === 'Assignment' && prefix.value) {
                    const value = await this.resolve(prefix.value);
                    this.set_variable('$' + prefix.name, value);
                }
            }
            return;
        }
        let command = await this.resolve(ast.name);
        if (this.shortcut_exists(command)) {
            command = this._shorcuts[command];
        }
        if (typeof command !== 'string') {
            throw new Error(`Invalid value '${ast.name}'`);
        }
        const args = await this.args(ast);
        if (command === '[') {
            if (args.at(-1) !== ']') {
                throw new Error("bash: [: missing `]'");
            }
            args.pop();
            command = 'test';
        }
        const [input_redir, output_redir] = this.split_redirects(ast);
        let code;
        const { stdout, stderr } = this._context;
        if (input_redir.length) {
            for (const redirect of input_redir) {
                await this.redirect(redirect, async () => {
                    code = await this.exec(command, ...args);
                });
            }
        } else {
            if (output_redir.length) {
                this._context.stdout = new SilientOutput();
                this._context.stderr = new SilientOutput();
            }
            code = await this.exec(command, ...args);
        }
        if (output_redir.length) {
            for (const redirect of output_redir) {
                await this.redirect(redirect);
            }
            this._context.stderr = stderr;
            this._context.stdout = stdout;
        }
        if (!this._pipe) {
            const { stdout, stderr } = this._context;
            stderr.flush();
            stdout.flush();
        }
        return code;
    }

    // -------------------------------------------------------------------------
    protected async While(ast: While) {
        const cond = ast.kind === 'while' ?
            (clause: number) => clause !== 0 :
        (clause: number) => clause === 0;
        let result;
        while (true) {
            const clause = await this.dispatch(ast.clause);
            if (cond(clause)) {
                break;
            }
            result = await this.dispatch(ast.body);
        }
        return result;
    }

    // -------------------------------------------------------------------------
    protected async AndOr(ast: AndOr) {
        let code;
        for (let i=0; i < ast.commands.length; ++i) {
            const command = ast.commands[i];
            code = await this.Command(command as Command);
            if (ast.operators[i]) {
                const op = ast.operators[i];
                if (op === '&&') {
                    if (code !== 0) {
                        break;
                    }
                } else if (op === '||') {
                    if (code !== 1) {
                        break;
                    }
                }
            }
        }
        return code;
    }

    // -------------------------------------------------------------------------
    protected async CompoundList(ast: CompoundList) {
        let code;
        for (const statement of ast.commands) {
            code = await this.dispatch(statement);
        }
        return code;
    }

    // -------------------------------------------------------------------------
    protected async If(ast: If) {
        const test = await this.dispatch(ast.clause) as number;
        if (test === 0) {
            if (ast.then) {
                return await this.dispatch(ast.then)
            }
        } else if (ast.else) {
            await this.dispatch(ast.else);
        }
    }

    // -------------------------------------------------------------------------
    protected Statement(ast: Statement) {
        return this.dispatch(ast.command);
    }
}
