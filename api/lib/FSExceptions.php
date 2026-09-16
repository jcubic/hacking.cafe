<?php
/*
 *  Exceptions mirroring @isomorphic-git/lightning-fs errors.js
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

class FSException extends RuntimeException {}

class FSNotFoundException extends FSException {
    function __construct($path) {
        parent::__construct("ENOENT: no such file or directory, '$path'");
    }
}

class FSExistsException extends FSException {
    function __construct($path) {
        parent::__construct("EEXIST: file already exists, '$path'");
    }
}

class FSNotDirectoryException extends FSException {
    function __construct($path) {
        parent::__construct("ENOTDIR: not a directory, '$path'");
    }
}

class FSIsDirectoryException extends FSException {
    function __construct($path) {
        parent::__construct("EISDIR: illegal operation on a directory, '$path'");
    }
}

class FSNotEmptyException extends FSException {
    function __construct($path) {
        parent::__construct("ENOTEMPTY: directory not empty, '$path'");
    }
}
