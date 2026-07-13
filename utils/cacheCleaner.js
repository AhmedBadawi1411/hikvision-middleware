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
        const formattedData = odooClient._buildAttendanceData(docs);
        const syncSuccess = await odooClient.makeCheckOut(formattedData);
        
        if (syncSuccess) {
            await cacheClient.client.removeAsync({}, { multi: true });
            await compactDB("./database/attendence_cache.db");
            console.log("Cache cleared successfully");
        } else {
            console.error("Cache Sync failed - cache not cleared, data kept for retry");
        }
    } catch (error) {
        console.error("Error clearing cache:", error);
    }
}, {
});
