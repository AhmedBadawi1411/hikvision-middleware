const { default: axios } = require("axios")
const { config } = require("../config/config.js")

let odooSessionId = null;

// Statuses that mean checkout reached Odoo — safe to drop cache for that employee.
// Do NOT include check_in_created: morning-only sync must keep the row so later
// lastSeen (checkout) can still be sent at end of day.
const CACHE_CLEAR_STATUSES = new Set([
    "check_in_and_checkout_created",
    "check_out_updated",
]);

// Soft success / informational — keep in cache for a later checkout sync.
const CACHE_KEEP_STATUSES = new Set([
    "check_in_created",
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
    const keptDeviceIds = [];
    const failed = [];

    for (const row of rows) {
        const deviceId = row?.device_id;
        const status = row?.status;
        if (!deviceId) {
            continue;
        }
        if (CACHE_CLEAR_STATUSES.has(status)) {
            succeededDeviceIds.push(String(deviceId));
        } else if (CACHE_KEEP_STATUSES.has(status)) {
            keptDeviceIds.push(String(deviceId));
        } else {
            failed.push({ device_id: String(deviceId), status: status || "unknown" });
        }
    }

    return { succeededDeviceIds, keptDeviceIds, failed, rows };
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
        if (parsed.keptDeviceIds.length) {
            console.log(
                "Check-in created in Odoo; cache kept for later checkout:",
                parsed.keptDeviceIds
            );
        }
        if (parsed.failed.length) {
            console.warn("Check-in soft failures:", parsed.failed);
        } else if (!parsed.keptDeviceIds.length) {
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
        if (parsed.keptDeviceIds.length) {
            console.log(
                "Check-in-only responses; cache kept for later checkout:",
                parsed.keptDeviceIds
            );
        }
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

function _punchTs(value) {
    if (!value) {
        return null;
    }
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : ts;
}

/**
 * Build one Odoo row per empId.
 * If multiple NeDB docs exist for the same employee (e.g. legacy
 * empId+deviceMac+date rows), merge: earliest firstIn + latest lastSeen.
 */
function _buildAttendanceData(docs) {
    const formattedData = {};

    for (const curr of docs || []) {
        const empId = curr?.empId;
        if (!empId) {
            continue;
        }

        const existing = formattedData[empId];
        if (!existing) {
            formattedData[empId] = {
                name: curr.name,
                firstIn: curr.firstIn,
                lastSeen: curr.lastSeen || curr.firstIn,
                date: curr.date,
                deviceMac: curr.deviceMac || "",
                deviceIp: curr.deviceIp || "",
            };
            continue;
        }

        const currFirstTs = _punchTs(curr.firstIn);
        const existFirstTs = _punchTs(existing.firstIn);
        if (currFirstTs !== null && (existFirstTs === null || currFirstTs < existFirstTs)) {
            existing.firstIn = curr.firstIn;
            if (curr.date) {
                existing.date = curr.date;
            }
        }

        const currLastTs = _punchTs(curr.lastSeen || curr.firstIn);
        const existLastTs = _punchTs(existing.lastSeen || existing.firstIn);
        if (currLastTs !== null && (existLastTs === null || currLastTs > existLastTs)) {
            existing.lastSeen = curr.lastSeen || curr.firstIn;
            // Prefer MAC/IP from the latest punch device
            if (curr.deviceMac) {
                existing.deviceMac = curr.deviceMac;
            }
            if (curr.deviceIp) {
                existing.deviceIp = curr.deviceIp;
            }
        }

        if (curr.name) {
            existing.name = curr.name;
        }
    }

    return formattedData;
}

module.exports = {
    makeCheckIn,
    makeCheckOut,
    _buildAttendanceData,
    removeSuccessfulFromCache,
    CACHE_CLEAR_STATUSES,
    CACHE_KEEP_STATUSES,
}
