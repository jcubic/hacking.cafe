<div align="center">

# Hacking Cafe

</div>

This project is a continuation of [Fake Linux Terminal](https://github.com/jcubic/fake-linux-terminal).
The aim is to create a persistent Unix-like system in the browser. With the help from some backend code.

## TODO

### Bash

- [x] `~/.bashrc` and `/etc/bashrc` files
- [x] `$PS1` variable
  - [ ] functions in prompt (backticks)
- [x] `$PATH` variable
- [x] `$IFS` variable
- [x] `$?` variable
- [x] `$PWD` variable
- [x] subshells
- [x] If statements
- [x] and/or expressions
- [x] double-quote expressions
- [x] variable assignments
- [ ] arrays
- [x] pipes
- [x] redirects (`>` and `<`)
- [x] JavaScript programs using web workers
- [x] Bash scripts and shebang
- [x] variable expansions:
  - [x] `${DATABASE_URL:="localhost"}`
  - [x] `USER_ID=${1:?"Error, arg missing!"}`
  - [x] `${VAR:-default}`
  - [x] `${VAR-default}`
  - [x] `${var+alternative}`
  - [x] `${var:+alternative}`
  - [x] `${VAR/x/y}` - replace
  - [x] `${VAR//x/y}` - replace all
  - [x] `${TEXT:4}` `${TEXT:0:4}` - slice
  - [x] `${FILE%.*}` - remove traling non-greedy
  - [x] `${PATH%%:*}` remove traling greedy
  - [x] `${PATH##*/}` - remove greedy before
  - [x] `EXTENSION=${FILE#*.}` - remove before
  - [x] `${NAME^}` - camel case
  - [x] `${NAME^^}` - upper case
  - [x] `LEN=${#NAME}` - string length
  - [x] `${!POINTER}` - indirect variable
- [x] run in background `&`
- [ ] process substitution `<(command)` and `>(command)`
- [ ] extract commands like `cat` or `grep` into scripts in `/bin`
- [ ] glob patterns
- [x] `test` command
- [ ] aliases
- [ ] functions
- [ ] order: keywords => aliases => function => builtins => executables
- [x] `printf`
- [x] `kill`
- [x] `ps`
- [ ] `type`
- [x] `pushd`/`popd`
- [x] `while`, `until`
- [ ] `for`
- [x] `while read line`
- [ ] `case esac`
- [x] `$0`-`$9`
- [x] `$@` / `$*` / `$#`
- [x] `read -p "contunue? (y/n) "`
- [ ] history
- [x] export
- [x] unset
- [ ] completion

### FS

- [ ] `env` command
- [ ] scripts in fs as REPLs
  - [ ] `/bin/js` repl and interpreter
  - [ ] `/bin/bash` as subshell
  - [ ] `/bin/php` using uniter [demo](https://codepen.io/jcubic/pen/VGYBVj)
  - [ ] `/bin/head`
  - [ ] `/bin/tail`
  - [ ] `/bin/wc`
  - [ ] `/bin/cut`
  - [ ] `/bin/uniq`
  - [ ] `/bin/sort`
  - [ ] `/bin/tr`
  - [ ] `/bin/cp`
  - [ ] `/bin/mv`
  - [ ] `/bin/readlink`
  - [ ] `/bin/touch`
  - [ ] `/bin/chgrp`
  - [ ] `/bin/du`
  - [ ] `/bin/tee`
  - [ ] `/bin/xargs`
  - [ ] `/bin/basename`
  - [ ] `/bin/dirname`
  - [ ] `/bin/mktemp`
  - [ ] `/bin/whoami`
  - [ ] `/bin/who`
  - [ ] `/bin/uname`
  - [ ] `/bin/hostname`
  - [x] `/bin/sleep`
  - [ ] `/bin/vi` ([jsvi](https://github.com/jcubic/jsvi) - add to npm)
  - [ ] `/bin/nano` ([micro](https://github.com/jcubic/jquery.micro) - add to npm)

### Unix

- [ ] permissions (enforced on the server somehow)
- [ ] login (guest without password)
- [ ] `/etc/issue`
- [ ] `/etc/motd`
- [ ] `/etc/group`
- [ ] `CTRL+D` stop the process

## Limitations

* Bash expands aliases before processing keyboards, which allows changing syntax. By design
Hacking Cafe will only expand aliases as commands.
* `$@` works the same as `"$@"` (it may change).

## Commercial License

If you want to acquire a commercial license, you can contact me via <jcubic@jcubic.pl>.

## License

```
    Copyright (c) 2026 Jakub T. Jankiewicz <https://jakub.jankiewicz.org>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>
```
