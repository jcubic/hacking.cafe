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
        return JSON.parse(string);
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

    function call(namespace, args, method = null) {
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
                namespace,
                method,
                args
            });
            channel.postMessage(payload);
        });
    }

    return new Proxy({}, {
        get(target, namespace) {
            return new Proxy(() => {}, {
                apply(target, thisArg, args) {
                    return call(namespace, args);
                },
                get(target, method) {
                    return (...args) => {
                        return call(namespace, args, method);
                    };
                }
            });
        }
    });
})();

function require(module) {
  return __modules__[module];
}

try {

{{CODE}}

    const args = {{ARGS}};
    const code = await main(...args);
    self.postMessage({ exit: code });
    self.close();
} catch (error) {
    await __modules__.stderr.writeln(error.message);
    self.postMessage({ exit: 100 });
    self.close();
}
