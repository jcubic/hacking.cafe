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
import parse_options from '@jcubic/lily';
import { Host } from '@jcubic/mitty';

import type {
    If,
    Node,
    Word,
    Case,
    AndOr,
    While,
    Script,
    Command,
    Redirect,
    Pipeline,
    Subshell,
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
    Variable,
    Module,
    Modules
} from './types';

import { fs_constants } from './constants';

import proceess_wrapper from './process.js?raw';

import { version } from '~/package.json';

import * as builtins from './commands';

import {
    date,
    char,
    Exit,
    Signal,
    glob_to_regex,
    import_module,
    list_executables
} from './utils';

export { color } from './utils';

import { Completion } from './types';

export { Completion, Signal, Exit };

export type {
    Stdin,
    Module,
    Stdout,
    Modules,
    ListDir,
    Commands,
    BashContext,
    Environment,
    PromisifiedFS
};

import { complete_file, complete_directory } from './completion';
import { BufferOutput, PipeOutput, PipeStdin, SilientOutput } from './io';

export { BufferOutput };

type ReplaceCallback = (pattern: string) => RegExp;

interface Process {
    get pid(): number;
    terminate(code?: number): void;
    get name(): string;
}

class WorkerProcess implements Process {
    private _pid: number;
    private _worker: Worker;
    private _name: string;
    private _channel: BroadcastChannel;
    private _host: Host;
    constructor(
        pid: number,
        name: string,
        worker: Worker,
        channel: BroadcastChannel,
        host: Host
    ) {
        this._pid = pid;
        this._worker = worker;
        this._name = name;
        this._channel = channel;
        this._host = host;
    }
    public terminate() {
        this._worker.terminate();
        this.close();
    }
    // called when the worker already exited on its own - the worker itself is
    // already gone, but the IPC channel and every handle the host still holds
    // on its behalf have to be dropped
    public close() {
        this._host.close();
        this._channel.close();
    }
    get name() {
        return this._name;
    }
    get pid() {
        return this._pid;
    }
}

export class Bash implements BashInterpreter, Process {
    // object containing builtin and user commands
    private _commands: Commands;
    // globals are variables with export
    private _globals: Environment;
    // locals are without
    private _locals: Environment;
    // temporary variables for new process
    private _tmp_env: Environment;
    // context is object that is passed to builtin commands as this
    private _context: BashContext;
    // list of exposed modules for the webworker process
    private _modules: Modules;
    private _shorcuts = {
        '.': 'source',
        ':': 'true'
    } as const;
    // indicator to not flush the output in Command
    private _pipe: boolean;
    private _export: boolean;
    private _tmp: boolean;
    private _args: string[];
    private _name: string;
    private _PID: number;
    // modules passed by the host application (e.g. jQuery Terminal specific
    // ones); kept around so fork() can hand them to the child instance
    private _extra_modules: Modules;
    private static _procs: Process[] = [];
    constructor(
        commands = {},
        context: Omit<BashContext, 'cwd' | 'bash'>,
        modules: Modules = {}
    ) {
        this._commands = { ...builtins, ...commands };
        this._context = { ...context, cwd: context.home, bash: this };
        this._globals = Object.create(null);
        this._locals = Object.create(null);
        this._tmp_env = Object.create(null);
        this._pipe = this._export = this._tmp = false;
        this._args = [];
        this._name = '/bin/bash';
        this._PID = this.next_pid;
        this._extra_modules = modules;
        Bash._procs.push(this);
        this._modules = {
            fs: () => this.fs,
            bash: () => this,
            stdout: () => this._context.stdout,
            stderr: () => this._context.stderr,
            stdin: () => this._context.stdin,
            path: () => path,
            ...modules
        };
    }

    // -------------------------------------------------------------------------
    get procs() {
        return Bash._procs.map((proc: Process) => {
            const { name, pid } = proc;
            return {
                name: path.basename(name),
                path: name,
                pid
            };
        });
    }

    // -------------------------------------------------------------------------
    private get next_pid() {
        if (!Bash._procs.length) {
            return 0;
        }
        const last = Bash._procs.at(-1) as Process;
        return last.pid + 1;
    }

    // -------------------------------------------------------------------------
    get name() {
        return this._name;
    }

    // -------------------------------------------------------------------------
    get pid() {
        return this._PID;
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
    protected get temp_vars() {
        return this._tmp_env;
    }

    // -------------------------------------------------------------------------
    get version() {
        return version;
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
        return Object.assign(Object.create(null), this._globals);
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
    // each time you call fork you need to us finally with Bash::remove_process()
    // ```javascript
    // bash.fork();
    // try {
    //   ...
    // } finally {
    //   bash.remove_proceess(bash.pid);
    // }
    // -------------------------------------------------------------------------
    public fork() {
        // use the concrete (sub)class so overrides like serialize/unserialize
        // and any host-provided modules survive the fork
        const Ctor = this.constructor as typeof Bash;
        const bash = new Ctor(this._commands, this._context, this._extra_modules);
        // we need to inherit the state of parent bash
        // we set interal env using public read only getter
        bash._globals = this.env;
        bash.cwd = this.cwd;
        return bash;
    }

    // -------------------------------------------------------------------------
    public async kill(pid: number, code: number = Signal.SIGTERM) {
        if (pid === 0) {
            throw new Error(`bash: kill: you can't kill \`${pid}' process`);
        }
        for (const [index, process] of Object.entries(Bash._procs)) {
            if (process.pid == pid) {
                try {
                    await process.terminate(code);
                } finally {
                    Bash._procs.splice(parseInt(index), 1);
                }
                return;
            }
        }
        throw new Error(`bash: kill: \`${pid}': not a pid`);
    }

    // -------------------------------------------------------------------------
    public terminate(code: number = Signal.SIGTERM) {
        this.remove_process(this.pid);
        throw new Signal(code);
    }

    // -------------------------------------------------------------------------
    // we need to add aditional code to the worker scripts for them to work
    // -------------------------------------------------------------------------
    private process(code: string, args: string[], pid: number) {
        const _args = JSON.stringify(args)
        // the worker runs from a blob: URL, whose path is opaque - nothing
        // relative resolves against it, so mitty has to be named absolutely
        const mitty = new URL('/mitty.js', location.href).href;
        // replacement must be a function - a string replacement would have
        // "$"-sequences in `code` (e.g. require('$') for the jQuery module)
        // interpreted as special patterns like $&/$'/$`, corrupting the output
        return proceess_wrapper.replace('{{ARGS}}', () => _args)
            .replace('{{PID}}', () => JSON.stringify(pid))
            .replace('{{MITTY}}', () => mitty)
            .replace('{{CODE}}', () => code);
    }

    // -------------------------------------------------------------------------
    // mitty Host for one worker: it listens on the worker's channel and
    // resolves the chains of property accesses and calls that require()
    // records on the other side.
    //
    // each spawned worker gets its own dedicated channel (see exec_js) so
    // that nested/concurrent workers never share a channel name - if they
    // did, their independent RPC id counters could collide and responses
    // would be delivered to the wrong pending call
    // -------------------------------------------------------------------------
    private create_host(channel: BroadcastChannel) {
        return new Host({
            channel,
            resolve: (value) => this.resolve_module(value)
        });
    }

    // -------------------------------------------------------------------------
    // a module is either one this shell exposes or, failing that, whatever a
    // dynamic import of the name yields - cached either way, so a script that
    // requires the same module twice only pays for it once
    // -------------------------------------------------------------------------
    private async resolve_module(name: string) {
        if (this._modules[name]) {
            return this._modules[name]();
        }
        const module = await this._import(name);
        this._modules[name] = () => module;
        return module;
    }

    // -------------------------------------------------------------------------
    public resolve_path(pathname: string) {
        return path.resolve(this.cwd, pathname.replace(/^~/, this.home));
    }

    // -------------------------------------------------------------------------
    public exec_js(filename: string, file: string, args: string[]) {
        // remove the shebang becasue this public API
        file = file.replace(/^#!(.+)\n/, '');
        // validate the syntax before anything is allocated for the process:
        // a channel opened here and abandoned would keep answering on a name
        // the next process gets handed, since pids are reused
        new Function(file);
        const pid = this.next_pid;
        // every worker (even one spawned by another worker calling back into
        // bash.exec_js, e.g. /bin/js launching the script it interprets)
        // gets its own channel keyed by its own pid, so independent RPC id
        // counters from concurrent/nested workers never collide
        const channel = new BroadcastChannel(`__ipc__:${pid}`);
        const host = this.create_host(channel);
        const code = this.process(file, args, pid);
        const blob = new Blob([code], {
            type: 'application/javascript'
        });
        const worker = new Worker(URL.createObjectURL(blob));
        Bash._procs.push(new WorkerProcess(pid, filename, worker, channel, host));
        return new Promise<number>((resolve) => {
            worker.addEventListener('message', message => {
                if ('exit' in message.data) {
                    const code = message.data.exit;
                    this.remove_process(pid);
                    resolve(code);
                }
            });
        });
    }

    // -------------------------------------------------------------------------
    public async exec_bash(filename: string, file: string, args: string[]) {
        const bash = this.fork();
        try {
            Object.assign(bash._globals, this._tmp_env);
            bash._name = filename;
            bash._args = args;
            const code = await bash.evaluate(file);
            return code;
        } catch(e) {
            // `exit` unwinds the whole script, and the status it names is what
            // the script reports to whoever ran it
            if (e instanceof Exit) {
                return e.code;
            }
            throw e;
        } finally {
            this.remove_process(bash.pid);
        }
    }

    // -------------------------------------------------------------------------
    public remove_process(pid: number) {
        Bash._procs = Bash._procs.filter(proc => {
            if (proc.pid !== pid) {
                return true;
            }
            // pids get recycled (next_pid reuses the gap left by a removed
            // process), so a worker's channel must be closed here -
            // otherwise a later worker created with the same pid would
            // share its channel name with this now-abandoned listener
            if (proc instanceof WorkerProcess) {
                proc.close();
            }
            return false;
        });
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
            file = file.replace(/^#!(.+)\n/, '');
            let executable = false;
            try {
                executable = await this.is_executable(interpreter);
            } catch(e) {
                // there is no such file - reported below like any other
                // interpreter that cannot be run
            }
            if (!executable) {
                const msg = `bash: ${filename}: ${interpreter}: bad interpreter: No such file or directory`;
                throw new Error(msg);
            }
            file = await this.fs.readFile(interpreter, 'utf8');
            return this.exec_js(interpreter, file, [filename, ...args]);
        }
        return this.exec_bash(filename, file, args);
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
        const prompt = this.get_variable('PS1') as string;
        return prompt.replace(/\\([dhHjlstT@uvVwW!$#nrea\\\[\]]|[0-7]{3})/g, (_, seq) => {
            if (seq.match(/^[0-7]+$/)) {
                return char(parseInt(seq, 8));
            }
            switch (seq[0]) {
                case '\\':
                    return '\\';
                case 's':
                    return path.basename(this.name);
                case 'v':
                    return this.version;
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
            const PATH = this.get_variable('PATH') as string;
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
    private async is_executable(filename: string) {
        const stat = await this.fs.stat(filename);
        if (!stat.isFile()) {
            throw new Error(`bash: ${filename}: not found`);
        }
        const executable = fs_constants.S_IXUSR |
            fs_constants.S_IXGRP |
            fs_constants.S_IXOTH;
        return (stat.mode & executable) !== 0;
    }

    // -------------------------------------------------------------------------
    private async find_executable(command: string): Promise<string> {
        const filename = await this.find_name(command);
        if (!filename) {
            throw new Error(`bash: ${command}: Command not found`);
        }
        let executable;
        try {
            executable = await this.is_executable(filename);
        } catch(e) {
            throw new Error(`bash: ${command}: not found`);
        }
        if (!executable) {
            throw new Error(`bash: ${command}: Permission denied`);
        }
        return filename;
    }

    // -------------------------------------------------------------------------
    public async exec(command: string, ...args: string[]): Promise<number> {
        if (this.command_exists(command)) {
            const fn = this._commands[command];
            const code = await fn.apply(this._context, args);
            if (typeof code === 'number') {
                return code;
            }
            return 0;
        } else {
            const filename = await this.find_executable(command);
            return await this.exec_script(filename, ...args);
        }
    }

    // -------------------------------------------------------------------------
    public get_variable(name: string): Variable {
        if (Object.hasOwn(this._locals, name)) {
            return this._locals[name];
        }
        if (Object.hasOwn(this._globals, name)) {
            return this._globals[name];
        }
        switch (name) {
            case 'PS1':
                return '\\s-\\v\\$ ';
            case 'HOSTNAME':
                return this._context.host;
            case 'USER':
                return this._context.user;
            case 'IFS':
                return ' \\t\\n';
            case 'PWD':
                return this.cwd;
            case '0':
                return path.basename(this._name);
            case '*':
                return this._args.join(' ');
            case '#':
                return this._args.length.toString();
        }
        if (name.match(/^[0-9]+/)) {
            const index = parseInt(name, 10);
            return this._args[index - 1] ?? '';
        }
        return '';
    }

    // -------------------------------------------------------------------------
    public set_variable(name: string, value: Variable) {
        if (this._tmp) {
            this._tmp_env[name] = value;
        } else if (this._export) {
            this._globals[name] = value;
        } else {
            this._locals[name] = value;
        }
    }

    // -------------------------------------------------------------------------
    protected async with_export_vars(callback: () => TypeOrPromise<void>) {
        this._export = true;
        await callback();
        this._export = false;
    }

    // -------------------------------------------------------------------------
    protected async with_temp_vars(callback: () => TypeOrPromise<void>) {
        this._tmp = true;
        await callback();
        this._tmp = false;
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
                    case '>>':
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
            switch (ast.operator[0]) {
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
                    if (ast.operator === '>>') {
                        // appending to a file that is not there yet creates it
                        const file = await this.content(fullname);
                        content = (file ?? '') + content;
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
    protected async parts(ast: WordPart[]): Promise<Variable[]> {
        return Promise.all(ast.map((part) => {
            return this.simple(part);
        }));
    }

    // -------------------------------------------------------------------------
    protected async resolve(ast: Word): Promise<string> {
        if (!ast.parts?.length) {
            return ast.value;
        }
        const result = await this.parts(ast.parts);
        // arrays are resolved to the first element
        return result.map(part => {
            if (Array.isArray(part)) {
                return part[0];
            }
            return part;
        }).join('');
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
                    return this.get_variable(value.substring(1));
                }
                break;
            }
            case 'ParameterExpansion': {
                return this.expansion(ast);
            }
            case 'CommandExpansion':
                const bash = this.fork();
                try {
                    const buffer = new SilientOutput();
                    bash._context.stdout = buffer;
                    if (ast.script) {
                        await bash.dispatch(ast.script);
                    }
                    return buffer.output().replace(/\n+$/, '');
                } finally {
                    this.remove_process(bash.pid);
                }
            case 'ArithmeticExpansion':
        }
        throw new Error(`Unkown Bash expression ${ast.text}`);
    }

    // -------------------------------------------------------------------------
    protected async replace(ast: ParameterExpansionPart, callback: ReplaceCallback) {
        if (ast.replace) {
            const variable = this.get_variable(ast.parameter);
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
            const variable = this.get_variable(ast.parameter);
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
    // ${var-word} / ${var:-word} and ${var=word} / ${var:=word}
    //
    // Bash tells an unset variable from one set to the empty string, and the
    // colon is what asks for the second to count as well. This shell keeps no
    // such distinction - get_variable() answers '' for a name it has never
    // seen - so both spellings of each operator do the same thing here
    // -------------------------------------------------------------------------
    protected async use_default(ast: ParameterExpansionPart, set = false) {
        const variable = this.get_variable(ast.parameter);
        if (variable.length) {
            return variable;
        }
        if (!ast.operand) {
            return '';
        }
        const value = await this.resolve(ast.operand);
        if (set) {
            this.set_variable(ast.parameter, value);
        }
        return value;
    }

    // -------------------------------------------------------------------------
    // ${var+word} / ${var:+word} - the mirror image: the word is used only
    // when the variable has a value of its own
    // -------------------------------------------------------------------------
    protected async use_alternative(ast: ParameterExpansionPart) {
        const variable = this.get_variable(ast.parameter);
        if (!variable.length || !ast.operand) {
            return '';
        }
        return await this.resolve(ast.operand);
    }

    // -------------------------------------------------------------------------
    // ${var?word} / ${var:?word}
    // -------------------------------------------------------------------------
    protected async show_error(ast: ParameterExpansionPart) {
        const variable = this.get_variable(ast.parameter);
        if (variable.length) {
            return variable;
        }
        const message = ast.operand ? await this.resolve(ast.operand) : '';
        throw new Error(message || `bash: ${ast.parameter}: parameter null or not set`);
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
                case ':-':
                    return this.use_default(ast);
                case '=':
                case ':=':
                    return this.use_default(ast, true);
                case '+':
                case ':+':
                    return this.use_alternative(ast);
                case '?':
                case ':?':
                    return this.show_error(ast);
                case '^': {
                    const variable = this.get_variable(ast.parameter).toString();
                    if (!variable) {
                        return '';
                    }
                    return variable[0].toUpperCase() + variable.substring(1);
                }
                case '^^': {
                    const variable = this.get_variable(ast.parameter).toString();
                    return variable.toUpperCase();
                }
            }
            throw new Error(`Unkown Bash substitution ${ast.text}`);
        }
        const variable = this.get_variable(ast.parameter);
        if (ast.length) {
            return variable.length.toString();
        }
        if (ast.indirect) {
            return this.get_variable(variable as string);
        }
        if (ast.index !== undefined) {
            const index = parseInt(ast.index, 10);
            return variable[index];
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
        try {
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
        } finally {
            this.remove_process(bash.pid);
        }
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
    // commands that require access to internal state of the interpreter
    // or have JavaScript restricted name
    // -------------------------------------------------------------------------
    protected async builtin_export(args: string[]) {
        this._export = true;
        for (const variable of args) {
            // Unbash parses export as command so we need to parse again
            // see: webpro-nl/unbash#12
            await this.evaluate(variable);
        }
        this._export = false;
        return 0;
    }

    // -------------------------------------------------------------------------
    protected async builtin_exit(args: string[]) {
        const code = args.length === 1 ?
            parseInt(args[0], 10) :
            parseInt(this.get_variable('?') as string, 10) || 0;
        throw new Exit(code);
    }

    // -------------------------------------------------------------------------
    protected builtin_true() {
        return 0;
    }

    // -------------------------------------------------------------------------
    protected builtin_false() {
        return 1;
    }

    // -------------------------------------------------------------------------
    protected async builtin_unset(args: string[]) {
        const options = parse_options(args, { boolean: ['v', 'f'] });
        if (options.f) {
            // delete function
        } else {
            for (const variable of options._) {
                delete this._globals[variable];
                delete this._locals[variable];
            }
        }
        return 0;
    }

    // -------------------------------------------------------------------------
    // command can be a user script (from fs) or builtin command
    // -------------------------------------------------------------------------
    protected async Command(ast: Command) {
        // save variables in tmp so we can restore it into globals
        // in `export NAME=VAR` or add it to the child process
        // `NAME=VAR program`
        if (ast.prefix.length) {
            await this.with_temp_vars(async () => {
                const [ prefix ] = ast.prefix;
                if (prefix.type === 'Assignment') {
                    let value;
                    if (prefix.value) {
                        value = await this.resolve(prefix.value);
                    } else if (prefix.array) {
                        value = await this.words(prefix.array);
                    }
                    if (prefix.name && value !== undefined) {
                        this.set_variable(prefix.name, value);
                    }
                }
            });
        }
        if (!ast.name) {
            for (const [key, value] of Object.entries(this.temp_vars)) {
                this.set_variable(key, value);
            }
            return 0;
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
        const builtin = ('builtin_' + command) as keyof BashInterpreter;
        // builtins run outside the try on purpose: `exit` unwinds the script by
        // raising, and catching it here would turn it into an ordinary status
        // and let the script carry on
        if (typeof this[builtin] === 'function') {
            return this[builtin](args);
        }
        const [input_redir, output_redir] = this.split_redirects(ast);
        const { stdout, stderr } = this._context;
        // only the stream a redirect names is swapped out - `>` must not
        // swallow what the command has to say on stderr. The replacement is a
        // silent one so that a command flushing as it goes still ends up with
        // everything it wrote in the buffer the file is written from
        const capture_stdout = output_redir.some(redirect => redirect.fileDescriptor !== 2);
        const capture_stderr = output_redir.some(redirect => redirect.fileDescriptor === 2);
        let code = 0;
        try {
            if (capture_stdout) {
                this._context.stdout = new SilientOutput();
            }
            if (capture_stderr) {
                this._context.stderr = new SilientOutput();
            }
            // input redirects run before the command they need
            // setup and teardown so they use exec as a callback
            if (input_redir.length) {
                for (const redirect of input_redir) {
                    await this.redirect(redirect, async () => {
                        code = await this.exec(command, ...args);
                    });
                }
            } else {
                code = await this.exec(command, ...args);
            }
        } catch(e) {
            // process was killed
            if (e instanceof Signal) {
                code = e.code;
            } else {
                code = 1;
                this._context.stderr.writeln((e as Error).message);
            }
        } finally {
            // the file a redirect names is written whether the command
            // succeeded or not, and the streams always go back to the terminal
            // - a command that raised must not leave the shell writing into a
            // buffer nobody reads
            let error = null;
            try {
                for (const redirect of output_redir) {
                    await this.redirect(redirect);
                }
            } catch(e) {
                error = e as Error;
            }
            this._context.stdout = stdout;
            this._context.stderr = stderr;
            if (error) {
                code = 1;
                this._context.stderr.writeln(error.message);
            }
        }
        if (!this._pipe) {
            const { stdout, stderr } = this._context;
            stderr.flush();
            stdout.flush();
        }
        this._tmp_env = Object.create(null);
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
    // ( ... ) runs in a shell of its own, so nothing it does to the working
    // directory or to its variables is visible afterwards
    // -------------------------------------------------------------------------
    protected async Subshell(ast: Subshell) {
        const bash = this.fork();
        try {
            return await bash.dispatch(ast.body);
        } finally {
            this.remove_process(bash.pid);
        }
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
    protected async Case(ast: Case) {
        const word = await this.resolve(ast.word);
        let result = 0;
        for (const item of ast.items) {
            for (const pattern of item.pattern) {
                if (pattern.value === '*') {
                    result = await this.dispatch(item.body);
                    if (item.terminator) {
                        return result;
                    }
                } else {
                    const value = await this.resolve(pattern);
                    if (word === value) {
                        result = await this.dispatch(item.body);
                        if (item.terminator) {
                            return result;
                        }
                    }
                }
            }
        }
        return result;
    }

    // -------------------------------------------------------------------------
    protected async Statement(ast: Statement) {
        let promise = this.dispatch(ast.command);
        if (ast.background) {
            this.set_variable('?', '0');
            return 0;
        }
        let code = await promise;
        if (code === undefined) {
            code = 0;
        }
        this.set_variable('?', code.toString());
        return code;
    }
}
