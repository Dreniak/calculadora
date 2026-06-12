// Arquivos e preferências: cada cálculo é um .json independente na pasta
// configurada (RNF-4 — seguro para compartilhamentos de rede); PDFs vão
// para a pasta de PDFs; preferências ficam no diretório de configuração
// do aplicativo.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::Manager;

pub type Erro = Box<dyn std::error::Error>;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub pasta_calculos: Option<String>,
    pub pasta_pdf: Option<String>,
    pub atualizacao_automatica: Option<bool>,
    pub porta_entrada: Option<u16>,
}

fn dir_config(app: &tauri::AppHandle) -> Result<PathBuf, Erro> {
    let dir = app.path().app_config_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn dir_dados(app: &tauri::AppHandle) -> Result<PathBuf, Erro> {
    let dir = app.path().app_data_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn ler_prefs(app: &tauri::AppHandle) -> Result<Prefs, Erro> {
    let caminho = dir_config(app)?.join("preferencias.json");
    if !caminho.exists() {
        return Ok(Prefs::default());
    }
    Ok(serde_json::from_str(&fs::read_to_string(caminho)?)?)
}

pub fn gravar_prefs(app: &tauri::AppHandle, prefs: &Prefs) -> Result<(), Erro> {
    let caminho = dir_config(app)?.join("preferencias.json");
    fs::write(caminho, serde_json::to_string_pretty(prefs)?)?;
    Ok(())
}

fn pasta_de(opcao: &Option<String>, app: &tauri::AppHandle, padrao: &str) -> Result<PathBuf, Erro> {
    let dir = match opcao.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(p) => PathBuf::from(p),
        None => dir_dados(app)?.join(padrao),
    };
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn pasta_calculos(app: &tauri::AppHandle) -> Result<PathBuf, Erro> {
    pasta_de(&ler_prefs(app)?.pasta_calculos, app, "calculos")
}

pub fn pasta_pdf(app: &tauri::AppHandle) -> Result<PathBuf, Erro> {
    pasta_de(&ler_prefs(app)?.pasta_pdf, app, "pdfs")
}

/// Garante que o nome usado em disco vem do UUID do cálculo (sem injeção
/// de caminho a partir de dados do processo).
fn id_seguro(id: &str) -> Result<&str, Erro> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        Ok(id)
    } else {
        Err("ID de cálculo inválido".into())
    }
}

pub fn listar_calculos(app: &tauri::AppHandle) -> Result<Vec<serde_json::Value>, Erro> {
    let mut out = Vec::new();
    for entrada in fs::read_dir(pasta_calculos(app)?)? {
        let caminho = entrada?.path();
        if caminho.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // arquivo corrompido/estranho na pasta de rede não derruba a lista
        if let Ok(texto) = fs::read_to_string(&caminho) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&texto) {
                if v.get("id").and_then(|i| i.as_str()).is_some() {
                    out.push(v);
                }
            }
        }
    }
    // mais recentes primeiro
    out.sort_by(|a, b| {
        let ca = a.get("criadoEm").and_then(|v| v.as_str()).unwrap_or("");
        let cb = b.get("criadoEm").and_then(|v| v.as_str()).unwrap_or("");
        cb.cmp(ca)
    });
    Ok(out)
}

pub fn carregar_calculo(app: &tauri::AppHandle, id: &str) -> Result<serde_json::Value, Erro> {
    let caminho = pasta_calculos(app)?.join(format!("{}.json", id_seguro(id)?));
    Ok(serde_json::from_str(&fs::read_to_string(caminho)?)?)
}

pub fn salvar_calculo(app: &tauri::AppHandle, calculo: &serde_json::Value) -> Result<(), Erro> {
    let id = calculo
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("cálculo sem ID")?;
    let pasta = pasta_calculos(app)?;
    let destino = pasta.join(format!("{}.json", id_seguro(id)?));
    // gravação atômica: evita arquivo truncado em pasta de rede (RNF-4)
    let temporario = pasta.join(format!("{}.json.tmp-{}", id, std::process::id()));
    {
        let mut f = fs::File::create(&temporario)?;
        f.write_all(serde_json::to_string_pretty(calculo)?.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&temporario, &destino)?;
    Ok(())
}

pub fn excluir_calculo(app: &tauri::AppHandle, id: &str) -> Result<(), Erro> {
    let caminho = pasta_calculos(app)?.join(format!("{}.json", id_seguro(id)?));
    fs::remove_file(caminho)?;
    Ok(())
}

pub fn salvar_pdf(app: &tauri::AppHandle, nome: &str, dados_b64: &str) -> Result<String, Erro> {
    // o frontend já sanitiza o nome (model.js); reforça contra separadores
    let nome_limpo: String = nome
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if (c as u32) < 0x20 => '-',
            c => c,
        })
        .collect();
    let bytes = base64::engine::general_purpose::STANDARD.decode(dados_b64)?;
    let caminho = pasta_pdf(app)?.join(nome_limpo);
    fs::write(&caminho, bytes)?;
    Ok(caminho.to_string_lossy().into_owned())
}
