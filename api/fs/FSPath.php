<?php
/*
 *  Path helpers mirroring @isomorphic-git/lightning-fs src/path.js
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

final class FSPath {
    // ------------------------------------------------------------------------
    static function split($path) {
        if ($path === '') {
            return [];
        }
        if ($path === '/') {
            return ['/'];
        }
        $parts = explode('/', $path);
        if (end($parts) === '') {
            array_pop($parts);
        }
        if ($path[0] === '/') {
            $parts[0] = '/';
        } else if ($parts[0] !== '.') {
            array_unshift($parts, '.');
        }
        return $parts;
    }

    // ------------------------------------------------------------------------
    static function join(...$parts) {
        if (count($parts) === 0) {
            return '';
        }
        return preg_replace('#/{2,}#', '/', implode('/', $parts));
    }

    // ------------------------------------------------------------------------
    static function dirname($path) {
        $last = strrpos($path, '/');
        if ($last === false) {
            throw new InvalidArgumentException("Cannot get dirname of \"$path\"");
        }
        if ($last === 0) {
            return '/';
        }
        return substr($path, 0, $last);
    }

    // ------------------------------------------------------------------------
    static function basename($path) {
        if ($path === '/') {
            throw new InvalidArgumentException("Cannot get basename of \"$path\"");
        }
        $last = strrpos($path, '/');
        if ($last === false) {
            return $path;
        }
        return substr($path, $last + 1);
    }

    // ------------------------------------------------------------------------
    static function normalize($path) {
        if ($path === '') {
            return '.';
        }
        $ancestors = [];
        foreach (self::split($path) as $current) {
            $ancestors = self::reduce($ancestors, $current);
        }
        return self::join(...$ancestors);
    }

    // ------------------------------------------------------------------------
    static function resolve(...$paths) {
        $result = '';
        foreach ($paths as $path) {
            if (strlen($path) > 0 && $path[0] === '/') {
                $result = $path;
            } else {
                $result = self::normalize(self::join($result, $path));
            }
        }
        return $result;
    }

    // ------------------------------------------------------------------------
    private static function reduce($ancestors, $current) {
        if (count($ancestors) === 0) {
            $ancestors[] = $current;
            return $ancestors;
        }
        if ($current === '.') {
            return $ancestors;
        }
        if ($current === '..') {
            if (count($ancestors) === 1) {
                if ($ancestors[0] === '/') {
                    throw new InvalidArgumentException(
                        'Unable to normalize path - traverses above root directory'
                    );
                }
                if ($ancestors[0] === '.') {
                    $ancestors[] = $current;
                    return $ancestors;
                }
            }
            if (end($ancestors) === '..') {
                $ancestors[] = '..';
                return $ancestors;
            }
            array_pop($ancestors);
            return $ancestors;
        }
        $ancestors[] = $current;
        return $ancestors;
    }
}
