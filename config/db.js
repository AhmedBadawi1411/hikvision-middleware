const Datastore = require('@seald-io/nedb');
const client = new Datastore({filename:"./database/attendence_cache.db", autoload: true});

async function connectToDB() {
    try {
        await client.loadDatabaseAsync();
        console.log("DB => Database Connection Success");
    } catch (error) {
        console.log("DB => AN ERROR OCCURED WILL CONNECTING TO DATASTORE: ", error.message);
    }
}

module.exports = {connectToDB,client}