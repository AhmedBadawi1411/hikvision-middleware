const { default: axios } = require("axios")
const { config } = require("../config/config.js")

let odooSessionId = null;

const SUCCESS_STATUSES = new Set([
    "check_in_created",
    "check_out_updated",
]);

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

function _parseSyncResult(result) {
    const rows = Array.isArray(result?.data) ? result.data : [];
    const succeededDeviceIds = [];
    const failed = [];

    for (const row of rows) {
        const deviceId = row?.device_id;
        const status = row?.status;
        if (!deviceId) {
            continue;
        }
        if (SUCCESS_STATUSES.has(status)) {
            succeededDeviceIds.push(String(deviceId));
        } else {
            failed.push({ device_id: String(deviceId), status: status || "unknown" });
        }
    }

    return { succeededDeviceIds, failed, rows };
}

async function makeCheckIn(payload) {
    if (!odooSessionId) await loginToOdoo();

    payload = _buildOdooPayload(payload);

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

        if (response.data.error) {
            if (response.data.error.data && response.data.error.data.message && response.data.error.data.message.includes("Session expired")) {
                odooSessionId = null;
                return makeCheckIn(payload);
            }
            console.error("Odoo returned error:", response.data.error);
            return { ok: false, succeededDeviceIds: [], failed: [], rows: [] };
        }

        const parsed = _parseSyncResult(response.data.result);
        if (parsed.failed.length) {
            console.warn("Check-in soft failures:", parsed.failed);
        } else {
            console.log("Data synced to Odoo:", response.data.result || "Success");
        }
        return { ok: true, ...parsed };
    } catch (error) {
        console.error("Sync Error:", error.message);
        return { ok: false, succeededDeviceIds: [], failed: [], rows: [] };
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

        if (response.data.error) {
            if (response.data.error.data && response.data.error.data.message && response.data.error.data.message.includes("Session expired")) {
                odooSessionId = null;
                return makeCheckOut(payload);
            }
            console.error("Odoo returned error:", response.data.error);
            return { ok: false, succeededDeviceIds: [], failed: [], rows: [] };
        }

        const parsed = _parseSyncResult(response.data.result);
        console.log("Check Out Data synced to Odoo:", response.data.result || "Success");
        if (parsed.failed.length) {
            console.warn("Per-employee sync failures (kept in cache):", parsed.failed);
        }
        return { ok: true, ...parsed };
    } catch (error) {
        console.error("Sync Error:", error.message);
        return { ok: false, succeededDeviceIds: [], failed: [], rows: [] };
    }
}

async function removeSuccessfulFromCache(cacheClient, succeededDeviceIds) {
    let removed = 0;
    for (const deviceId of succeededDeviceIds) {
        const count = await cacheClient.removeAsync(
            { empId: String(deviceId) },
            { multi: true }
        );
        removed += count || 0;
    }
    return removed;
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

module.exports = {
    makeCheckIn,
    makeCheckOut,
    _buildAttendanceData,
    removeSuccessfulFromCache,
    SUCCESS_STATUSES,
}
