// const corn = require("node-cron");
// const cacheClient = require("../config/db");

// corn.schedule("05 * * * *", async () => {
//     try {
//         await cacheClient.client.compactDatafile();
//         console.log("SUC => Database Compacted Successfuly!");
//     } catch (error) {
//         console.log("ERR => An Error Occured Will Compacting Database: ", error.message);
//     }
// });

const { Worker } = require("worker_threads");
const path = require("path");

function compactDB(dbPath) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            path.join(__dirname, "compactWorker.js"),
            { workerData: { dbPath } }
        );
        worker.on("message", resolve);
        worker.on("error", reject);
    });
}

module.exports = compactDB;