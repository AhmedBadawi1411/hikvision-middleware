const os = require("os");

try {
    os.setPriority(process.pid, os.constants.priority.PRIORITY_HIGH);
    console.log("NODE PRIORITY SETED TO HIGH");

} catch (error) {
    console.log("PRIORITTY SETTER CREASED BECASUE: ", error);
}