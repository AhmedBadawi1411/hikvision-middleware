const cron = require('node-cron');
const cacheClient = require("../config/db");
const odooClient = require("./session_manager");
const compactDB = require("./databaseCompactor");

cron.schedule("0 16 * * *", async () => {
    console.log("Sync attendance cache...");

    try {
        await compactDB("./database/attendence_cache.db");
        console.log("Compact done");

        const docs = await cacheClient.client.findAsync({});
        if (!docs.length) {
            console.log("No cache data to sync");
            return;
        }

        const formattedData = odooClient._buildAttendanceData(docs);
        console.log(formattedData);

        const syncResult = await odooClient.makeCheckOut(formattedData);
        if (!syncResult.ok) {
            console.error("Cache Sync failed - data kept for retry");
            return;
        }

        const removed = await odooClient.removeSuccessfulFromCache(
            cacheClient.client,
            syncResult.succeededDeviceIds,
            formattedData
        );
        await compactDB("./database/attendence_cache.db");

        console.log(
            `Cache Synced: removed=${removed}, succeeded=${syncResult.succeededDeviceIds.length}, failed=${syncResult.failed.length}`
        );
        if (syncResult.failed.length) {
            console.warn("Per-employee sync failures:", syncResult.failed);
        }
    } catch (error) {
        console.error("Error syncing cache:", error);
    }
}, {
    scheduled: true,
    timezone: "Africa/Tripoli"
});
