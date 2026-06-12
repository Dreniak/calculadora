// Calculadora Judicial de Pensão Alimentícia — backend Tauri (Seção 10 do PRD).
// Responsabilidades: arquivos (.json e PDF nas pastas configuradas), base de
// índices em SQLite com atualização IBGE/Bacen, preferências, serviço HTTP
// local para a futura extensão do e-Proc (RF-9) e foco de janela.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod entry;
mod indices;
mod storage;

use storage::Prefs;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            // semeia a base de índices na primeira execução (RNF-2)
            if let Err(e) = indices::garantir_base(&handle) {
                eprintln!("falha ao preparar a base de índices: {e}");
            }
            // serviço local da porta de entrada padronizada (RF-9)
            let prefs = storage::ler_prefs(&handle).unwrap_or_default();
            entry::iniciar(handle, prefs.porta_entrada.unwrap_or(48591));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            obter_preferencias,
            salvar_preferencias,
            listar_calculos,
            carregar_calculo,
            salvar_calculo,
            excluir_calculo,
            salvar_pdf,
            obter_indices,
            salvar_indices,
            atualizar_indices,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o aplicativo");
}

type CmdResult<T> = Result<T, String>;

#[tauri::command]
fn obter_preferencias(app: tauri::AppHandle) -> CmdResult<Prefs> {
    storage::ler_prefs(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn salvar_preferencias(app: tauri::AppHandle, prefs: Prefs) -> CmdResult<()> {
    storage::gravar_prefs(&app, &prefs).map_err(|e| e.to_string())
}

#[tauri::command]
fn listar_calculos(app: tauri::AppHandle) -> CmdResult<Vec<serde_json::Value>> {
    storage::listar_calculos(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn carregar_calculo(app: tauri::AppHandle, id: String) -> CmdResult<serde_json::Value> {
    storage::carregar_calculo(&app, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn salvar_calculo(app: tauri::AppHandle, calculo: serde_json::Value) -> CmdResult<()> {
    storage::salvar_calculo(&app, &calculo).map_err(|e| e.to_string())
}

#[tauri::command]
fn excluir_calculo(app: tauri::AppHandle, id: String) -> CmdResult<()> {
    storage::excluir_calculo(&app, &id).map_err(|e| e.to_string())
}

/// Grava o PDF (bytes em base64) na pasta configurada, sem diálogo (RF-6).
#[tauri::command]
fn salvar_pdf(app: tauri::AppHandle, nome: String, dados_b64: String) -> CmdResult<String> {
    storage::salvar_pdf(&app, &nome, &dados_b64).map_err(|e| e.to_string())
}

#[tauri::command]
fn obter_indices(app: tauri::AppHandle) -> CmdResult<serde_json::Value> {
    indices::obter(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn salvar_indices(app: tauri::AppHandle, base: serde_json::Value) -> CmdResult<()> {
    indices::salvar(&app, &base).map_err(|e| e.to_string())
}

/// Busca meses faltantes em IBGE/Bacen (RNF-3). Roda fora da thread da UI.
#[tauri::command(async)]
fn atualizar_indices(app: tauri::AppHandle) -> CmdResult<serde_json::Value> {
    indices::atualizar(&app).map_err(|e| e.to_string())
}
