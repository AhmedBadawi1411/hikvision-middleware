const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function startMonitor(thresholdMs = 500) {
    let last = Date.now();

    setInterval(() => {
        const now = Date.now();
        const lag = now - last - 1000;

        if (lag > thresholdMs) {
            let topProcesses = [];
            try {
                const result = execSync(
                    'powershell "Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 Name, CPU, WorkingSet | ConvertTo-Json"',
                    { timeout: 3000 }
                ).toString();
                topProcesses = JSON.parse(result);
            } catch (e) {
                topProcesses = ["Could not fetch processes: " + e.message];
            }

            const entry = {
                time: new Date().toISOString(),
                lag: `${lag}ms`,
                system: {
                    loadAverage: os.loadavg(),
                    freeMem: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
                    totalMem: `${Math.round(os.totalmem() / 1024 / 1024)}MB`,
                    cpuCount: os.cpus().length,
                },
                process: {
                    cpuUsage: process.cpuUsage(),
                    memoryUsage: process.memoryUsage(),
                    uptime: process.uptime(),
                },
                topProcesses,
            };

            console.warn(`[EventLoopMonitor] LAG DETECTED: ${lag}ms at ${entry.time}`);
            fs.appendFileSync(
                path.join(__dirname, '../event_loop.log'),
                JSON.stringify(entry, null, 2) + '\n---\n'
            );
        }

        last = now;
    }, 1000);
}

module.exports = startMonitor;