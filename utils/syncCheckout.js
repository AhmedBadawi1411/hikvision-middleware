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
        const formattedData = odooClient._buildAttendanceData(docs);
        console.log(formattedData);
        
        const syncSuccess = await odooClient.makeCheckOut(formattedData);
        if (syncSuccess) {
            console.log("Cache Synced successfully");
        } else {
            console.error("Cache Sync failed - data kept for retry");
        }
    } catch (error) {
        console.error("Error syncing cache:", error);
    }
}, {
    scheduled: true,
    timezone: "Africa/Tripoli"
});
