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
    // { object: id } for a handle previously returned by the main thread
    function call(root, path, args) {
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
                path,
                args
            });
            channel.postMessage(payload);
        });
    }

    // proxy that accumulates a chain of property accesses (e.g.
    // $.terminal.active) and only talks to the main thread once the chain
    // is invoked as a function - the accumulated path plus the call
    // arguments are sent in one message instead of one round trip per
    // property access
    function make_chain(root, path = []) {
        return new Proxy(function() {}, {
            apply(_target, _this_arg, args) {
                return call(root, path, args);
            },
            get(_target, key) {
                // 'then' must stay undefined or `await`-ing a chain (e.g.
                // `await term.pause()` where pause() resolves to a chain
                // proxy) mistakes it for a thenable, calls .then() on it as
                // an RPC round trip that has no real receiver, and the
                // await never settles
                if (typeof key !== 'string' || key === 'then') {
                    return undefined;
                }
                return make_chain(root, [...path, key]);
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
