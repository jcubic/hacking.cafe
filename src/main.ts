import jQuery from 'jquery';
import rpc from '@jcubic/json-rpc';
import terminal from 'jquery.terminal';

// @ts-expect-error
import xml from 'jquery.terminal/js/xml_formatting.js';

const $ = terminal(window, jQuery) as any as JQueryStatic;
xml(window, $);

const delay = 80;

type JQueryTerminal = ReturnType<JQuery['terminal']>;

const rpc_url = import.meta.env.DEV ? 'http://localhost:8810/' : '/api/';

const intepreter = rpc({ url: rpc_url }).then(service => {
    const commands = {
        async hello(name: string) {
            return service.hello(name);
        },
        async jargon(this: JQueryTerminal, ...args: string[]) {
            // @ts-expect-error
            const options = $.terminal.parse_options(args, { boolean: ['s'] });
            // there are options
            if (options._.length) {
                const query = options._.join(' ').toLowerCase();
                // search option
                if (options.s) {
                    // @ts-expect-error
                    const { data, error } = await jargon_search(query);
                    if (error) {
                        this.error(error);
                    } else {
                        this.echo(data.map((term: string) => {
                            return `<name>${term}</name>`;
                        }).join('\n'));
                    }
                } else {
                    // normal query
                    // @ts-expect-error
                    const { data, error } = await jargon_term(query);
                    if (error) {
                        this.error(error);
                    } else {
                        const entry = format_entry(data);
                        this.echo(entry.trim(), {
                            keepWords: true
                        });
                    }
                }
            } else {
                const msg = 'This is the Jargon File, a comprehens'+
                    'ive compendium of hacker slang illuminating m'+
                    'any aspects of hackish tradition, folklore, a'+
                    'nd humor.\n\nusage: jargon [-s] &lt;QUERY&gt;'+
                    '\n\n-s search jargon file';
                const logo = `<bold><white>${jargon.innerHTML}</white></bold>`;
                this.echo(`${logo}\n${msg}`, { keepWords: true });
            }
        },
        record(this: JQueryTerminal, ...args: string[]) {
            // toggle storing commands in URL hash
            if (args[0] === 'start') {
                term.history_state(true);
            } else if (args[0] === 'stop') {
                term.history_state(false);
            } else {
                this.echo('save commands in url hash so you can rerun them\n\n' +
                    'usage: record [stop|start]');
            }
        },
        async rfc(this: JQueryTerminal, ...args: string[]) {

            if (args[0] == '--help') {
                term.echo('Browser of RFC documents, using less unix command.\n\n' +
                    'If you execute without arguments you will get index page\n' +
                    'And on that page you can use / followed by text, to search\n' +
                    'links to RFC documents are clickable');
            } else {
                try {
                    if (args.length) {
                        if (Number.isInteger(args[0])) {
                            const number = args[0];
                            const url = `https://www.rfc-editor.org/rfc/rfc${number}.txt`;
                            // @ts-expect-error
                            const rfc = await fetch_rfc(url);
                            display_rfc(rfc);
                        } else {
                            this.error('invalid RFC number');
                        }
                    } else {
                        // @ts-expect-error
                        const rfc = await fetch_rfc('http://www.rfc-editor.org/in-notes/rfc-index.txt');
                        display_rfc(rfc);
                    }
                } catch (err) {
                    this.error((err as Error).message);
                }
            }
        },
        credits(this: JQueryTerminal) {
            const text = [
                '',
                'Tools, libraries, and services used:',
                '* [[!b;#fff;;;https://terminal.jcubic.pl/]jQuery Terminal]',
                '* [[!b;#fff;;;https://github.com/patorjk/figlet.js]Figlet.js] + Modular and Rectangles fonts',
                '* [[!b;#fff;;;http://catb.org/jargon/html/index.html]Jargon File] 4.4.7',
                '* [[!b;#fff;;;https://www.rfc-editor.org/]RFC Editor]',
                ''
            ].join('\n');
            this.echo(text, { keepWords: true });
        },
        help(this: JQueryTerminal) {
            const list = formatter.format(command_list());
            this.echo(`Available commands: ${list}.`, { keepWords: true });
            this.echo('An <command>rfc</command> command use simplifed unix less command.\n', {
                keepWords: true
            });
        }
    };
    term.on('click', 'a.jargon', function(this: any) {
        const href = $(this).attr('href') as string;
        term.exec(`jargon ${href}`, { typing: true, delay });
        return false;
    }).on('click', 'a.command', function(this: any) {
        const command = $(this).attr('href') as string;
        term.exec(command, { typing: true, delay });
        return false;
    }).on('click', 'a.rfc', function(this: any) {
        const command = $(this).attr('href') as string;
        // are we inside RFC browser?
        if (term.level() >= 2) {
            commands.rfc.call(term, command);
        } else {
            term.exec(`rfc ${command}`, { typing: true, delay });
        }
        return false;
    });

    function command_list() {
        const list = Object.keys(commands);
        list.push('clear');
        return list.map(cmd => `<command>${cmd}</command>`);
    }

    return commands;
});

$.terminal.defaults.formatters.unshift([/(rfc\s?([0-9]+))/gi, '<rfc num="$2">$1</rfc>', {
    echo: true
}]);

//$.terminal.defaults.formatters.push([/ ([0-9+]\. )/g, '\n$1']);
// @ts-expect-error
$.terminal.xml_formatter.tags.name = () => '[[!bu;#fff;;jargon]';
// @ts-expect-error
$.terminal.xml_formatter.tags.emphasis = () => '[[b;#fff;]';
// @ts-expect-error
$.terminal.xml_formatter.tags.command = () => '[[!bu;#fff;;command]';
// @ts-expect-error
$.terminal.xml_formatter.tags.rfc = ({ num }: { num: string }) => `[[!bu;yellow;;rfc;${num}]`;

const formatter = new Intl.ListFormat('en', {
    style: 'long',
    type: 'conjunction',
});

const term = $('body').terminal(intepreter as any, {
    checkArity: false,
    // @ts-expect-error
    execHash: true,
    exit: false,
    execAnimation: true,
    execHistory: true,
    completion: true,
    greetings: null,
    prompt: '<DodgerBlue>~</DodgerBlue>:&gt; ',
    onInit() {
        this.echo(() => {
            const cols = this.cols();
            if (cols >= 100) {
                return greetings_big.innerHTML;
            } else if (cols >= 62) {
                return greetings_medium.innerHTML;
            } else if (cols >= 38) {
                return greetings_small.innerHTML;
            } else {
                return greetings_tiny.innerHTML
            }
        });
    }
});



type JargonEntry = {
    term: string;
    def: string;
    abbrev?: []
};

function format_entry(entries: JargonEntry[]) {
    let result = entries.map(function(entry: JargonEntry) {
        let text = '[[b;#fff;]' + entry.term + ']';
        if (entry.abbrev) {
            text += ' (' + entry.abbrev.join(', ') + ')';
        }
        let re = new RegExp("((?:https?|ftps?)://\\S+)|\\.(?!\\s|\\]\\s)\\)?", "g");
        let def = entry.def.replace(re, function(text: string, g: string) {
            return g ? g : (text == '.)' ? '.) ' : '. ');
        });
        return text + '\n' + def + '\n';
    }).join('\n');
    result = $.terminal.format_split(result).map(function(str: string) {
        if ($.terminal.is_formatting(str)) {
            return str.replace(/^\[\[([bu]{2};)/, '[[!$1');
        }
        return str;
    }).join('');

    return result;
}



function display_rfc(rfc: string) {
    // RFC have leading and trailing whitespace
    rfc = rfc.trim();
    // RFC don't have any XML formatting, they are text files
    rfc = rfc.replace(/</g, '&lt;');
    rfc = rfc.replace(/>/g, '&gt;');
    term.less(rfc);
}
