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
        
        await odooClient.makeCheckOut(formattedData);
        console.log("Cache Synced successfully");
    } catch (error) {
        console.error("Error syncing cache:", error);
    }
}, {
    scheduled: true,
    timezone: "Africa/Tripoli"
});
