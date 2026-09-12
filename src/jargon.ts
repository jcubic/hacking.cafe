import type { BashContext } from './bash';
import type { RPCService } from '@jcubic/json-rpc';



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

export function make_jargon(service: RPCService) {
    return async function(this: BashContext, ...args: string[]) {
        // @ts-expect-error
        const options = $.terminal.parse_options(args, { boolean: ['s'] });
        if (options._.length) {
            let query = options._.join(' ').toLowerCase();
            try {
                if (options.s) {
                    if (!query.match(/%/)) {
                        query = '%' + query + '%';
                    }
                    const data = await service.jargon_search(query) as Array<{ term: string }>;
                    this.stdout.writeln(data.map(({ term }: { term: string }) => {
                        return `<name>${term}</name>`;
                    }).join('\n'));
                } else {
                    // normal query
                    const data = await service.jargon(query);
                    const entry = format_entry(data as JargonEntry[]);
                    this.stdout.writeln(entry.trim());
                }
            } catch (error: any) {
                this.stderr.writeln(error.message);
            }
        } else {
            const msg = 'This is the Jargon File, a comprehens'+
                'ive compendium of hacker slang illuminating m'+
                'any aspects of hackish tradition, folklore, a'+
                'nd humor.\n\nusage: jargon [-s] &lt;QUERY&gt;'+
                '\n\n-s search jargon file';
            const logo = `<bold><white>${jargon.innerHTML}</white></bold>`;
            this.stdout.writeln(`${logo}\n${msg}`);
        }
    }
}
