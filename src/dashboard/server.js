const express = require('express');

function startDashboard(port, store, config) {
    const app = express();

    app.use(express.static('public'));

    app.get('/api/stats', async (req, res) => {
        let stats = {};
        if (store.getStats) {
            stats = await store.getStats();
        }
        res.json({
            status: 'online',
            db_type: config.storeDB.type,
            auth_type: config.auth.method,
            login_type: config.login.type,
            stats: stats
        });
    });

    app.get('/', (req, res) => {
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>EchoFox Dashboard</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #121212; color: #fff; margin: 0; padding: 20px; }
                h1 { text-align: center; color: #12c2e9; }
                .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; max-width: 1000px; margin: 0 auto; }
                .card { background: #1e1e1e; padding: 20px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); text-align: center; }
                .card h3 { margin: 0 0 10px 0; color: #c471ed; font-size: 1.2rem; }
                .card .value { font-size: 2rem; font-weight: bold; }
                .footer { text-align: center; margin-top: 40px; color: #888; }
            </style>
        </head>
        <body>
            <h1>EchoFox Dashboard</h1>
            <div class="grid" id="stats-grid">
                Loading...
            </div>
            <div class="footer">Auto-updating every 5 seconds</div>

            <script>
                async function fetchStats() {
                    try {
                        const res = await fetch('/api/stats');
                        const data = await res.json();
                        const stats = data.stats || {};
                        
                        document.getElementById('stats-grid').innerHTML = \`
                            <div class="card"><h3>Status</h3><div class="value" style="color: #45B649">Online</div></div>
                            <div class="card"><h3>DB Type</h3><div class="value" style="font-size: 1.5rem;">\${data.db_type}</div></div>
                            <div class="card"><h3>Auth Type</h3><div class="value" style="font-size: 1.5rem;">\${data.auth_type}</div></div>
                            <div class="card"><h3>Bot Restarts</h3><div class="value">\${stats.bot_restarts || 0}</div></div>
                            <div class="card"><h3>Incoming Messages</h3><div class="value">\${stats.incoming_messages || 0}</div></div>
                            <div class="card"><h3>Messages Processed</h3><div class="value">\${stats.messages_processed || 0}</div></div>
                            <div class="card"><h3>Database Writes</h3><div class="value">\${stats.db_writes || 0}</div></div>
                        \`;
                    } catch (e) {
                        console.error(e);
                    }
                }
                fetchStats();
                setInterval(fetchStats, 5000);
            </script>
        </body>
        </html>
        `);
    });

    app.listen(port, () => {
        console.log(`[dashboard] running on http://localhost:${port}`);
    }).on('error', (e) => {
        console.error(`[dashboard] port ${port} is busy or failed to start:`, e.message);
    });
}

module.exports = { startDashboard };