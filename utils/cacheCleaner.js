const cron = require('node-cron');
const cacheClient = require("../config/db");
const odooClient = require("./session_manager");
const compactDB = require("./databaseCompactor");

cron.schedule("0 23 * * *", async () => {
    console.log("Clearing attendance cache...");
    console.log("Current Server Time:", new Date().toString());
    try {
        await compactDB("./database/attendence_cache.db");
        console.log("Compact done");

        const docs = await cacheClient.client.findAsync({});
        if (!docs.length) {
            console.log("No cache data to sync");
            return;
        }

        const formattedData = odooClient._buildAttendanceData(docs);
        const syncResult = await odooClient.makeCheckOut(formattedData);

        if (!syncResult.ok) {
            console.error("Cache Sync failed - cache not cleared, data kept for retry");
            return;
        }

        const removed = await odooClient.removeSuccessfulFromCache(
            cacheClient.client,
            syncResult.succeededDeviceIds,
            formattedData
        );
        await compactDB("./database/attendence_cache.db");
        console.log(
            `Selective cache clear: removed=${removed}, succeeded=${syncResult.succeededDeviceIds.length}, failed=${syncResult.failed.length}`
        );
        if (syncResult.failed.length) {
            console.warn("Failed employees kept in cache:", syncResult.failed);
        }
    } catch (error) {
        console.error("Error clearing cache:", error);
    }
}, {
});
