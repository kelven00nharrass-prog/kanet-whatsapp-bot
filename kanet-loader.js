/**
 * KaNet — Loader Encriptado
 * ==========================
 * Ponto de entrada para revendedores.
 * 
 * Este ficheiro:
 *  1. Valida a licença com Firebase
 *  2. Busca a chave de desencriptação do Firebase
 *  3. Verifica e aplica atualizações automáticas
 *  4. Desencripta os ficheiros .enc em MEMÓRIA (nunca toca disco)
 *  5. Intercepta require() para servir módulos desencriptados
 *  6. Executa o bot
 *
 * Sem licença válida = ficheiros .enc são lixo binário ilegível.
 * Uso: node kanet-loader.js
 */
"use strict";
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const Module = require("module");

const https  = require("https");
const http   = require("http");

// Mini-servidor HTTP para Render / Docker health check (porta 10000)
const HEALTH_PORT = process.env.PORT || 10000;
try {
    const healthServer = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
            status: "online", 
            service: "Ka-Net WhatsApp Bot", 
            version: "2.0.32",
            timestamp: new Date().toISOString() 
        }));
    });
    healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
        console.log(`📡 [HEALTH] Servidor HTTP de verificação activo na porta ${HEALTH_PORT}`);
    });
} catch(e) {
    console.error("⚠️ [HEALTH] Erro ao iniciar servidor de verificação:", e.message);
}

const FIREBASE_CONFIG = {
    projectId: "kanet-saas-licensing",
    apiKey:    "AIzaSyCsBsNrLoKagDakoYPzh26B66gJeGy_nZg"
};

// ── Versão atual do bot (actualizar a cada release) ────────────
const KANET_VERSAO_ATUAL = "2.0.32";
const VERSAO_FILE        = "kanet_versao.txt";
const UPDATE_FLAG_FILE   = "_KANET_UPDATED";

// ── Helpers ─────────────────────────────────────────────────

function getBaseDir() {
    if (process.pkg) return path.dirname(process.execPath);
    return __dirname;
}

/**
 * Desencripta um buffer .enc com AES-256-GCM
 * Formato: [IV 12 bytes][AuthTag 16 bytes][Ciphertext N bytes]
 */
function desencriptarBuffer(encBuffer, chaveHex) {
    const key  = Buffer.from(chaveHex, "hex");
    const iv   = encBuffer.slice(0, 12);
    const tag  = encBuffer.slice(12, 28);
    const data = encBuffer.slice(28);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/**
 * Executa pedidos HTTPS simples à API REST do Firebase
 */
function makeRestRequest(url, method, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            timeout: 8000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode >= 400) {
                        reject(new Error(parsed.error?.message || `HTTP ${res.statusCode}`));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}`));
                    else resolve(data);
                }
            });
        });

        req.on('error', err => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout de rede'));
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

/**
 * Descarrega um ficheiro via HTTPS para um Buffer
 */
function downloadBuffer(url) {
    return new Promise((resolve, reject) => {
        const makeReq = (u, redirects = 0) => {
            if (redirects > 5) return reject(new Error('Demasiados redirects'));
            const parsed = new URL(u);
            const options = {
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                method: 'GET',
                timeout: 60000
            };
            const req = https.request(options, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    return makeReq(res.headers['location'], redirects + 1);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode} ao descarregar actualização`));
                }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout ao descarregar')); });
            req.end();
        };
        makeReq(url);
    });
}

/**
 * Verifica e aplica atualizações automáticas.
 * Retorna true se actualizou (o processo deve reiniciar).
 */
async function verificarAtualizacao(BASE) {
    try {
        // Ler versão instalada localmente
        const versaoLocalPath = path.join(BASE, VERSAO_FILE);
        const versaoLocal = fs.existsSync(versaoLocalPath)
            ? fs.readFileSync(versaoLocalPath, 'utf8').trim()
            : KANET_VERSAO_ATUAL;

        // Consultar Firestore: doc licencas/KANET-VERS-ION1-CFG2
        const docUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/licencas/KANET-VERS-ION1-CFG2?key=${FIREBASE_CONFIG.apiKey}`;
        let docRes;
        try {
            docRes = await makeRestRequest(docUrl, 'GET');
        } catch(e) {
            // Sem internet ou doc não existe — ignorar
            return false;
        }

        if (!docRes || !docRes.fields) return false;

        const versaoRemota  = docRes.fields.versao?.stringValue;
        const urlBot        = docRes.fields.url_bot?.stringValue;      // URL do Ka-Net System 2.0.enc
        const urlPainel     = docRes.fields.url_painel?.stringValue;   // URL do kanet-local-panel.enc
        const notas         = docRes.fields.notas?.stringValue || '';
        const forcar        = docRes.fields.forcar?.booleanValue || false;

        if (!versaoRemota || !urlBot) return false;

        // Comparar versões
        if (versaoRemota === versaoLocal && !forcar) return false;

        // ═══ HÁ ACTUALIZAÇÃO DISPONÍVEL ═══
        console.log('');
        console.log(' ╔══════════════════════════════════════════════════╗');
        console.log(` ║  🔄 ACTUALIZAÇÃO DISPONÍVEL: v${versaoRemota.padEnd(18)}║`);
        console.log(` ║  📦 De: v${versaoLocal.padEnd(9)} → Para: v${versaoRemota.padEnd(8)}   ║`);
        if (notas) {
        console.log(` ║  📝 ${notas.substring(0, 44).padEnd(44)} ║`);
        }
        console.log(' ╚══════════════════════════════════════════════════╝');
        console.log('');

        // Descarregar Ka-Net System 2.0.enc
        let spUp = loading('A descarregar actualização...');
        try {
            const botBuffer = await downloadBuffer(urlBot);
            fs.writeFileSync(path.join(BASE, 'Ka-Net System 2.0.enc'), botBuffer);

            // Descarregar kanet-local-panel.enc se disponível
            if (urlPainel) {
                const painelBuffer = await downloadBuffer(urlPainel);
                fs.writeFileSync(path.join(BASE, 'kanet-local-panel.enc'), painelBuffer);
            }

            // Guardar versão instalada
            fs.writeFileSync(versaoLocalPath, versaoRemota, 'utf8');

            // Guardar flag para o bot enviar notificação WhatsApp
            fs.writeFileSync(path.join(BASE, UPDATE_FLAG_FILE), JSON.stringify({
                versaoAnterior: versaoLocal,
                versaoNova:     versaoRemota,
                notas:          notas,
                timestamp:      new Date().toISOString()
            }), 'utf8');

            doneLoading(spUp, `Actualização v${versaoRemota} instalada com sucesso!`);
            console.log('');
            console.log('  🔁 A reiniciar para aplicar a actualização...');
            console.log('');

            // Aguardar 2s para o utilizador ler a mensagem e reiniciar
            await new Promise(r => setTimeout(r, 2000));
            process.exit(0); // O .bat tem loop → reinicia automaticamente
            return true;
        } catch(e) {
            failLoading(spUp, `Erro ao descarregar actualização: ${e.message}`);
            console.log('  ⚠️  O bot continuará com a versão actual.');
            return false;
        }
    } catch(e) {
        // Erro inesperado — não bloquear o arranque
        return false;
    }
}

/**
 * Compila e executa código JS em contexto de módulo Node.js
 * O código fica SÓ em memória — nunca é escrito no disco
 */
function compilarModulo(codigo, nomeOriginal, dirBase, modulesDir) {
    const fakePath = path.join(dirBase, nomeOriginal);
    const m = new Module(fakePath, module);
    m.filename = fakePath;
    // Combinar paths de resolução: disco real primeiro, depois snapshot
    const basePaths = Module._nodeModulePaths(dirBase);
    if (modulesDir && modulesDir !== dirBase) {
        const realPaths = Module._nodeModulePaths(modulesDir);
        m.paths = [...new Set([...realPaths, ...basePaths])];
    } else {
        m.paths = basePaths;
    }
    m._compile(codigo, fakePath);
    m.loaded = true;
    return m;
}

// ── Animação de loading ─────────────────────────────────────
const _frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
function loading(texto) {
    let i = 0;
    return setInterval(() => {
        process.stdout.write(`\r  ${_frames[i++ % _frames.length]} ${texto}`);
    }, 100);
}
function doneLoading(sp, texto) {
    clearInterval(sp);
    process.stdout.write(`\r  ✅ ${texto}                              \n`);
}
function failLoading(sp, texto) {
    clearInterval(sp);
    process.stdout.write(`\r  ❌ ${texto}                              \n`);
}

// ── Main ────────────────────────────────────────────────────

async function main() {
    const BASE = getBaseDir();

    // ── Verificar se o bot já está ativo (Single Instance Lock) ──
    const lockFile = path.join(BASE, "kanet_bot.lock");
    try {
        if (fs.existsSync(lockFile)) {
            const existingPid = parseInt(fs.readFileSync(lockFile, "utf8").trim());
            if (!isNaN(existingPid)) {
                try {
                    process.kill(existingPid, 0); // Envia sinal de teste 0
                    console.error("\n❌ [ERRO CRÍTICO] O Ka-Net Bot já está em execução em outra janela!");
                    console.error(`   Feche a outra janela do bot (Processo PID: ${existingPid}) antes de iniciar uma nova.\n`);
                    process.exit(1);
                } catch (errKill) {
                    try { fs.unlinkSync(lockFile); } catch(e) {}
                }
            }
        }
    } catch(eLock) {}

    try {
        fs.writeFileSync(lockFile, String(process.pid), "utf8");
    } catch(eWriteLock) {}

    const cleanLock = () => {
        try {
            if (fs.existsSync(lockFile)) {
                const currentPid = parseInt(fs.readFileSync(lockFile, "utf8").trim());
                if (currentPid === process.pid) {
                    fs.unlinkSync(lockFile);
                }
            }
        } catch(e) {}
    };
    process.on("exit", cleanLock);
    process.on("SIGINT", () => { cleanLock(); process.exit(0); });
    process.on("SIGTERM", () => { cleanLock(); process.exit(0); });

    // Ler versão instalada (se existir) — senão usa a do código
    const versaoLocalPath = path.join(BASE, VERSAO_FILE);
    const versaoExibir = fs.existsSync(versaoLocalPath)
        ? fs.readFileSync(versaoLocalPath, 'utf8').trim()
        : KANET_VERSAO_ATUAL;

    console.log("");
    console.log(" ╔══════════════════════════════════════════════════╗");
    console.log(` ║     KaNet System 2.0 — Bot v${versaoExibir.padEnd(19)}║`);
    console.log(" ╚══════════════════════════════════════════════════╝");
    console.log("");

    // ═══════════════════════════════════════════════════════════
    // PASSO 1: Validar Licença
    // ═══════════════════════════════════════════════════════════
    let sp = loading("A validar licença...");
    
    let KaNetLicense;
    try {
        KaNetLicense = require("./kanet-license.js");
    } catch(e) {
        failLoading(sp, `Erro ao carregar módulo de licença: ${e.message}`);
        process.exit(1);
    }

    const licenca = new KaNetLicense();
    const licDados = await licenca.init({
        log: (msg) => console.log(`  ${msg}`),
        onExpirar: async () => {
            console.log("\n🚫 [LICENÇA] A sua licença expirou! Contacte o administrador.");
            await new Promise(r => setTimeout(r, 10000));
            process.exit(1);
        },
        onBloquear: async () => {
            console.log("\n⛔ [LICENÇA] Acesso negado para este dispositivo! Contacte o administrador.");
            await new Promise(r => setTimeout(r, 10000));
            process.exit(1);
        }
    });

    if (!licDados) {
        failLoading(sp, "Licença inválida ou não encontrada!");
        console.log("");
        console.log("  💡 Certifique-se que:");
        console.log("     1. O ficheiro licenca.key existe na pasta");
        console.log("     2. A chave foi fornecida pelo administrador");
        console.log("     3. Existe ligação à internet");
        console.log("");
        await new Promise(r => setTimeout(r, 10000));
        process.exit(1);
    }
    doneLoading(sp, `Licença válida — ${licDados.nome_vendedor || "Revendedor"}`);
    
    // Guardar no global para acesso pelo bot
    global.licencaObj = licenca;
    global.licencaDados = licDados;

    // ═══════════════════════════════════════════════════════════
    // PASSO 1.5: Verificar Actualizações Automáticas
    // ═══════════════════════════════════════════════════════════
    sp = loading('A verificar actualizações...');
    // Pequena pausa para evitar sobrecarregar Firebase logo no início
    await new Promise(r => setTimeout(r, 500));
    const actualizou = await verificarAtualizacao(BASE);
    if (!actualizou) {
        doneLoading(sp, 'Sistema actualizado (sem actualizações pendentes)');
    }
    // Se actualizou === true, o processo já saiu com process.exit(0)

    // Guardar BASE no global para uso do bot (notificação WhatsApp)
    global._kanetBase = BASE;
    global._kanetUpdateFlagFile = path.join(BASE, UPDATE_FLAG_FILE);

    // ═══════════════════════════════════════════════════════════
    // PASSO 2: Buscar Chave de Desencriptação do Firebase
    // ═══════════════════════════════════════════════════════════
    sp = loading("A obter chave de segurança...");

    let chaveEnc = null;

    // Busca chave de segurança local primeiro (válida para todas as licenças)
    const localPaths = [
        path.join(BASE, ".encryption_key"),
        path.join(BASE, "..", ".encryption_key")
    ];
    for (const lp of localPaths) {
        if (fs.existsSync(lp)) {
            chaveEnc = fs.readFileSync(lp, "utf8").trim();
            break;
        }
    }

    // Buscar do Firebase (revendedores e fallback para proprietário)
    if (!chaveEnc) {
        try {
            // Usar colecção 'licencas' com regras abertas — sem auth necessária
            const SYS_DOC_ID = "KANET-KEY1-SEC2-SYS3";
            const docUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/licencas/${SYS_DOC_ID}?key=${FIREBASE_CONFIG.apiKey}`;
            const docRes = await makeRestRequest(docUrl, 'GET');

            if (docRes && docRes.fields && docRes.fields.key) {
                chaveEnc = docRes.fields.key.stringValue;
            }
        } catch(e) { /* sem Firebase = sem chave */ }
    if (!chaveEnc) {
        chaveEnc = process.env.ENCRYPTION_KEY || 'd6d63aa4d562082059a639465c82dc034326548ed0352b7f3ec8fd52f02e81ee';
    }

    if (!chaveEnc || chaveEnc.length !== 64) {
        failLoading(sp, "Chave de segurança indisponível!");
        console.log("  ⚠️  Licença válida mas sistema de segurança falhou.");
        console.log("  ⚠️  Contacte o administrador.");
        process.exit(1);
    }
    doneLoading(sp, "Chave de segurança obtida");

    // ═══════════════════════════════════════════════════════════
    // PASSO 3: Desencriptar Módulos em Memória
    // ═══════════════════════════════════════════════════════════
    sp = loading("A desencriptar sistema...");

    // Cache de módulos desencriptados — require() vai buscar aqui
    const _modulosDecifrados = {};

    // Lista de ficheiros encriptados
    const FICHEIROS_ENC = [
        { enc: "Ka-Net System 2.0.enc",  js: "Ka-Net System 2.0.js" },
        { enc: "kanet-local-panel.enc",   js: "kanet-local-panel.js" }
    ];

    // Desencriptar cada ficheiro
    for (const { enc, js } of FICHEIROS_ENC) {
        let finalEncPath = null;
        let finalJsPath = null;

        // 1. Procurar ficheiro encriptado
        const localEnc = path.join(BASE, enc);
        const pkgEnc = path.join(__dirname, enc);
        
        if (fs.existsSync(localEnc)) {
            finalEncPath = localEnc;
        } else if (fs.existsSync(pkgEnc)) {
            finalEncPath = pkgEnc;
        }

        if (finalEncPath) {
            try {
                const encBuffer = fs.readFileSync(finalEncPath);
                const codigo = desencriptarBuffer(encBuffer, chaveEnc);
                _modulosDecifrados[js] = { code: codigo, jsPath: null };
            } catch(e) {
                failLoading(sp, `Erro ao desencriptar ${enc}`);
                if (e.message.includes("Unsupported state") || e.message.includes("auth tag")) {
                    console.log("  ⚠️  Chave incorrecta ou ficheiro corrompido.");
                } else {
                    console.log(`  ⚠️  ${e.message}`);
                }
                process.exit(1);
            }
        } else {
            // 2. Fallback: procurar ficheiro JS normal (modo dev ou proprietário)
            const localJs = path.join(BASE, js);
            const pkgJs = path.join(__dirname, js);
            if (fs.existsSync(localJs)) {
                _modulosDecifrados[js] = { code: null, jsPath: localJs };
            } else if (fs.existsSync(pkgJs)) {
                _modulosDecifrados[js] = { code: null, jsPath: pkgJs };
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // PASSO 4: Interceptar require() para servir módulos da RAM
    // ═══════════════════════════════════════════════════════════
    
    // Guardar o _resolveFilename original
    const _originalResolve = Module._resolveFilename;
    
    // Cache de módulos compilados em memória
    const _compiledCache = {};

    Module._resolveFilename = function(request, parent, isMain, options) {
        // Interceptar requires relativos dos módulos KaNet
        // ./kanet-license, ./kanet-local-panel, ./Ka-Net System 2.0
        const baseName = request.replace(/^\.\//, "").replace(/\.js$/, "");
        
        // Mapear nomes possíveis para ficheiros encriptados
        const mapaNomes = {
            "kanet-local-panel": "kanet-local-panel.js",
            "Ka-Net System 2.0": "Ka-Net System 2.0.js"
        };

        const jsName = mapaNomes[baseName];
        if (jsName && _modulosDecifrados[jsName]) {
            const info = _modulosDecifrados[jsName];
            const fakePath = path.join(__dirname, jsName);
            
            // Se já foi compilado, retornar do cache
            if (_compiledCache[fakePath]) {
                return fakePath;
            }

            // Compilar em memória e registrar no cache do require
            if (info.code) {
                const m = compilarModulo(info.code, jsName, __dirname, BASE);
                require.cache[fakePath] = m;
                _compiledCache[fakePath] = true;
                return fakePath;
            }
            // Se tem jsPath (modo dev), deixar o require normal resolver
        }

        // kanet-license: redirecionar para o módulo dentro do snapshot do loader
        if (baseName === "kanet-license") {
            try {
                // __dirname do loader aponta para o snapshot (dentro do .exe)
                // onde kanet-license.js está compilado
                return _originalResolve.call(
                    this,
                    path.join(__dirname, "kanet-license.js"),
                    parent, isMain, options
                );
            } catch(e) {
                // Fallback: tentar no mesmo diretório do executável
                try {
                    return _originalResolve.call(
                        this,
                        path.join(BASE, "kanet-license.js"),
                        parent, isMain, options
                    );
                } catch(e2) { /* deixar falhar normalmente */ }
            }
        }

        // Tudo o resto: comportamento normal
        let resolved = null;
        try {
            resolved = _originalResolve.call(this, request, parent, isMain, options);
        } catch(e) {
            // Fallback: se a resolução direta falhou, tentar no disco
            if (process.pkg) {
                try {
                    const diskPath = path.join(BASE, "node_modules", request);
                    resolved = _originalResolve.call(this, diskPath, parent, isMain, options);
                } catch(e2) {
                    if (request.includes("node_modules")) {
                        const parts = request.split("node_modules");
                        const modPart = parts[parts.length - 1];
                        const diskAbs = path.join(BASE, "node_modules", modPart);
                        try {
                            resolved = _originalResolve.call(this, diskAbs, parent, isMain, options);
                        } catch(e3) {
                            throw e;
                        }
                    } else {
                        throw e;
                    }
                }
            } else {
                throw e;
            }
        }

        // Se resolveu para um caminho virtual do snapshot em node_modules,
        // redirecionar sempre para a pasta física correspondente em node_modules no disco (se existir).
        // Isto resolve conflitos de módulos ESM/CommonJS híbridos (como axios) que falham ao carregar de dentro do snapshot.
        if (resolved && process.pkg && resolved.includes("node_modules")) {
            const snapIdx = resolved.indexOf("node_modules");
            if (snapIdx !== -1) {
                const relativePart = resolved.substring(snapIdx);
                const diskAbs = path.join(BASE, relativePart);
                if (fs.existsSync(diskAbs)) {
                    resolved = diskAbs;
                }
            }
        }

        return resolved;
    };


    doneLoading(sp, "Sistema desencriptado e carregado em memória!");

    // Limpar a chave da memória — já não é necessária
    chaveEnc = null;

    // ═══════════════════════════════════════════════════════════
    // PASSO 5: Arrancar o Bot & Cloud Admin Sync
    // ═══════════════════════════════════════════════════════════
    console.log("");
    console.log(" ╔══════════════════════════════════════════════════╗");
    console.log(" ║   🚀 Sistema pronto — Bot a arrancar...         ║");
    console.log(" ╚══════════════════════════════════════════════════╝");
    console.log("");

    try {
        require('./cloud_sync_admin');
    } catch(e) {
        console.error("⚠️ [LOADER] Erro ao carregar Cloud Sync:", e.message);
    }

    // O Ka-Net System 2.0.js é um IIFE que executa ao ser compilado
    const botInfo = _modulosDecifrados["Ka-Net System 2.0.js"];
    if (botInfo) {
        if (botInfo.code) {
            // Executar código desencriptado
            compilarModulo(botInfo.code, "Ka-Net System 2.0.js", __dirname, BASE);
        } else if (botInfo.jsPath) {
            // Modo dev: carregar ficheiro normal
            require(botInfo.jsPath);
        }
    } else {
        console.error("❌ [LOADER] Ficheiro do bot não encontrado!");
        console.error("   Procurados: Ka-Net System 2.0.enc ou Ka-Net System 2.0.js");
        process.exit(1);
    }

    // Manter processo vivo e tratar erros
    process.on("uncaughtException", (err) => {
        const ignorar = ["ECONNRESET","EPIPE","ECONNREFUSED","ETIMEDOUT","EADDRINUSE"];
        if (ignorar.some(c => err.code === c || (err.message && err.message.includes(c)))) return;
        console.error("❌ [LOADER] Erro:", err.message);
    });
    process.on("unhandledRejection", (reason) => {
        const msg = reason && (reason.message || String(reason));
        const ignorar = ["ECONNRESET","EPIPE","ECONNREFUSED","ETIMEDOUT","fetch failed"];
        if (ignorar.some(c => msg && msg.includes(c))) return;
        console.error("❌ [LOADER] Promise:", reason);
    });

    // ═══════════════════════════════════════════════════════════
    // VERIFICAÇÃO PERIÓDICA DE ACTUALIZAÇÕES (cada 6 horas)
    // ═══════════════════════════════════════════════════════════
    const SEIS_HORAS = 6 * 60 * 60 * 1000;
    setInterval(async () => {
        try {
            console.log('\n  🔄 [AUTO-UPDATE] A verificar actualizações periódicas...');
            await verificarAtualizacao(BASE);
            // Se verificarAtualizacao encontrar uma actualização, vai chamar process.exit(0)
            // e o loop do .bat vai reiniciar o bot automaticamente com a nova versão
        } catch(e) { /* ignorar erros na verificação periódica */ }
    }, SEIS_HORAS);
}

main().catch(e => {
    console.error("❌ [LOADER] Erro fatal:", e.message);
    process.exit(1);
});

// Forçar o pkg a empacotar e mapear todas as dependências no executável
if (false) {
    require('@google/generative-ai');
    require('@open-wa/wa-automate');
    require('adbkit');
    require('archiver');
    require('async-lock');
    require('body-parser');
    require('cors');
    require('express');
    require('figlet');
    require('firebase');
    require('p-limit');
    require('qrcode-terminal');
    require('sqlite');
    require('sqlite3');
    require('tesseract.js');
}
