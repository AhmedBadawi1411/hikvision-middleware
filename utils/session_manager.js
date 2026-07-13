const { default: axios } = require("axios")
const { config } = require("../config/config.js")
const asyncHandler = require("./asyncHandler.js")

let odooSessionId = null;

async function loginToOdoo() {
    try {
        const response = await axios.post(config.ODOO_URL + "/web/session/authenticate", {
            jsonrpc: "2.0",
            params: {
                db: config.ODOO_DB,
                login: config.ODOO_USER,
                password: config.ODOO_PASS
            }
        });
        if (response.data.result) {
            odooSessionId = response.data.result.session_id;

            console.log(
                response.headers['set-cookie']
            );

            if (!odooSessionId && response.headers['set-cookie']) {
                const cookie = response.headers['set-cookie'][0];
                const match = cookie.match(/session_id=([^;]+)/);
                if (match) {
                    odooSessionId = match[1];
                }
            }

            if (odooSessionId) {
                console.log("Logged into Odoo successfully!");
            } else {
                console.error("Logged in but couldn't find session_id in response.");
            }
        }
    } catch (error) {
        console.error("Odoo Login Failed:", error.message);
    }
}

async function makeCheckIn(payload) {
    if (!odooSessionId) await loginToOdoo();

    payload = _buildOdooPayload(payload);

    try {
        const response = await axios.post(`${config.ODOO_URL}/api/attendance/import`, {
            // jsonrpc: "2.0",
            // params: {...payload}
            ...payload
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'Cookie': `session_id=${odooSessionId}`,
                // 'X-Openerp-Session-Id': odooSessionId 
            }
        });

        if (response.data.error && response.data.error.data.message.includes("Session expired")) {
            odooSessionId = null;
            return makeCheckIn(payload);
        }

        console.log("Data synced to Odoo:", response.data.result || "Success");
    } catch (error) {
        console.error("Sync Error:", error.message);
    }
}

async function makeCheckOut(payload) {
    if (!odooSessionId) await loginToOdoo();

    try {
        const response = await axios.post(`${config.ODOO_URL}/api/attendance/import`, {
            ...payload
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'Cookie': `session_id=${odooSessionId}`,
            }
        });

        if (response.data.error && response.data.error.data.message.includes("Session expired")) {
            odooSessionId = null;
            return makeCheckOut(payload);
        }

        console.log("Check Out Data synced to Odoo:", response.data.result || "Success");
    } catch (error) {
        console.error("Sync Error:", error.message);
    }
}

function _buildOdooPayload(payload) {
    payload = {
        [payload["empId"]]: {
            ...payload
        }
    };
    return payload;
}

function _buildAttendanceData(docs) {
    const formattedData = docs.reduce((acc, curr) => {
        acc[curr.empId] = {
            name: curr.name,
            firstIn: curr.firstIn,
            lastSeen: curr.lastSeen,
            date: curr.date,
            deviceMac: curr.deviceMac || "",
            deviceIp: curr.deviceIp || "",
        };
        return acc;
    }, {});

    return formattedData || {}
}
module.exports = { makeCheckIn, _buildAttendanceData, makeCheckOut }