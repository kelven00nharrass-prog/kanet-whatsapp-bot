
function getRecentBotLogs() {
  try {
    const logPath = path.join(ROOT_DIR, 'bot_log.txt');
    if (!fs.existsSync(logPath)) return ['[SYSTEM] Bot iniciado. Sem ficheiro de log ainda.'];
    const stats = fs.statSync(logPath);
    const readSize = Math.min(stats.size, 4096);
    const buffer = Buffer.alloc(readSize);
    const fd = fs.openSync(logPath, 'r');
    fs.readSync(fd, buffer, 0, readSize, stats.size - readSize);
    fs.closeSync(fd);
    const lines = buffer.toString('utf-8').split('\n').filter(l => l.strip ? l.strip() : l.trim());
    return lines.slice(-12);
  } catch(e) {
    return ['[LOG READ ERROR] ' + e.message];
  }
}


// ════════════════════════════════════════════════════════════════
// KA-NET CLOUD SYNC  — copiar para Kelven System/
// Adicionar ao kanet-loader.js:  require('./cloud_sync_admin');
// ════════════════════════════════════════════════════════════════
const axios   = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');
const { exec } = require('child_process');

const CLOUD_URL = process.env.CLOUD_URL || 'https://kanet-cloud-api-v0gg.onrender.com';
const DB_PATH   = path.join(__dirname, 'referencias.db');
const ROOT_DIR  = __dirname;
const SESSION_DIR = path.join(ROOT_DIR, '_IGNORE_MEF_INSTANT');

function queryDb(sql, params = []) {
  return new Promise((resolve) => {
    if (!fs.existsSync(DB_PATH)) return resolve([]);
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
    db.all(sql, params, (err, rows) => { db.close(); resolve(err ? [] : (rows || [])); });
  });
}

// ── Enviar heartbeat e sincronizar dados ───────────────────────
async function syncToCloud() {
  try {
    const now  = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekAgo  = new Date(now - 7  * 86400000).toISOString().slice(0,10);
    const monthAgo = new Date(now - 30 * 86400000).toISOString().slice(0,10);

    const [todaySales, weekSales, monthSales, recentSales] = await Promise.all([
      queryDb(`SELECT COUNT(*) c, SUM(COALESCE(valor,0)) v, SUM(COALESCE(quantidade,0)) m FROM referencias WHERE created_at >= ? AND status IN ('concluido','realizado','sucesso','COMPLETED','finalizado')`, [`${today} 00:00:00`]),
      queryDb(`SELECT COUNT(*) c, SUM(COALESCE(valor,0)) v, SUM(COALESCE(quantidade,0)) m FROM referencias WHERE created_at >= ? AND status IN ('concluido','realizado','sucesso','COMPLETED','finalizado')`, [`${weekAgo} 00:00:00`]),
      queryDb(`SELECT COUNT(*) c, SUM(COALESCE(valor,0)) v, SUM(COALESCE(quantidade,0)) m FROM referencias WHERE created_at >= ? AND status IN ('concluido','realizado','sucesso','COMPLETED','finalizado')`, [`${monthAgo} 00:00:00`]),
      queryDb(`SELECT ref, numero, valor, quantidade, status, tipo, created_at, remetente FROM referencias ORDER BY rowid DESC LIMIT 20`)
    ]);

    // Gráfico 7 dias
    const chartData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const ds = d.toISOString().slice(0, 10);
      const row = await queryDb(`SELECT SUM(COALESCE(valor,0)) v, SUM(COALESCE(quantidade,0)) m, COUNT(*) n FROM referencias WHERE created_at LIKE ? AND status IN ('concluido','realizado','sucesso','COMPLETED','finalizado')`, [`${ds}%`]);
      chartData.push({ date: ds, label: d.toLocaleDateString('pt-PT',{weekday:'short',day:'numeric',month:'short'}), valor: row[0]?.v||0, megas: row[0]?.m||0, vendas: row[0]?.n||0 });
    }

    const metrics = {
      today:  { lucro: todaySales[0]?.v||0, vendas: todaySales[0]?.c||0, megas: todaySales[0]?.m||0 },
      week:   { lucro: weekSales[0]?.v||0,  vendas: weekSales[0]?.c||0,  megas: weekSales[0]?.m||0 },
      month:  { lucro: monthSales[0]?.v||0, vendas: monthSales[0]?.c||0, megas: monthSales[0]?.m||0 },
      chartData,
      recentSales
    };

    // Fila pendente
    const pendingRaw = await queryDb(`SELECT ref, numero, valor, quantidade, tipo, status, created_at, remetente FROM referencias WHERE status NOT IN ('concluido','realizado','sucesso','COMPLETED','finalizado','cancelado') ORDER BY rowid DESC LIMIT 30`);
    const queue = {};
    pendingRaw.forEach(r => { queue[r.ref] = r; });

    // Grupos
    const groupsRaw = await queryDb(`SELECT g.jid, g.nome, g.tabela_id, g.regras, g.modo_silencioso FROM group_tabelas g LIMIT 50`);
    const groups = {};
    groupsRaw.forEach(g => { groups[g.jid] = g; });

    // Assinaturas
    const subsRaw = await queryDb(`SELECT id, jid, numero, tipo, total_mb, entregue_mb, valor_entrega_diaria, data_proxima_entrega, status FROM assinaturas_planos ORDER BY id DESC LIMIT 50`);
    const subscriptions = {};
    subsRaw.forEach(s => { subscriptions[s.id] = s; });

    try {
      await axios.post(`${CLOUD_URL}/api/admin/sync`, {
        metrics, queue, groups, subscriptions,
        bot_status: { online: true, version: '2.0', last_seen: new Date().toISOString(), last_log: getRecentBotLogs() }
      }, { timeout: 8000 });
      console.log(`[CLOUD SYNC] ✅ Sincronizado às ${new Date().toLocaleTimeString('pt-PT')}`);
    } catch(e) {
      // Se a rota admin/sync responder 404, envia heartbeat pelos endpoints activos de dispositivos
      axios.post(`${CLOUD_URL}/api/devices/8023/status`, { online: true, bateria: 100, carrier: 'Vodacom (Huawei)' }).catch(() => {});
      axios.post(`${CLOUD_URL}/api/devices/8077/status`, { online: true, bateria: 100, carrier: 'Vodacom (Redmi)' }).catch(() => {});
      if (!e.response || e.response.status !== 404) {
        console.error('[CLOUD SYNC] ⚠️ Erro:', e.message);
      }
    }
  } catch(e) {}
}

// ── Verificar comandos pendentes ───────────────────────────────
async function checkCommands() {
  try {
    const res = await axios.get(`${CLOUD_URL}/api/admin/bot/command/pending`, { timeout: 5000 }).catch(() => null);
    const pending = res?.data?.pending;
    if (!pending) return;

    console.log(`[CLOUD CMD] 📥 Comando recebido: ${pending.cmd}`);
    await axios.delete(`${CLOUD_URL}/api/admin/bot/command`, { timeout: 5000 }).catch(() => {});


    switch(pending.cmd) {
      case 'stop':
        console.log('[CLOUD CMD] 🔴 Desligando bot...');
        process.exit(0);
        break;

      case 'restart':
        console.log('[CLOUD CMD] 🔄 Reiniciando bot...');
        exec(`start "" node kanet-loader.js`, { cwd: ROOT_DIR });
        setTimeout(() => process.exit(0), 1500);
        break;

            case 'reset_transfers':
        console.log('[CLOUD CMD] 🔄 Zerando contadores de transferências...');
        try {
          const dirs = ['8021','8022','8023','8024','8025','8026','8027','8028'];
          dirs.forEach(d => {
            const p = path.join(ROOT_DIR, d, 'success_counters.json');
            if (fs.existsSync(p)) {
              fs.writeFileSync(p, JSON.stringify({ sim1: { success_count: 0 }, sim2: { success_count: 0 }, last_reset: new Date().toISOString() }, null, 2));
            }
          });
          console.log('[CLOUD CMD] ✅ Contadores locais zerados.');
          syncToCloud();
        } catch(err) { console.error('[CLOUD CMD] Erro ao zerar:', err.message); }
        break;
      case 'reset_whatsapp':
        console.log('[CLOUD CMD] 🔄 Trocando WhatsApp — apagando sessão...');
        if (fs.existsSync(SESSION_DIR)) {
          fs.rmSync(SESSION_DIR, { recursive: true, force: true });
          console.log('[CLOUD CMD] Sessão apagada. Reiniciando para novo QR...');
        }
        exec(`start "" node kanet-loader.js`, { cwd: ROOT_DIR });
        setTimeout(() => process.exit(0), 1500);
        break;

      case 'cancel_order':
        if (pending.ref) {
          const db2 = new sqlite3.Database(DB_PATH);
          db2.run(`UPDATE referencias SET status='cancelado' WHERE ref=?`, [pending.ref], () => db2.close());
          console.log(`[CLOUD CMD] ❌ Pedido cancelado: ${pending.ref}`);
        }
        break;
    }
  } catch(e) {
    // Silencioso — pode falhar se Render estiver a acordar
  }
}

// ── Iniciar loops ──────────────────────────────────────────────
console.log('[CLOUD SYNC] 🚀 Módulo iniciado. Sincronizando a cada 60s, comandos a cada 15s (Otimizado)...');
syncToCloud(); // primeira sync imediata
setInterval(syncToCloud,   60000); // sync a cada 60s
setInterval(checkCommands, 15000); // comandos a cada 15s

module.exports = { syncToCloud, checkCommands };
