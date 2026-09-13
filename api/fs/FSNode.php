<?php
/*
 *  FSNode mirrors a single entry of the nested Map that
 *  @isomorphic-git/lightning-fs's CacheFS keeps as its superblock:
 *  a `stat` record plus named children (for directories).
 *
 *  Children are stored under a NUL-prefixed key so a filename that looks
 *  like an integer (eg. "0" or "123") can never collide with PHP's
 *  automatic numeric-string-to-int array key coercion.
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

final class FSNode {
    public $stat = null;
    private $children = [];

    // ------------------------------------------------------------------------
    function hasChild($name) {
        return array_key_exists("\0$name", $this->children);
    }

    // ------------------------------------------------------------------------
    function getChild($name) {
        return $this->children["\0$name"] ?? null;
    }

    // ------------------------------------------------------------------------
    function setChild($name, FSNode $node) {
        $this->children["\0$name"] = $node;
    }

    // ------------------------------------------------------------------------
    function deleteChild($name) {
        unset($this->children["\0$name"]);
    }

    // ------------------------------------------------------------------------
    function childNames() {
        return array_map(function($key) {
            return substr($key, 1);
        }, array_keys($this->children));
    }

    // ------------------------------------------------------------------------
    function childCount() {
        return count($this->children);
    }

    // ------------------------------------------------------------------------
    function eachChild(callable $fn) {
        foreach ($this->children as $key => $node) {
            $fn(substr($key, 1), $node);
        }
    }
}
