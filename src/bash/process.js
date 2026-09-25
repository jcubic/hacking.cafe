// Prelude wrapped around every user script run as a process. The placeholders
// are filled in by Bash::process().
//
// This worker is created from a Blob URL, so mitty cannot be bundled into it -
// it is copied to the web root by vite.config.ts and pulled in at runtime. The
// IIFE build exposes a `Mitty` global.
//
// The URL has to be absolute: a blob: URL has an opaque path, so a root
// relative '/mitty.js' has nothing to resolve against and importScripts()
// rejects it. Bash::process() substitutes the origin.
importScripts('{{MITTY}}');

// modules live on the main thread; require() hands back a proxy that records a
// chain of property accesses and calls, and sends the whole chain in one
// message when it is awaited. The channel is keyed by pid so concurrent or
// nested workers never share one - their request ids would collide.
const { require } = Mitty.connect(self);

{
    {{CODE}}

    const args = {{ARGS}};
    (async () => {
        const code = (await main(...args)) ?? 0;
        self.postMessage({ exit: code });
        self.close();
    })().catch(async error => {
        await require('stderr').writeln(error.message);
        self.postMessage({ exit: 100 });
        self.close();
    });
}
