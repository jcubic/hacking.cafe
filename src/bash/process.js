const __modules__ = (() => {
    const channel = new BroadcastChannel(`__ipc__:{{PID}}`);

    let rprc_id = 0;

    function call(namespace, args, method = null) {
        return new Promise((resolve, reject) => {
            const id = ++rprc_id;
            channel.addEventListener('message', function handler({ data }) {
                if (data.id === id) {
                    if (data.error) {
                        reject(data.error);
                    } else {
                        resolve(data.result);
                    }
                    channel.removeEventListener('message', handler);
                }
            });
            const payload = {
                id,
                namespace,
                method,
                args
            };
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
