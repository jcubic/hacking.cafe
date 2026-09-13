<?php
/*
 *  CacheFS mirrors @isomorphic-git/lightning-fs's src/CacheFS.js: the
 *  in-memory directory-tree operations (lookup, stat, readdir, mkdir, ...)
 *  that walk the superblock. It knows nothing about SQLite; that's
 *  SQLiteFSBackend's job.
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
require_once __DIR__ . '/FSPath.php';
require_once __DIR__ . '/FSExceptions.php';

final class CacheFS {
    private $root; // FSNode; children['/'] is the actual root directory

    // ------------------------------------------------------------------------
    function activate(?FSNode $superblock = null) {
        if ($superblock === null) {
            $this->root = new FSNode();
            $this->root->setChild('/', $this->makeRootDir());
        } else {
            $this->root = $superblock;
        }
    }

    // ------------------------------------------------------------------------
    function getRoot() {
        return $this->root;
    }

    // ------------------------------------------------------------------------
    function autoinc() {
        return $this->maxInode($this->root->getChild('/')) + 1;
    }

    // ------------------------------------------------------------------------
    function stat($filepath) {
        return $this->lookup($filepath)->stat;
    }

    // ------------------------------------------------------------------------
    function lstat($filepath) {
        return $this->lookup($filepath, false)->stat;
    }

    // ------------------------------------------------------------------------
    function readdir($filepath) {
        $dir = $this->lookup($filepath);
        if ($dir->stat['type'] !== 'dir') {
            throw new FSNotDirectoryException($filepath);
        }
        return $dir->childNames();
    }

    // ------------------------------------------------------------------------
    function mkdir($filepath, $mode = 0777) {
        if ($filepath === '/') {
            throw new FSExistsException($filepath);
        }
        $dir = $this->lookup(FSPath::dirname($filepath));
        $basename = FSPath::basename($filepath);
        if ($dir->hasChild($basename)) {
            throw new FSExistsException($filepath);
        }
        $entry = new FSNode();
        $entry->stat = [
            'mode' => $mode,
            'type' => 'dir',
            'size' => 0,
            'mtimeMs' => now_ms(),
            'ino' => $this->autoinc(),
        ];
        $dir->setChild($basename, $entry);
    }

    // ------------------------------------------------------------------------
    function rmdir($filepath) {
        $dir = $this->lookup($filepath);
        if ($dir->stat['type'] !== 'dir') {
            throw new FSNotDirectoryException($filepath);
        }
        if ($dir->childCount() > 0) {
            throw new FSNotEmptyException($filepath);
        }
        $parent = $this->lookup(FSPath::dirname($filepath));
        $parent->deleteChild(FSPath::basename($filepath));
    }

    // ------------------------------------------------------------------------
    /** Create/replace the stat entry for a file of the given size; caller writes the bytes. */
    function writeStat($filepath, $size, $mode = null) {
        $oldStat = null;
        try {
            $oldStat = $this->stat($filepath);
        } catch (FSNotFoundException $e) {
        }

        $ino = null;
        if ($oldStat !== null) {
            if ($oldStat['type'] === 'dir') {
                throw new FSIsDirectoryException($filepath);
            }
            if ($mode === null) {
                $mode = $oldStat['mode'];
            }
            $ino = $oldStat['ino'];
        }
        if ($mode === null) {
            $mode = 0666;
        }
        if ($ino === null) {
            $ino = $this->autoinc();
        }

        $dir = $this->lookup(FSPath::dirname($filepath));
        $basename = FSPath::basename($filepath);
        $stat = [
            'mode' => $mode,
            'type' => 'file',
            'size' => $size,
            'mtimeMs' => now_ms(),
            'ino' => $ino,
        ];
        $entry = new FSNode();
        $entry->stat = $stat;
        $dir->setChild($basename, $entry);
        return $stat;
    }

    // ------------------------------------------------------------------------
    function unlink($filepath) {
        $parent = $this->lookup(FSPath::dirname($filepath));
        $parent->deleteChild(FSPath::basename($filepath));
    }

    // ------------------------------------------------------------------------
    function rename($oldFilepath, $newFilepath) {
        $basename = FSPath::basename($newFilepath);
        // Note: do both lookups before making any changes, so if either
        // throws we haven't lost data.
        $entry = $this->lookup($oldFilepath);
        $destDir = $this->lookup(FSPath::dirname($newFilepath));
        $destDir->setChild($basename, $entry);
        $this->unlink($oldFilepath);
    }

    // ------------------------------------------------------------------------
    function readlink($filepath) {
        return $this->lookup($filepath, false)->stat['target'];
    }

    // ------------------------------------------------------------------------
    function symlink($target, $filepath) {
        $ino = null;
        $mode = null;
        try {
            $oldStat = $this->stat($filepath);
            $mode = $oldStat['mode'];
            $ino = $oldStat['ino'];
        } catch (FSNotFoundException $e) {
        }
        if ($mode === null) {
            $mode = 0120000;
        }
        if ($ino === null) {
            $ino = $this->autoinc();
        }

        $dir = $this->lookup(FSPath::dirname($filepath));
        $basename = FSPath::basename($filepath);
        $stat = [
            'mode' => $mode,
            'type' => 'symlink',
            'target' => $target,
            'size' => 0,
            'mtimeMs' => now_ms(),
            'ino' => $ino,
        ];
        $entry = new FSNode();
        $entry->stat = $stat;
        $dir->setChild($basename, $entry);
        return $stat;
    }

    // ------------------------------------------------------------------------
    function du($filepath) {
        return $this->duNode($this->lookup($filepath));
    }

    // ------------------------------------------------------------------------
    private function makeRootDir() {
        $node = new FSNode();
        $node->stat = ['mode' => 0777, 'type' => 'dir', 'size' => 0, 'ino' => 0, 'mtimeMs' => now_ms()];
        return $node;
    }

    // ------------------------------------------------------------------------
    private function maxInode(FSNode $node) {
        $max = $node->stat['ino'];
        $node->eachChild(function($name, $child) use (&$max) {
            $max = max($max, $this->maxInode($child));
        });
        return $max;
    }

    // ------------------------------------------------------------------------
    private function duNode(FSNode $node) {
        $size = $node->stat['size'] ?? 0;
        $node->eachChild(function($name, $child) use (&$size) {
            $size += $this->duNode($child);
        });
        return $size;
    }

    // ------------------------------------------------------------------------
    private function lookup($filepath, $follow = true) {
        $dir = $this->root;
        $partialPath = '/';
        $parts = FSPath::split($filepath);
        $count = count($parts);
        for ($i = 0; $i < $count; $i++) {
            $part = $parts[$i];
            $dir = $dir->getChild($part);
            if ($dir === null) {
                throw new FSNotFoundException($filepath);
            }
            // Follow symlinks
            if ($follow || $i < $count - 1) {
                $stat = $dir->stat;
                if ($stat['type'] === 'symlink') {
                    $target = FSPath::resolve($partialPath, $stat['target']);
                    $dir = $this->lookup($target);
                }
                $partialPath = $partialPath === '' ? $part : FSPath::join($partialPath, $part);
            }
        }
        return $dir;
    }
}

// ------------------------------------------------------------------------
function now_ms() {
    return (int) round(microtime(true) * 1000);
}
