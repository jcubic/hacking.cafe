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
import { BashContext, ListDir } from './types';
import { list_dir } from './utils';

function trailing(list: string[]) {
    return list.map((dir: string) => dir + '/');
}

function get_path(cwd: string, string: string) {
    let path = cwd.replace(/^\//, '').split('/');
    if (path[0] === '') {
        path = path.slice(1);
    }
    var parts = string === '/'
        ? string.split('/')
        : string.replace(/\/?[^\/]*$/, '').split('/');
    if (parts[0] === '') {
        parts = parts.slice(1);
    }
    if (string === '/') {
        return [];
    } else if (string.startsWith('/')) {
        return parts;
    } else if (path.length) {
        return path.concat(parts);
    } else {
        return parts;
    }
}

type ProcessCallback = (arg: ListDir) => string[];

async function process_assets(bash: BashContext, command: string, callback: ProcessCallback) {
    function prepend(list: string[]) {
        if (command.match(/\//) || (!command.trim() && bash.cwd === '/')) {
            var path = command.replace(/\/[^\/]+$/, '').replace(/\/+$/, '');
            return list.map((dir: string) => path + '/' + dir);
        } else {
            return list;
        }
    }
    var dir = get_path(bash.cwd, command.replace('~', bash.home));
    return prepend(callback(await list_dir(bash.fs, '/' + dir.join('/'))));
}

export function complete_file(bash: BashContext, command: string) {
    return process_assets(bash, command, (content: ListDir) => {
        return trailing(content.dirs).concat(content.files);
    });
}

export function complete_directory(bash: BashContext, command: string) {
    return process_assets(bash, command, (content: ListDir) => {
        return trailing(content.dirs);
    });
}
