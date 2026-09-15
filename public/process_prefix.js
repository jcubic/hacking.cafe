const __modules__ = (() => {
    const bs = new BroadcastChannel('__ipc__');

    let rprc_id = 0;

    function call(namespace, args, method = null) {
        return new Promise((resolve, reject) => {
            const id = ++rprc_id;
            bs.addEventListener('message', function handler({data}) {
                if (data.id === id) {
                    if (data.error) {
                        reject(data.error);
                    } else {
                        resolve(data.result);
                    }
                    bs.removeEventListener('message', handler);
                }
            });
            const payload = {
                id,
                namespace,
                method,
                args
            };
            bs.postMessage(payload);
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
