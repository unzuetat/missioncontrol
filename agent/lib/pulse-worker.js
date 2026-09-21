// Hilo de trabajo para calcular el pulso git de un repo en paralelo.
// Lo lanza collectPulse (agent/pulse.js) con worker_threads.
import { parentPort, workerData } from "node:worker_threads";
import { gitPulse } from "./git.js";

try {
  parentPort.postMessage({ ok: true, pulse: gitPulse(workerData.dir, workerData.meta || {}) });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err?.message || String(err) });
}
