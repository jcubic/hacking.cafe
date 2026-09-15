    if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
        const args = {{ARGS}};
        const code = await main(...args);
        self.postMessage({ exit: code });
        self.close();
    }
} catch (error) {
    await __modules__.stderr.writeln(error.message);
    self.postMessage({ exit: 100 });
    self.close();
}
