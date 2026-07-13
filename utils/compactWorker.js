const { workerData, parentPort } = require("worker_threads");
const Datastore = require("@seald-io/nedb");

const db = new Datastore({ filename: workerData.dbPath, autoload: true });

db.compactDatafile();

db.on("compaction.done", () => {
    parentPort.postMessage({ success: true });
    process.exit(0);
});