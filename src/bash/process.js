const __modules__ = (() => {
    const channel = new BroadcastChannel(`__ipc__:{{PID}}`);

    let rprc_id = 0;

    let callback_id = 0;
    const callbacks = {};

    function serialize(data) {
        // serilize functions so callbacks can be used in user scripts
        return JSON.stringify(data, function(key, value) {
            const v0 = this[key];
            if (v0) {
                if (typeof v0 === 'function') {
                    const id = ++callback_id;
                    callbacks[id] = v0;
                    return {
                        'type': 'function',
                        'data': [id, v0.length]
                    };
                }
            }
            return value;
        });
    }

    function unserialize(string) {
        // an { type: 'object', data: [id] } marker is a handle to a value
        // that lives on the main thread (e.g. a jQuery object) - turn it
        // back into a chain proxy rooted at that handle instead of the
        // literal marker object
        return JSON.parse(string, (_key, value) => {
            if (value && typeof value === 'object' && value.type === 'object') {
                const [ id ] = value.data;
                return make_chain({ object: id });
            }
            return value;
        });
    }

    // callback mechanism needs persistent message channel
    channel.addEventListener('message', async function handler(message) {
        const data = unserialize(message.data);
        if (typeof data.callback === 'number') {
            const fn = callbacks[data.callback];
            const result = await fn(...data.args);
            channel.postMessage(serialize({
                callback: data.callback,
                result
            }));
        }
    });

    // root is either { namespace: string } for a require()'d module or
    // { object: id } for a handle previously returned by the main thread.
    // ops is the accumulated sequence of property-accesses/calls collected
    // by make_chain, e.g. $('.terminal').terminal() becomes
    // [{type:'call',args:['.terminal']}, {type:'get',key:'terminal'}, {type:'call',args:[]}]
    // and is walked on the main thread in a single round trip
    function call(root, ops) {
        return new Promise((resolve, reject) => {
            const id = ++rprc_id;
            channel.addEventListener('message', function handler(message) {
                const data = unserialize(message.data);
                if (data.id === id) {
                    if (data.error) {
                        reject(data.error);
                    } else {
                        resolve(data.result);
                    }
                    channel.removeEventListener('message', handler);
                }
            });
            const payload = serialize({
                id,
                ...root,
                ops
            });
            channel.postMessage(payload);
        });
    }

    // proxy that accumulates a chain of property accesses/calls (e.g.
    // $('.terminal').terminal().echo('hi')) without talking to the main
    // thread at all - the whole chain is only resolved, in one round trip,
    // once something actually awaits it (see the 'then' trap below)
    function make_chain(root, ops = []) {
        return new Proxy(function() {}, {
            apply(_target, _this_arg, args) {
                return make_chain(root, [...ops, { type: 'call', args }]);
            },
            get(_target, key) {
                // 'then' is never forwarded as a regular chain step - it is
                // either the thenable hook (see below) or undefined, never
                // another chain proxy. Otherwise a bare, never-awaited
                // reference (ops still empty, e.g. `const t = require('term')`)
                // would report typeof t.then === 'function' too (since
                // accessing .then would itself return a callable proxy),
                // making it look thenable to any code/engine machinery that
                // checks for one.
                if (key === 'then') {
                    // becoming a real thenable is what triggers execution:
                    // `await chain` sends the accumulated ops in one message
                    // and resolves with the result. Only do this when there
                    // is something to run - a freshly received object handle
                    // (ops still empty) must stay non-thenable, because it
                    // resolves to *another* such handle and native promise
                    // resolution would keep "adopting" it as a thenable
                    // forever otherwise
                    if (!ops.length) {
                        return undefined;
                    }
                    return (resolve, reject) => call(root, ops).then(resolve, reject);
                }
                if (typeof key !== 'string') {
                    return undefined;
                }
                return make_chain(root, [...ops, { type: 'get', key }]);
            }
        });
    }

    return new Proxy({}, {
        get(_target, namespace) {
            return make_chain({ namespace });
        }
    });
})();

function require(module) {
  return __modules__[module];
}

{

{{CODE}}

const args = {{ARGS}};
(async () => {
    const code = await main(...args);
    self.postMessage({ exit: code });
    self.close();
})().catch(async error => {
    console.log(error);
    await __modules__.stderr.writeln(error.message);
    self.postMessage({ exit: 100 });
    self.close();
});

}
