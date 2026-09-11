import jQuery from 'jquery';
import terminal from 'jquery.terminal';

// @ts-expect-error
import xml from 'jquery.terminal/js/xml_formatting.js';

import less from 'jquery.terminal/js/less.js';

import pipe from 'jquery.terminal/js/pipe.js';

export const $ = terminal(window, jQuery) as any as JQueryStatic;
xml(window, $);
less(window, $);
pipe(window, $);

export type JQueryTerminal = ReturnType<JQuery['terminal']>;

(globalThis as any).$ = $;

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
