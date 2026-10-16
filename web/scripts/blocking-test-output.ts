// Loaded into every test file's process by npm test and npm run test:browser (--import). Each
// file runs in a process of its own, which sends its results to the runner through a pipe, and
// --test-force-exit ends it the moment its last test ends, so that a test left waiting can't
// stall the run. But on macOS a pipe is written to in the background: results still on their way
// were lost, and the run counted fewer tests, with none failed (270 of 303 once). Written at once
// instead, nothing is left to lose. Node has no public way to ask for this.
const output = process.stdout as unknown as { _handle?: { setBlocking?(blocking: boolean): void } }
output._handle?.setBlocking?.(true)
