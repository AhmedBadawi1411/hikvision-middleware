// require('./utils/eventLoopMonitor')();
require('./utils/prioritySetter');
// require("./utils/cacheCleaner");
// require("./utils/syncCheckout");
require("./utils/databaseCompactor");

const messages = require('./utils/messages');
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const cache = require("./config/db");
const odooClient = require("./utils/session_manager");
const compactDB = require("./utils/databaseCompactor");

const app = express();

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

(async () => {
  await cache.connectToDB();
})()

// cache.client.setAutocompactionInterval(1000 * 60 * 60);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const IMAGE_DIR = './captured_images';
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR);

const saveImage = (buffer, fileName) => {
  fs.writeFileSync(path.join(IMAGE_DIR, fileName), buffer);
};


const logToFile = (fileName, data) => {
  const logPath = path.join(__dirname, fileName);
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] - ${JSON.stringify(data)}\n`;

  fs.appendFile(logPath, logEntry, (err) => {
    if (err) console.error("Log write failed", err);
  });

};


let counter = 0;
const allowedEvents = [75, 38];

app.post("/hikvision/event", upload.any(), async (req, res) => {
  counter++;
  console.log(`${counter}Request Received from Device!`);

  try {
    let eventData;
    if (req.body && req.body.event_log) {
      eventData = typeof req.body.event_log === 'string'
        ? JSON.parse(req.body.event_log)
        : req.body.event_log;
    } else {
      eventData = req.body;
    }

    logToFile("events.log", {
      method: req.method,
      url: req.originalUrl,
      body: req.body,
      eventLog: req.body.event_log,
      eventData: eventData,
      eventDetails: eventData.AccessControllerEvent,
      subType: eventData?.AccessControllerEvent?.subEventType,
      deviceIp: eventData.ipAddress,
      deviceMac: eventData.macAddress
    });


    const eventDetails = eventData.AccessControllerEvent;
    const subType = eventDetails?.subEventType;
    const deviceTime = eventData.dateTime || "No Time Found";
    const serverTime = new Date().toLocaleString('ar-LY');
    const deviceMac = eventData.macAddress;
    const deviceIp = eventData.ipAddress;

    console.log(deviceMac);
    console.log(deviceIp);

    if (allowedEvents.includes(subType)) {

      const empId = eventDetails.employeeNoString;
      const personName = eventDetails.name || "Unknown";
      const today = new Date().toDateString();

      const imageFile = req.files && req.files.find(f =>
        f.fieldname.toLowerCase().includes('picture') ||
        f.fieldname.toLowerCase().includes('face') ||
        f.mimetype === 'image/jpeg'
      );

      const empDoc = await cache.client.findOneAsync({
        empId: empId,
        deviceMac: deviceMac,
        date: today
      });

      console.log(`-----------------------------------`);
      console.log(`[Authenticated]: ${personName}`);
      console.log(`Device Time (Original): ${deviceTime}`);
      console.log(`Server Time (Received): ${serverTime}`);
      console.log(`-----------------------------------`);


      if (!empDoc) {

        const newRecord = {
          empId,
          name: personName,
          firstIn: deviceTime,
          lastSeen: deviceTime,
          date: today,
          deviceMac: deviceMac,
          deviceIp: deviceIp,
        };

        await cache.client.insertAsync(newRecord);
        await odooClient.makeCheckIn(newRecord);

        if (imageFile) {
          const fileName = `FirstIn_ID-${empId}_${Date.now()}.jpg`;
          saveImage(imageFile.buffer, fileName);
          console.log(`[Saved First-In Photo]: ${personName}`);
        }

        console.log(`[FIRST IN]: ${personName} (ID: ${empId})`);
        logToFile("daily_summary.log", { status: "FIRST_IN", ...newRecord });

      } else {

        await cache.client.updateAsync({ _id: empDoc._id }, {
          $set: {
            lastSeen: deviceTime
          }
        });
        console.log(`[UPDATE LAST]: ${personName} (ID: ${empId})`);

        if (imageFile) {
          const fileName = `LastOut_ID-${empId}.jpg`;
          saveImage(imageFile.buffer, fileName);
        }
      }

      logToFile("attendance.log", {
        deviceTime,
        serverTime,
        name: personName,
        id: eventDetails.employeeNoString
      });
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Error:", error.message);
    res.status(200).send("OK");
  }

});


app.get("/ping", (req, res) => {
  console.log("I am working...");
  res.status(200).send("PONG");
});


app.get("/getAll", async (req, res) => {
  await compactDB("./database/attendence_cache.db");
  console.log("Compact done");
  const docs = await cache.client.findAsync({});

  const formattedData = odooClient._buildAttendanceData(docs);
  res.status(200).json(formattedData);

});

app.get("/api/v1/getAttendenceData", async (req, res) => {
  try {
    await compactDB("./database/attendence_cache.db");
    console.log("Compact done");

    const docs = await cache.client.findAsync({});
    const formattedData = odooClient._buildAttendanceData(docs);
    const syncSuccess = await odooClient.makeCheckOut(formattedData);
    
    if (syncSuccess) {
      await cache.client.removeAsync({}, { multi: true });
      await compactDB("./database/attendence_cache.db");
      console.log("Cache cleared successfully");
      return res.status(200).json({ "STATUS": "SUCCESS", "CODE": 200, "MSG": "DATA COMPACTED AND SYNCED TO ODOO SUCCESSFULY." });
    } else {
      console.error("Sync to Odoo failed - cache not cleared");
      return res.status(500).json({ "STATUS": "FAILED", "CODE": 500, "MSG": "AN ERROR OCCURED WILL SYNC TO ODOO." });
    }
  } catch (error) {
    console.error("Error in sync process:", error);
    return res.status(500).json({ "STATUS": "FAILED", "CODE": 500, "MSG": "AN ERROR OCCURED WILL SYNC TO ODOO." });
  }
});

app.get("/api/v1/checkin", async (req, res) => {
  try {
    const { empId, lang = "ar" } = req.query;

    if (!empId) {
      return res.status(400).json({
        "STATUS": "FAILED",
        "MSG": messages.getMessage(lang, "FAILED")
      });
    }


    const today = new Date().toDateString();

    const empDoc = await cache.client.findOneAsync({
      empId: empId,
      date: today
    });

    if (!empDoc) {
      return res.status(204).json({
        "STATUS": "NOT_FOUND",
        "MSG": messages.getMessage(lang, "NOT_FOUND")
      });
    }

    const checkInTime = empDoc.firstIn.split('T')[1].split('+')[0];

    let attendanceStatus = "ON_TIME";

    if (checkInTime > "09:31:00") {
      attendanceStatus = "ABSENCE";
    } else if (checkInTime > "09:16:00") {
      attendanceStatus = "LATE";
    }

    const statusTexts = {
      "ON_TIME": { ar: "في الموعد", en: "On Time" },
      "LATE": { ar: "حضور متأخر", en: "Late Arrival" },
      "ABSENCE": { ar: "غياب", en: "Absence" }
    };

    return res.status(200).json({
      "STATUS": "SUCCESS",
      "DATA": {
        "employee_id": empDoc.empId,
        "name": empDoc.name,
        "first_in": empDoc.firstIn,
        "status_key": attendanceStatus,
        "status_text": statusTexts[attendanceStatus][lang],
        "device_mac": empDoc.deviceMac,
        "date": empDoc.date
      }
    });
  } catch (error) {
    console.error("Error fetching specific check-in:", error);
    return res.status(500).json({ "STATUS": "ERROR", "MSG": error.message });
  }
});

app.listen(3000, () => {
  console.log("Server running on: http://localhost:3000");
}); 