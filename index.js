const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

const logToFile = (fileName, data) => {
  const logPath = path.join(__dirname, fileName);
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] - ${JSON.stringify(data)}\n`;

  fs.appendFile(logPath, logEntry, (err) => {
    if (err) console.error("فشل الكتابة في ملف اللوج:", err);
  });
};

app.post("/hikvision/event", (req, res) => {
  try {
    const eventData = req.body;
    console.log("حدث جديد مستلم:", eventData);
    logToFile("access.log", {
      status: "SUCCESS",
      payload: eventData,
    });
    res.status(200).send("Event Received");
  } catch (error) {
    console.error("خطأ في معالجة الحدث:", error.message);
    logToFile("error.log", {
      status: "ERROR",
      message: error.message,
      stack: error.stack,
      receivedBody: req.body,
    });

    res.status(500).send("Internal Server Error");
  }
});

app.get("/ping", (req, res)=>{
        console.log("I am working...");
        logToFile("access.log", {status:"SUCCESS", payload:"PONG"})
        res.status(200).send("PONG");
});

app.listen(3000, "127.0.0.1", () => {
  console.log("APP IS RUNNING ON: http://localhost:3000");
});
