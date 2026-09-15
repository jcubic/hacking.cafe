    if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
        const exit = (code) => {
            self.postMessage({ exit: code });
            self.close();
        };
        const args = {{ARGS}};
        main(...args).then(exit).catch(async error => {
            await __modules__.stdout.writeln(error.message);
            exit(100);
        });
    }
} catch (error) {
    await __modules__.stdout.writeln(error.message);
    self.postMessage({ exit: 200 });
    self.close();
}
