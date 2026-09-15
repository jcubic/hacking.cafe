const __modules__ = (() => {
    const bs = new BroadcastChannel('__ipc__');

    let rprc_id = 0;

    return new Proxy({}, {
        get(target, namespace) {
            return new Proxy({}, {
                get(target, name) {
                    return (...args) => {
                        return new Promise((resolve, reject) => {
                            const id = ++rprc_id;
                            const method = name;
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
                            bs.postMessage({
                                id,
                                namespace,
                                method,
                                args
                            });
                        });
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
