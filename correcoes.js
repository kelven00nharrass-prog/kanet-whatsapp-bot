// =============================================================================
// FICHEIRO DE CORREÇÕES
// Ficheiros alterados: Ka-Net System 2.0.js  |  bot_config.js
// Data: 2026-03-07
// Autor das correções: Antigravity (AI Assistant)
// =============================================================================
// Este ficheiro documenta todas as alterações feitas.
// Para cada alteração:
//   - São identificados os ficheiros e funções/variáveis afectadas
//   - É mostrado o trecho ORIGINAL (bloco "ANTES" comentado)
//   - É mostrado o trecho NOVO (bloco "DEPOIS" comentado)
// =============================================================================


// =============================================================================
// ALTERAÇÃO 1 — Ficheiro: Ka-Net System 2.0.js
//               Função:   _0x3b207d  (linhas 997–1061)
// =============================================================================
//
// VARIÁVEIS ENVOLVIDAS:
//
//   _0x3b207d(_0x23c968, _0x35ff38)
//       → Função principal de pesquisa de pacote pelo valor em MT.
//         Recebe o valor pago (ex: 175, 29, 449) e o JID do grupo (ou null se DM).
//         Retorna um objeto com { quantidade, tipo, descricao, periodo, input_val, ... }
//
//   _0x23c968        → Valor em MT pago pelo cliente (ex: 29 para semanal 857MB)
//   _0x35ff38        → JID do grupo ("120363XXXXXXX@g.us") ou null se chat privado
//   _0x4c95f6        → Valor em MT convertido para inteiro via parseInt()
//   _0x2ecbde        → Boolean: true = DM (privado), false = grupo
//                      Calculado como: !_0x35ff38 || !_0x35ff38.includes('@g.us')
//
//   _0x9a616a  →  PACOTES_ILIMITADOS  (ilimitado, ex: 469MT = 9GB+chamadas Movi)
//   _0x17ff51  →  PACOTES_MENSAIS     (mensal,    ex: 175MT = 5GB / 30 dias)
//   _0x39a69d  →  PACOTES_SEMANAIS    (semanal,   ex: 29MT  = 857MB / 7 dias)
//   _0x29d1af  →  PACOTES_24HRS       (diário,    ex: 10MT  = 375MB / 24h)
//   _0x48e9aa  →  TABELA_GERAL_24HRS  (tabela de pacotes 24h usada em grupos)
//   _0x213394  →  Função fallback: pesquisa nas tabelas SMS fixas
//
// PROBLEMA (BUG):
//   No bloco de CHAT PRIVADO (DM), o código original apenas verificava a tabela
//   PACOTES_24HRS (_0x29d1af). Qualquer pagamento de pacote semanal, mensal ou
//   ilimitado era classificado como 'tipo: 24hrs', causando activação errada.
//
// CORREÇÃO APLICADA:
//   Adicionadas verificações para PACOTES_ILIMITADOS, PACOTES_MENSAIS e
//   PACOTES_SEMANAIS antes do fallback para 24HRS — igual ao que já existia
//   para chats de GRUPO.
// =============================================================================


// -----------------------------------------------------------------------------
// CÓDIGO ORIGINAL (ANTES) — Ka-Net System 2.0.js, função _0x3b207d, ~linha 1001
// -----------------------------------------------------------------------------

/*  ANTES:

        const _0x2ecbde = !_0x35ff38 || !_0x35ff38['includes']('@g.us');
        if (_0x2ecbde) {
            console['log']('📱\x20[PRIVADO]\x20Buscando\x20' + _0x4c95f6 + 'MT...');
            if (_0x29d1af && _0x29d1af[_0x4c95f6]) {
                const _0x4eba3f = _0x29d1af[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20' + _0x4eba3f['nome'] + '\x20(' + _0x4eba3f['quantidade_mb'] + 'MB)'), {
                    'quantidade': _0x4eba3f['quantidade_mb'],
                    'tipo': '24hrs',
                    'descricao': _0x4eba3f['nome'],
                    'periodo': _0x4eba3f['periodo'] || '24\x20horas',
                    'input_val': null,
                    'porta_obrigatoria': null,
                    'permite_retry': !![],
                    'origem': 'privado'
                };
            }
            return _0x213394(_0x23c968);
        }

*/  // FIM DO BLOCO ORIGINAL


// -----------------------------------------------------------------------------
// CÓDIGO NOVO (DEPOIS) — já aplicado em Ka-Net System 2.0.js, ~linha 1001
// -----------------------------------------------------------------------------

/*  DEPOIS:

        const _0x2ecbde = !_0x35ff38 || !_0x35ff38['includes']('@g.us');
        if (_0x2ecbde) {
            console['log']('📱\x20[PRIVADO]\x20Buscando\x20' + _0x4c95f6 + 'MT...');

            // [NOVO] Verificar pacotes ILIMITADOS primeiro
            if (_0x9a616a && _0x9a616a[_0x4c95f6]) {
                const _0x4eba3f_il = _0x9a616a[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20ILIMITADO:\x20' + _0x4eba3f_il['nome']), {
                    'quantidade': _0x4eba3f_il['ativacao_mb'],
                    'tipo': _0x4eba3f_il['tipo'],           // 'ilimitado' ou 'ilimitado_com_extra'
                    'descricao': _0x4eba3f_il['nome'],
                    'periodo': _0x4eba3f_il['periodo'],
                    'input_val': _0x4eba3f_il['input_val'],
                    'porta_obrigatoria': _0x4eba3f_il['porta_obrigatoria'],
                    'permite_retry': _0x4eba3f_il['permite_retry'] !== undefined ? _0x4eba3f_il['permite_retry'] : !![],
                    'extras': _0x4eba3f_il['extras'],
                    'origem': 'privado_ilimitados'
                };
            }

            // [NOVO] Verificar pacotes MENSAIS (30 dias)
            if (_0x17ff51 && _0x17ff51[_0x4c95f6]) {
                const _0x4eba3f_mn = _0x17ff51[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20MENSAL:\x20' + _0x4eba3f_mn['nome']), {
                    'quantidade': _0x4eba3f_mn['quantidade_mb'],
                    'tipo': _0x4eba3f_mn['tipo'],           // 'mensal'
                    'descricao': _0x4eba3f_mn['nome'],
                    'periodo': _0x4eba3f_mn['periodo'],
                    'input_val': _0x4eba3f_mn['input_val'],
                    'porta_obrigatoria': _0x4eba3f_mn['porta_obrigatoria'],
                    'permite_retry': _0x4eba3f_mn['permite_retry'] !== undefined ? _0x4eba3f_mn['permite_retry'] : !![],
                    'origem': 'privado_mensais'
                };
            }

            // [NOVO] Verificar pacotes SEMANAIS (7 dias)
            if (_0x39a69d && _0x39a69d[_0x4c95f6]) {
                const _0x4eba3f_sm = _0x39a69d[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20SEMANAL:\x20' + _0x4eba3f_sm['nome']), {
                    'quantidade': _0x4eba3f_sm['quantidade_mb'],
                    'tipo': _0x4eba3f_sm['tipo'],           // 'semanal'
                    'descricao': _0x4eba3f_sm['nome'],
                    'periodo': _0x4eba3f_sm['periodo'],
                    'input_val': _0x4eba3f_sm['input_val'],
                    'porta_obrigatoria': _0x4eba3f_sm['porta_obrigatoria'],
                    'origem': 'privado_semanais'
                };
            }

            // [ORIGINAL - mantido] Fallback para pacotes DIÁRIOS (24 horas)
            if (_0x29d1af && _0x29d1af[_0x4c95f6]) {
                const _0x4eba3f = _0x29d1af[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20' + _0x4eba3f['nome'] + '\x20(' + _0x4eba3f['quantidade_mb'] + 'MB)'), {
                    'quantidade': _0x4eba3f['quantidade_mb'],
                    'tipo': '24hrs',
                    'descricao': _0x4eba3f['nome'],
                    'periodo': _0x4eba3f['periodo'] || '24\x20horas',
                    'input_val': null,
                    'porta_obrigatoria': null,
                    'permite_retry': !![],
                    'origem': 'privado'
                };
            }
            return _0x213394(_0x23c968);
        }

*/  // FIM DO BLOCO NOVO




// =============================================================================
// ALTERAÇÃO 2 — Ficheiro: bot_config.js  (ficheiro completo de configuração)
//               Variáveis: TABELAS.semanal  |  TABELAS.mensal  |  TABELAS.ilimitado
// =============================================================================
//
// CONTEXTO:
//   O ficheiro bot_config.js é carregado no início de Ka-Net System 2.0.js como:
//       let _DYN_CFG = null;
//       try { _DYN_CFG = require('./bot_config.js'); } catch (_e) { }
//
//   Quando _DYN_CFG existe, as tabelas de pacotes são lidas A PARTIR DO
//   bot_config.js e substituem as definições internas do Ka-Net System 2.0.js:
//       _0x39a69d = _DYN_CFG ? _DYN_CFG.TABELAS['semanal'] : { ... }   // PACOTES_SEMANAIS
//       _0x17ff51 = _DYN_CFG ? _DYN_CFG.TABELAS['mensal']  : { ... }   // PACOTES_MENSAIS
//       _0x9a616a = _DYN_CFG ? _DYN_CFG.TABELAS['ilimitado']: { ... }  // PACOTES_ILIMITADOS
//
// VARIÁVEIS/CAMPOS AFECTADOS EM CADA ENTRADA DAS TABELAS:
//
//   "tipo"              → Identifica a rota de processamento do pacote.
//                         Valores válidos: 'semanal', 'mensal', 'ilimitado'
//                         ESTAVA: ausente (undefined) → bot mostrava '📦 NORMAL' e
//                         nunca roteava para porta 8777.
//
//   "input_val"         → Número do pacote enviado à porta 8777 via FastAPI.
//                         Corresponde à posição na lista de pacotes do operador.
//                         Ex: 1 = 1.º semanal (857MB), 2 = 2.º semanal (1.7GB), etc.
//                         ESTAVA: ausente → porta 8777 não sabia qual pacote activar.
//
//   "porta_obrigatoria" → Força o uso exclusivo da porta 8777 para este pacote.
//                         Valor: 8777  (porta dedicada a semanais/mensais/ilimitados)
//                         ESTAVA: ausente → bot escolhia porta aleatória (portas diárias).
//
//   "permite_retry"     → Desactiva tentativas automáticas de reenvio em caso de falha.
//                         Valor: false  (semanais/mensais não devem ser repetidos!)
//                         ESTAVA: ausente → bot podia reenviar pacote por engano.
//
//   "ativacao_mb"       → (Apenas para ilimitados) MB enviados na etapa de activação.
//                         ESTAVA: ausente → lookup de ilimitados falhava silenciosamente.
//
// PROBLEMA (BUG):
//   As entradas nas tabelas "semanal", "mensal" e "ilimitado" do bot_config.js
//   tinham apenas: quantidade, nome, quantidade_mb, periodo.
//   Os campos acima estavam TODOS em falta, fazendo com que:
//     1. O campo 'tipo' ficasse undefined → mostrado como '📦 NORMAL'
//     2. O campo 'input_val' fosse null → porta 8777 não sabia o pacote a activar
//     3. O campo 'porta_obrigatoria' fosse null → usava portas 24hrs em vez da 8777
//     4. O retry estava activo → risco de dupla activação
//
// CORREÇÃO APLICADA:
//   Adicionados os campos em falta a cada entrada das três tabelas em bot_config.js.
// =============================================================================


// -----------------------------------------------------------------------------
// EXEMPLO DO PROBLEMA (ANTES) — bot_config.js, tabela "semanal"
// (mesmo padrão aplicava-se a "mensal" e "ilimitado")
// -----------------------------------------------------------------------------

/*  ANTES (exemplo da entrada de 29MT):

    "semanal": {
        0x1d: {
            "quantidade": 0x359,
            "nome": "857MB 7 Dias",
            "quantidade_mb": 0x359,
            "periodo": "semanal"
            // ← SEM tipo           → undefined → '📦 NORMAL'
            // ← SEM input_val      → null       → porta 8777 não sabe o nº do pacote
            // ← SEM porta_obrigatoria → null    → usa porta diária errada
            // ← SEM permite_retry  → undefined  → retry activado por defeito
        },
        ...
    }

*/


// -----------------------------------------------------------------------------
// CÓDIGO CORRECTO (DEPOIS) — já aplicado em bot_config.js
// (exemplo da entrada de 29MT — padrão igual para todos os pacotes)
// -----------------------------------------------------------------------------

/*  DEPOIS (exemplo da entrada de 29MT):

    "semanal": {
        0x1d: {
            "quantidade": 0x359,
            "nome": "857MB 7 Dias",
            "quantidade_mb": 0x359,
            "periodo": "semanal",
            "tipo": "semanal",          // ← ADICIONADO: router identifica como semanal
            "input_val": 1,             // ← ADICIONADO: 1.º pacote semanal na lista
            "porta_obrigatoria": 8777,  // ← ADICIONADO: usa exclusivamente porta 8777
            "permite_retry": false      // ← ADICIONADO: sem retry automático
        },
        0x2f: {
            ...
            "tipo": "semanal",
            "input_val": 2,             // 2.º pacote semanal (1.7GB)
            "porta_obrigatoria": 8777,
            "permite_retry": false
        },
        ...
    },

    "mensal": {
        0xaf: {
            ...
            "tipo": "mensal",
            "input_val": 1,             // 1.º pacote mensal (5GB)
            "porta_obrigatoria": 8777,
            "permite_retry": false
        },
        ...
    },

    "ilimitado": {
        0x1d5: {
            ...
            "ativacao_mb": 0x2400,      // ← ADICIONADO: MB usados na etapa de activação
            "tipo": "ilimitado",
            "input_val": 1,
            "porta_obrigatoria": 8777,
            "permite_retry": false,
            "extras": 0                 // ← ADICIONADO: sem extras adicionais
        },
        ...
    }

*/  // FIM DO BLOCO DEPOIS


// =============================================================================
// RESUMO GLOBAL DO IMPACTO DAS DUAS CORRECÇÕES
// =============================================================================
//
//  ┌─────────────────────────────────────────────────────────────────────────┐
//  │                         ANTES das correcções                            │
//  ├──────────────────────────┬───────────────────┬──────────────────────────┤
//  │ Pacote pago              │ tipo detectado    │ Resultado                │
//  ├──────────────────────────┼───────────────────┼──────────────────────────┤
//  │ 29MT  (857MB semanal)    │ 📦 NORMAL         │ Activava pacote diário   │
//  │ 175MT (5GB mensal)       │ 📦 NORMAL         │ Activava pacote diário   │
//  │ 469MT (9GB ilimitado)    │ 📦 NORMAL         │ Activava pacote diário   │
//  │ 10MT  (375MB 24h)        │ ⏳ 24hrs          │ Correcto (não afectado)  │
//  └──────────────────────────┴───────────────────┴──────────────────────────┘
//
//  ┌─────────────────────────────────────────────────────────────────────────┐
//  │                        DEPOIS das correcções                            │
//  ├──────────────────────────┬───────────────────┬──────────────────────────┤
//  │ Pacote pago              │ tipo detectado    │ Resultado                │
//  ├──────────────────────────┼───────────────────┼──────────────────────────┤
//  │ 29MT  (857MB semanal)    │ 📅 SEMANAL        │ Activação via porta 8777 │
//  │ 175MT (5GB mensal)       │ 📅 MENSAL         │ Activação via porta 8777 │
//  │ 469MT (9GB ilimitado)    │ ♾️  ILIMITADO      │ Activação via porta 8777 │
//  │ 10MT  (375MB 24h)        │ ⏳ 24hrs          │ Correcto (inalterado)    │
//  └──────────────────────────┴───────────────────┴──────────────────────────┘
//
//  Causa raiz: DUPLO problema
//    1. Ka-Net System 2.0.js — chat privado não pesquisava as tabelas semanal/mensal/ilimitado
//    2. bot_config.js — tabelas semanal/mensal/ilimitado sem campos 'tipo', 'input_val',
//       'porta_obrigatoria', 'permite_retry' (e 'ativacao_mb' para ilimitados)
//
// =============================================================================
// FIM DO FICHEIRO DE CORREÇÕES
// =============================================================================



// =============================================================================
// ALTERAÇÃO 1 — Função: _0x3b207d (linhas 997–1061 do Ka-Net System 2.0.js)
// =============================================================================
//
// VARIÁVEIS ENVOLVIDAS:
//
//   _0x3b207d(_0x23c968, _0x35ff38)
//       → Função principal de pesquisa de pacote pelo valor em MT.
//         Recebe o valor pago (ex: 175, 29, 449) e o JID do grupo (ou null se privado).
//         Retorna um objeto com { quantidade, tipo, descricao, periodo, input_val, ... }
//
//   _0x23c968
//       → Valor em MT pago pelo cliente (ex: 175 para pacote mensal de 5GB)
//
//   _0x35ff38
//       → JID do grupo (ex: "120363XXXXXXX@g.us") ou null se for chat privado (DM)
//
//   _0x4c95f6
//       → Valor em MT convertido para inteiro via parseInt()
//
//   _0x2ecbde
//       → Boolean: true = conversa PRIVADA (DM), false = conversa de GRUPO
//         Calculado como: !_0x35ff38 || !_0x35ff38.includes('@g.us')
//
//   _0x9a616a  →  PACOTES_ILIMITADOS  (chamadas ilimitadas, ex: 449MT, 570MT)
//   _0x17ff51  →  PACOTES_MENSAIS     (pacotes mensais, ex: 175MT = 5GB/30 dias)
//   _0x39a69d  →  PACOTES_SEMANAIS    (pacotes semanais, ex: 29MT = 857MB/7 dias)
//   _0x29d1af  →  PACOTES_24HRS       (pacotes diários, ex: 10MT = 375MB/24h)
//   _0x48e9aa  →  TABELA_GERAL_24HRS  (tabela geral de pacotes 24hrs para grupos)
//   _0x213394  →  Função fallback: pesquisa na tabela SMS fixa (_0x4a60c1)
//
// PROBLEMA (BUG):
//   No bloco de chat PRIVADO (DM), o código original apenas verificava a tabela
//   PACOTES_24HRS (_0x29d1af). Qualquer valor pago que correspondesse a um pacote
//   semanal, mensal ou ilimitado era incorrectamente identificado como '24hrs'.
//   Isso causava o bot a tentar activar um pacote diário em vez do correcto.
//
// CORREÇÃO:
//   Adicionadas verificações para PACOTES_ILIMITADOS, PACOTES_MENSAIS e
//   PACOTES_SEMANAIS antes de verificar PACOTES_24HRS, igualando o comportamento
//   do chat privado ao do chat de grupo.
// =============================================================================


// -----------------------------------------------------------------------------
// CÓDIGO ORIGINAL (ANTES da correcção) — substituir pelo código NOVO abaixo
// Localização: Ka-Net System 2.0.js, dentro da função _0x3b207d, ~linha 1001
// -----------------------------------------------------------------------------

/*  ANTES:

        const _0x2ecbde = !_0x35ff38 || !_0x35ff38['includes']('@g.us');
        if (_0x2ecbde) {
            console['log']('📱\x20[PRIVADO]\x20Buscando\x20' + _0x4c95f6 + 'MT...');
            if (_0x29d1af && _0x29d1af[_0x4c95f6]) {
                const _0x4eba3f = _0x29d1af[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20' + _0x4eba3f['nome'] + '\x20(' + _0x4eba3f['quantidade_mb'] + 'MB)'), {
                    'quantidade': _0x4eba3f['quantidade_mb'],
                    'tipo': '24hrs',
                    'descricao': _0x4eba3f['nome'],
                    'periodo': _0x4eba3f['periodo'] || '24\x20horas',
                    'input_val': null,
                    'porta_obrigatoria': null,
                    'permite_retry': !![],
                    'origem': 'privado'
                };
            }
            return _0x213394(_0x23c968);
        }

*/  // FIM DO BLOCO ORIGINAL


// -----------------------------------------------------------------------------
// CÓDIGO NOVO (DEPOIS da correcção) — já aplicado em Ka-Net System 2.0.js
// Localização: Ka-Net System 2.0.js, dentro da função _0x3b207d, ~linha 1001
// -----------------------------------------------------------------------------

/*  DEPOIS: (já em vigor no ficheiro — mostrado aqui para referência)

        const _0x2ecbde = !_0x35ff38 || !_0x35ff38['includes']('@g.us');
        if (_0x2ecbde) {
            console['log']('📱\x20[PRIVADO]\x20Buscando\x20' + _0x4c95f6 + 'MT...');

            // [NOVO] Verificar pacotes ILIMITADOS primeiro (chamadas ilimitadas)
            if (_0x9a616a && _0x9a616a[_0x4c95f6]) {
                const _0x4eba3f_il = _0x9a616a[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20ILIMITADO:\x20' + _0x4eba3f_il['nome']), {
                    'quantidade': _0x4eba3f_il['ativacao_mb'],
                    'tipo': _0x4eba3f_il['tipo'],           // ex: 'ilimitado' ou 'ilimitado_com_extra'
                    'descricao': _0x4eba3f_il['nome'],
                    'periodo': _0x4eba3f_il['periodo'],
                    'input_val': _0x4eba3f_il['input_val'],
                    'porta_obrigatoria': _0x4eba3f_il['porta_obrigatoria'],
                    'permite_retry': _0x4eba3f_il['permite_retry'] !== undefined ? _0x4eba3f_il['permite_retry'] : !![],
                    'extras': _0x4eba3f_il['extras'],
                    'origem': 'privado_ilimitados'
                };
            }

            // [NOVO] Verificar pacotes MENSAIS (30 dias)
            if (_0x17ff51 && _0x17ff51[_0x4c95f6]) {
                const _0x4eba3f_mn = _0x17ff51[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20MENSAL:\x20' + _0x4eba3f_mn['nome']), {
                    'quantidade': _0x4eba3f_mn['quantidade_mb'],
                    'tipo': _0x4eba3f_mn['tipo'],           // ex: 'mensal'
                    'descricao': _0x4eba3f_mn['nome'],
                    'periodo': _0x4eba3f_mn['periodo'],
                    'input_val': _0x4eba3f_mn['input_val'],
                    'porta_obrigatoria': _0x4eba3f_mn['porta_obrigatoria'],
                    'permite_retry': _0x4eba3f_mn['permite_retry'] !== undefined ? _0x4eba3f_mn['permite_retry'] : !![],
                    'origem': 'privado_mensais'
                };
            }

            // [NOVO] Verificar pacotes SEMANAIS (7 dias)
            if (_0x39a69d && _0x39a69d[_0x4c95f6]) {
                const _0x4eba3f_sm = _0x39a69d[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20SEMANAL:\x20' + _0x4eba3f_sm['nome']), {
                    'quantidade': _0x4eba3f_sm['quantidade_mb'],
                    'tipo': _0x4eba3f_sm['tipo'],           // ex: 'semanal'
                    'descricao': _0x4eba3f_sm['nome'],
                    'periodo': _0x4eba3f_sm['periodo'],
                    'input_val': _0x4eba3f_sm['input_val'],
                    'porta_obrigatoria': _0x4eba3f_sm['porta_obrigatoria'],
                    'origem': 'privado_semanais'
                };
            }

            // [ORIGINAL - mantido] Fallback para pacotes DIÁRIOS (24 horas)
            if (_0x29d1af && _0x29d1af[_0x4c95f6]) {
                const _0x4eba3f = _0x29d1af[_0x4c95f6];
                return console['log']('✅\x20[PRIVADO]\x20' + _0x4c95f6 + 'MT\x20→\x20' + _0x4eba3f['nome'] + '\x20(' + _0x4eba3f['quantidade_mb'] + 'MB)'), {
                    'quantidade': _0x4eba3f['quantidade_mb'],
                    'tipo': '24hrs',
                    'descricao': _0x4eba3f['nome'],
                    'periodo': _0x4eba3f['periodo'] || '24\x20horas',
                    'input_val': null,
                    'porta_obrigatoria': null,
                    'permite_retry': !![],
                    'origem': 'privado'
                };
            }
            return _0x213394(_0x23c968);
        }

*/  // FIM DO BLOCO NOVO


// =============================================================================
// RESUMO DO IMPACTO DA CORRECÇÃO
// =============================================================================
//
//  ANTES (bug):
//    Chat privado (DM) com valor 175MT  →  tipo: '24hrs'  ← ERRADO
//    Chat privado (DM) com valor 29MT   →  tipo: '24hrs'  ← ERRADO
//    Chat privado (DM) com valor 449MT  →  tipo: '24hrs'  ← ERRADO
//
//  DEPOIS (corrigido):
//    Chat privado (DM) com valor 175MT  →  tipo: 'mensal'    ← CORRECTO
//    Chat privado (DM) com valor 29MT   →  tipo: 'semanal'   ← CORRECTO
//    Chat privado (DM) com valor 449MT  →  tipo: 'ilimitado' ← CORRECTO
//    Chat privado (DM) com valor 10MT   →  tipo: '24hrs'     ← CORRECTO (fallback)
//
//  Em grupos: comportamento NÃO foi alterado (já estava correcto).
//
// =============================================================================
// FIM DO FICHEIRO DE CORREÇÕES
// =============================================================================
