<?php
/*
 *  Mirrors the (de)serialization format used by src/fs.ts's RPCBackend, so
 *  the raw bytes stored in the `fs` SQLite table stay interchangeable
 *  between the browser's LightningFS and this PHP reader:
 *
 *    Uint8Array -> {"__type": "uint8array", "data": "<base64>"}
 *    Map        -> {"__type": "map", "data": [[key, value], ...]}
 *
 *  The RPC layer additionally base64-wraps the whole JSON string for
 *  transport; api/index.php's fs_set()/fs_get() already undo that layer,
 *  so the SQLite blob is exactly the raw UTF-8 JSON text handled here.
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

require_once __DIR__ . '/FSNode.php';

final class FSSerializer {
    // ------------------------------------------------------------------------
    static function serialize($value) {
        return json_encode(self::serializeValue($value));
    }

    // ------------------------------------------------------------------------
    static function deserialize($raw) {
        return self::deserializeValue(json_decode($raw, true));
    }

    // ------------------------------------------------------------------------
    private static function serializeValue($value) {
        if ($value instanceof FSNode) {
            $pairs = [];
            if ($value->stat !== null) {
                $pairs[] = [0, $value->stat];
            }
            $value->eachChild(function($name, $child) use (&$pairs) {
                $pairs[] = [$name, self::serializeValue($child)];
            });
            return ['__type' => 'map', 'data' => $pairs];
        }
        // a raw byte buffer standing in for a Uint8Array (file content)
        if (is_string($value)) {
            return ['__type' => 'uint8array', 'data' => base64_encode($value)];
        }
        return $value;
    }

    // ------------------------------------------------------------------------
    private static function deserializeValue($value) {
        if (is_array($value) && isset($value['__type'])) {
            if ($value['__type'] === 'uint8array') {
                return base64_decode($value['data']);
            }
            if ($value['__type'] === 'map') {
                $node = new FSNode();
                foreach ($value['data'] as [$key, $val]) {
                    if (is_int($key)) {
                        // the STAT sentinel (Map key 0 in CacheFS.js)
                        $node->stat = $val;
                    } else {
                        $node->setChild($key, self::deserializeValue($val));
                    }
                }
                return $node;
            }
        }
        return $value;
    }
}
