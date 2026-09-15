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
import jQuery from 'jquery';
import terminal from 'jquery.terminal';

// @ts-expect-error
import xml from 'jquery.terminal/js/xml_formatting.js';

import less from 'jquery.terminal/js/less.js';

// @ts-expect-error
import unix from 'jquery.terminal/js/unix_formatting.js';

import pipe from 'jquery.terminal/js/pipe.js';

// @ts-expect-error
import prism from 'jquery.terminal/js/prism.js';

export const $ = terminal(window, jQuery) as any as JQueryStatic;
xml(window, $);
less(window, $);
pipe(window, $);
unix(window, $);
prism(window, $);

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
