<div align="center">

# Hacking Cafe

</div>

This project is a continuation of [Fake Linux Terminal](https://github.com/jcubic/fake-linux-terminal).
The aim is to create a persistent Unix-like system in the browser. With the help from some backend code.

## TODO

- [x]: `~/.bashrc` and `/etc/bashrc` files
- [x]: `$PS1` variable
- [x]: `$PATH` variable
- [x]: subshells
- [x]: If statements
- [x]: and/or expressions
- [x]: double-quote expressions
- [x]: variable assignments
- [x]: pipes
- [x]: redirects (`>` and `<`)
- [x]: JavaScript programs using web workers
- [x]: Bash scripts and shebang
- [ ]: variable expansions:
  - [ ]: `${DATABASE_URL:="localhost"}`
  - [x]: `USER_ID=${1:?"Error, arg missing!"}`
  - [x]: `${VAR:-default}`
  - [x]: `${VAR-default}`
  - [x]: `${var+alternative}`
  - [x]: `${var:+alternative}`
  - [x]: `${VAR/x/y}` - replace
  - [x]: `${VAR//x/y}` - replace all
  - [ ]: `${TEXT:4}` `${TEXT:0:4}` - substring
  - [x]: `${FILE%.*}` - remove traling non-greedy
  - [x]: `${PATH%%:*}` remove traling greedy
  - [x]: `${PATH##*/}` - remove greedy before
  - [x]: `EXTENSION=${FILE#*.}` - remove before
  - [x]: `${NAME^}` - camel case
  - [x]: `${NAME^^}` - upper case
  - [x]: `LEN=${#NAME}` - string length
  - [x]: `${!POINTER}` - indirect variable
- [ ]: run in background `&` (bash in worker?)
- [ ]: process substitution `<(command)` and `>(command)`
- [ ]: extract commands like `cat` or `grep` into scripts in `/bin`
- [ ]: glob patterns
- [ ]: `test` command
- [ ]: aliases and functions
- [ ]: order: keywords => aliases => function => builtins => executables
- [ ]: `printf`
- [ ]: `pushd`/`popd`
- [ ]: `for`, `while`, `until`
- [ ]: `while read line`
- [ ]: `case esac`
- [ ]: `$0`-`$9`
- [ ]: `$@` / `$*` / `$#`
- [ ]: `read -p "contunue? (y/n) "`
- [ ]: history
- [ ]: export / unset
- [ ]: completion

## Limitations

Bash expact aliases before processing keyboards, which allows changing syntax. By design
Hacking Cafe will only expand aliases as commands.

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
