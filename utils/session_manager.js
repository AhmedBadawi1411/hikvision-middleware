const { default: axios } = require("axios")
const { config } = require("../config/config.js")

let odooSessionId = null;

// Checkout confirmed in Odoo → safe to remove that employee day from cache.
// Do NOT clear on check_in_created: morning-only sync must keep the row for later lastSeen.
const CACHE_CLEAR_STATUSES = new Set([
    "check_in_and_checkout_created",
    "check_out_updated",
]);

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

function _emptySyncResult() {
    return { ok: false, succeededDeviceIds: [], keptDeviceIds: [], failed: [], rows: [] };
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
            return _emptySyncResult();
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
        return _emptySyncResult();
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
            return _emptySyncResult();
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
        return _emptySyncResult();
    }
}

/**
 * Remove only employees whose checkout sync succeeded.
 * If syncedPayload has date, limit delete to that day (keeps other days for retry).
 */
async function removeSuccessfulFromCache(cacheClient, succeededDeviceIds, syncedPayload = null) {
    let removed = 0;
    for (const deviceId of succeededDeviceIds) {
        const query = { empId: String(deviceId) };
        const row = syncedPayload && syncedPayload[deviceId];
        if (row && row.date) {
            query.date = row.date;
        }
        const count = await cacheClient.removeAsync(query, { multi: true });
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

function _toRow(doc) {
    return {
        empId: doc.empId,
        name: doc.name,
        firstIn: doc.firstIn,
        lastSeen: doc.lastSeen || doc.firstIn,
        date: doc.date,
        deviceMac: doc.deviceMac || "",
        deviceIp: doc.deviceIp || "",
    };
}

/**
 * Merge two cache docs for the SAME employee + SAME day:
 * firstIn = earliest punch, lastSeen = latest punch.
 */
function _mergeSameDay(a, b) {
    const merged = { ...a };

    const aFirst = _punchTs(a.firstIn);
    const bFirst = _punchTs(b.firstIn);
    if (bFirst !== null && (aFirst === null || bFirst < aFirst)) {
        merged.firstIn = b.firstIn;
    }

    const aLast = _punchTs(a.lastSeen || a.firstIn);
    const bLast = _punchTs(b.lastSeen || b.firstIn);
    if (bLast !== null && (aLast === null || bLast > aLast)) {
        merged.lastSeen = b.lastSeen || b.firstIn;
        if (b.deviceMac) {
            merged.deviceMac = b.deviceMac;
        }
        if (b.deviceIp) {
            merged.deviceIp = b.deviceIp;
        }
    }

    if (b.name) {
        merged.name = b.name;
    }
    return merged;
}

/**
 * Build one Odoo row per empId.
 * 1) Merge all NeDB docs for the same empId + date (fixes multi-device duplicates).
 * 2) If multiple days exist for one empId, prefer the day with the latest lastSeen
 *    so we never mix punches from different days into one row.
 */
function _buildAttendanceData(docs) {
    const byEmpDay = {};

    for (const curr of docs || []) {
        const empId = curr?.empId;
        if (!empId) {
            continue;
        }
        const day = curr.date || "";
        const key = `${empId}||${day}`;
        const row = _toRow(curr);

        if (!byEmpDay[key]) {
            byEmpDay[key] = row;
        } else {
            byEmpDay[key] = _mergeSameDay(byEmpDay[key], row);
        }
    }

    const formattedData = {};
    for (const merged of Object.values(byEmpDay)) {
        const empId = merged.empId;
        const existing = formattedData[empId];
        if (!existing) {
            formattedData[empId] = {
                name: merged.name,
                firstIn: merged.firstIn,
                lastSeen: merged.lastSeen,
                date: merged.date,
                deviceMac: merged.deviceMac || "",
                deviceIp: merged.deviceIp || "",
            };
            continue;
        }

        // Different calendar days for same empId: keep the day with latest lastSeen
        const existLast = _punchTs(existing.lastSeen || existing.firstIn);
        const mergedLast = _punchTs(merged.lastSeen || merged.firstIn);
        if (mergedLast !== null && (existLast === null || mergedLast >= existLast)) {
            formattedData[empId] = {
                name: merged.name,
                firstIn: merged.firstIn,
                lastSeen: merged.lastSeen,
                date: merged.date,
                deviceMac: merged.deviceMac || "",
                deviceIp: merged.deviceIp || "",
            };
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
