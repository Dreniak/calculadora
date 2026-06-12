// Base local de índices e salário mínimo (RF-4), em SQLite por máquina.
// Semeada de seed/indices-seed.json na primeira execução (RNF-2) e
// completada por IBGE/Bacen quando houver internet (RNF-3), sem
// sobrescrever valores com status "oficial".
//
// Fontes (Seção 10.1 do PRD):
//  - INPC: SIDRA t.1736 v.44 (até 08/2024) | IPCA: SIDRA t.1737 v.63 (após);
//  - Taxa Legal: razão dos fatores SGS 29541 (Selic) / 29542 (IPCA), piso 0;
//  - Salário mínimo: SGS 1619.

use std::collections::BTreeMap;

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::storage::{dir_dados, Erro};

const SEED: &str = include_str!("../../seed/indices-seed.json");
const TRANSICAO_CORRECAO: &str = "2024-08"; // INPC até aqui, IPCA depois

fn conexao(app: &tauri::AppHandle) -> Result<Connection, Erro> {
    let caminho = dir_dados(app)?.join("indices.sqlite");
    let conn = Connection::open(caminho)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS serie_valores (
            serie TEXT NOT NULL,
            ym TEXT NOT NULL,
            valor REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'oficial',
            fonte TEXT,
            atualizado_em TEXT,
            PRIMARY KEY (serie, ym)
        );
        CREATE TABLE IF NOT EXISTS salario_minimo (
            vigencia TEXT PRIMARY KEY,
            valor REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'oficial',
            fonte TEXT,
            atualizado_em TEXT
        );",
    )?;
    Ok(conn)
}

/// Insere/atualiza um valor de série respeitando valores oficiais existentes.
fn upsert_serie(
    conn: &Connection,
    serie: &str,
    ym: &str,
    valor: f64,
    status: &str,
    fonte: &str,
    forcar: bool,
) -> Result<bool, Erro> {
    let existente: Option<String> = conn
        .query_row(
            "SELECT status FROM serie_valores WHERE serie=?1 AND ym=?2",
            (serie, ym),
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            e => Err(e),
        })?;
    match existente {
        Some(st) if st == "oficial" && !forcar => Ok(false),
        _ => {
            conn.execute(
                "INSERT OR REPLACE INTO serie_valores (serie, ym, valor, status, fonte, atualizado_em)
                 VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
                (serie, ym, valor, status, fonte),
            )?;
            Ok(true)
        }
    }
}

fn upsert_sm(
    conn: &Connection,
    vigencia: &str,
    valor: f64,
    status: &str,
    fonte: &str,
    forcar: bool,
) -> Result<bool, Erro> {
    let existente: Option<String> = conn
        .query_row(
            "SELECT status FROM salario_minimo WHERE vigencia=?1",
            (vigencia,),
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            e => Err(e),
        })?;
    match existente {
        Some(st) if st == "oficial" && !forcar => Ok(false),
        _ => {
            conn.execute(
                "INSERT OR REPLACE INTO salario_minimo (vigencia, valor, status, fonte, atualizado_em)
                 VALUES (?1, ?2, ?3, ?4, datetime('now'))",
                (vigencia, valor, status, fonte),
            )?;
            Ok(true)
        }
    }
}

/// Semeia a base na primeira execução (ou completa séries vazias).
pub fn garantir_base(app: &tauri::AppHandle) -> Result<(), Erro> {
    let conn = conexao(app)?;
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM salario_minimo", (), |r| r.get(0))?;
    if n > 0 {
        return Ok(());
    }
    let seed: Value = serde_json::from_str(SEED)?;
    importar(&conn, &seed, false)?;
    Ok(())
}

fn importar(conn: &Connection, base: &Value, forcar: bool) -> Result<usize, Erro> {
    let mut alterados = 0;
    for serie in ["correcao", "taxaLegal"] {
        if let Some(mapa) = base.get(serie).and_then(|v| v.as_object()) {
            for (ym, item) in mapa {
                let valor = item.get("valor").and_then(|v| v.as_f64());
                if let Some(valor) = valor {
                    let status = item.get("status").and_then(|v| v.as_str()).unwrap_or("oficial");
                    let fonte = item.get("fonte").and_then(|v| v.as_str()).unwrap_or("");
                    if upsert_serie(conn, serie, ym, valor, status, fonte, forcar)? {
                        alterados += 1;
                    }
                }
            }
        }
    }
    if let Some(lista) = base.get("salarioMinimo").and_then(|v| v.as_array()) {
        for item in lista {
            let (vig, valor) = (
                item.get("vigencia").and_then(|v| v.as_str()),
                item.get("valor").and_then(|v| v.as_f64()),
            );
            if let (Some(vig), Some(valor)) = (vig, valor) {
                let status = item.get("status").and_then(|v| v.as_str()).unwrap_or("oficial");
                let fonte = item.get("fonte").and_then(|v| v.as_str()).unwrap_or("");
                if upsert_sm(conn, vig, valor, status, fonte, forcar)? {
                    alterados += 1;
                }
            }
        }
    }
    Ok(alterados)
}

/// Devolve a base inteira no formato consumido pelo frontend (Seção 9).
pub fn obter(app: &tauri::AppHandle) -> Result<Value, Erro> {
    let conn = conexao(app)?;
    let mut correcao = serde_json::Map::new();
    let mut taxa_legal = serde_json::Map::new();
    {
        let mut q = conn.prepare(
            "SELECT serie, ym, valor, status, fonte, atualizado_em FROM serie_valores ORDER BY ym",
        )?;
        let linhas = q.query_map((), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })?;
        for linha in linhas {
            let (serie, ym, valor, status, fonte, atualizado) = linha?;
            let item = json!({
                "valor": valor, "status": status,
                "fonte": fonte.unwrap_or_default(),
                "atualizadoEm": atualizado,
            });
            match serie.as_str() {
                "correcao" => correcao.insert(ym, item),
                "taxaLegal" => taxa_legal.insert(ym, item),
                _ => None,
            };
        }
    }
    let mut sm = Vec::new();
    {
        let mut q = conn.prepare(
            "SELECT vigencia, valor, status, fonte, atualizado_em FROM salario_minimo ORDER BY vigencia",
        )?;
        let linhas = q.query_map((), |r| {
            Ok(json!({
                "vigencia": r.get::<_, String>(0)?,
                "valor": r.get::<_, f64>(1)?,
                "status": r.get::<_, String>(2)?,
                "fonte": r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                "atualizadoEm": r.get::<_, Option<String>>(4)?,
            }))
        })?;
        for linha in linhas {
            sm.push(linha?);
        }
    }
    Ok(json!({
        "versao": 1,
        "correcao": Value::Object(correcao),
        "taxaLegal": Value::Object(taxa_legal),
        "salarioMinimo": sm,
    }))
}

/// Persiste a base editada pela UI (RF-4 — valores editáveis).
pub fn salvar(app: &tauri::AppHandle, base: &Value) -> Result<(), Erro> {
    let conn = conexao(app)?;
    importar(&conn, base, true)?;
    Ok(())
}

// ----------------------------- atualização ---------------------------------

fn buscar_json(url: &str) -> Result<Value, Erro> {
    let resposta = ureq::get(url)
        .timeout(std::time::Duration::from_secs(30))
        .call()?;
    Ok(resposta.into_json()?)
}

/// SIDRA: cada linha é um objeto com o período em algum campo "AAAAMM" e o
/// valor em "V". A primeira linha é cabeçalho.
fn ler_sidra(v: &Value) -> BTreeMap<String, f64> {
    let mut out = BTreeMap::new();
    let Some(linhas) = v.as_array() else { return out };
    for linha in linhas.iter().skip(1) {
        let Some(obj) = linha.as_object() else { continue };
        let periodo = obj.values().find_map(|c| {
            let s = c.as_str()?;
            (s.len() == 6 && s.chars().all(|ch| ch.is_ascii_digit())).then(|| s.to_string())
        });
        let valor = obj
            .get("V")
            .and_then(|c| c.as_str())
            .and_then(|s| s.parse::<f64>().ok());
        if let (Some(p), Some(valor)) = (periodo, valor) {
            out.insert(format!("{}-{}", &p[..4], &p[4..]), valor);
        }
    }
    out
}

/// SGS: [{"data":"dd/MM/aaaa","valor":"x.xx"}]
fn ler_sgs(v: &Value) -> BTreeMap<String, f64> {
    let mut out = BTreeMap::new();
    let Some(linhas) = v.as_array() else { return out };
    for linha in linhas {
        let (Some(data), Some(valor)) = (
            linha.get("data").and_then(|c| c.as_str()),
            linha.get("valor").and_then(|c| c.as_str()).and_then(|s| s.parse::<f64>().ok()),
        ) else {
            continue;
        };
        let partes: Vec<&str> = data.split('/').collect();
        if partes.len() == 3 {
            out.insert(format!("{}-{}", partes[2], partes[1]), valor);
        }
    }
    out
}

/// Busca os meses faltantes (RNF-3). Falha de uma fonte não impede as demais.
pub fn atualizar(app: &tauri::AppHandle) -> Result<Value, Erro> {
    let conn = conexao(app)?;
    let mut adicionados = 0usize;
    let mut falhas: Vec<String> = Vec::new();

    // correção: INPC até a transição, IPCA depois
    match buscar_json("https://apisidra.ibge.gov.br/values/t/1736/n1/all/v/44/p/all?formato=json") {
        Ok(v) => {
            for (ym, valor) in ler_sidra(&v) {
                if ym.as_str() >= "2000-01" && ym.as_str() <= TRANSICAO_CORRECAO {
                    if upsert_serie(&conn, "correcao", &ym, valor, "oficial", "INPC/IBGE", false)? {
                        adicionados += 1;
                    }
                }
            }
        }
        Err(e) => falhas.push(format!("INPC: {e}")),
    }
    match buscar_json("https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/63/p/all?formato=json") {
        Ok(v) => {
            for (ym, valor) in ler_sidra(&v) {
                if ym.as_str() > TRANSICAO_CORRECAO {
                    if upsert_serie(&conn, "correcao", &ym, valor, "oficial", "IPCA/IBGE", false)? {
                        adicionados += 1;
                    }
                }
            }
        }
        Err(e) => falhas.push(format!("IPCA: {e}")),
    }

    // Taxa Legal: razão dos fatores SGS 29541/29542 (piso zero)
    let selic = buscar_json("https://api.bcb.gov.br/dados/serie/bcdata.sgs.29541/dados?formato=json");
    let ipca_fator = buscar_json("https://api.bcb.gov.br/dados/serie/bcdata.sgs.29542/dados?formato=json");
    match (selic, ipca_fator) {
        (Ok(s), Ok(i)) => {
            let fs = ler_sgs(&s);
            let fi = ler_sgs(&i);
            for (ym, fator_selic) in &fs {
                if let Some(fator_ipca) = fi.get(ym) {
                    if *fator_ipca != 0.0 {
                        let taxa = ((fator_selic / fator_ipca) - 1.0) * 100.0;
                        let taxa = taxa.max(0.0);
                        if upsert_serie(
                            &conn, "taxaLegal", ym, taxa, "oficial",
                            "Bacen SGS 29541/29542", false,
                        )? {
                            adicionados += 1;
                        }
                    }
                }
            }
        }
        (Err(e), _) | (_, Err(e)) => falhas.push(format!("Taxa Legal: {e}")),
    }

    // salário mínimo: vigências derivadas das mudanças de valor
    match buscar_json("https://api.bcb.gov.br/dados/serie/bcdata.sgs.1619/dados?formato=json") {
        Ok(v) => {
            let serie = ler_sgs(&v);
            let mut anterior = f64::NAN;
            for (ym, valor) in serie {
                if ym.as_str() < "1999-05" {
                    continue;
                }
                if valor != anterior {
                    if upsert_sm(&conn, &ym, valor, "oficial", "Bacen SGS 1619", false)? {
                        adicionados += 1;
                    }
                    anterior = valor;
                }
            }
        }
        Err(e) => falhas.push(format!("Salário mínimo: {e}")),
    }

    Ok(json!({ "ok": true, "adicionados": adicionados, "falhas": falhas }))
}
