// RF-9 — Porta de entrada padronizada: serviço HTTP local (127.0.0.1) que
// recebe o payload { processo, orgao, requerente, requerido } da futura
// extensão do e-Proc, emite o evento "preencher-processo" para a UI e traz
// a janela ao primeiro plano.
//
// Endpoints:
//   GET  /ping       -> { "ok": true }
//   POST /preencher  -> { "ok": true }   (corpo: payload JSON)

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};

use tauri::{Emitter, Manager};

pub fn iniciar(app: tauri::AppHandle, porta: u16) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", porta)) {
            Ok(l) => l,
            Err(e) => {
                // porta ocupada (ex.: outra instância): segue sem o serviço
                eprintln!("porta de entrada {porta} indisponível: {e}");
                return;
            }
        };
        for conexao in listener.incoming() {
            if let Ok(stream) = conexao {
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = atender(app, stream);
                });
            }
        }
    });
}

fn atender(app: tauri::AppHandle, stream: TcpStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
    let mut leitor = BufReader::new(stream.try_clone()?);

    let mut linha_req = String::new();
    leitor.read_line(&mut linha_req)?;
    let mut partes = linha_req.split_whitespace();
    let metodo = partes.next().unwrap_or("").to_uppercase();
    let caminho = partes.next().unwrap_or("");

    let mut tamanho_corpo = 0usize;
    loop {
        let mut linha = String::new();
        if leitor.read_line(&mut linha)? == 0 || linha.trim().is_empty() {
            break;
        }
        if let Some(v) = linha.to_ascii_lowercase().strip_prefix("content-length:") {
            tamanho_corpo = v.trim().parse().unwrap_or(0);
        }
    }

    let resposta = match (metodo.as_str(), caminho) {
        ("GET", "/ping") => (200, r#"{"ok":true}"#.to_string()),
        ("POST", "/preencher") => {
            let mut corpo = vec![0u8; tamanho_corpo.min(64 * 1024)];
            leitor.read_exact(&mut corpo)?;
            match serde_json::from_slice::<serde_json::Value>(&corpo) {
                Ok(payload) => {
                    let _ = app.emit("preencher-processo", &payload);
                    focar_janela(&app);
                    (200, r#"{"ok":true}"#.to_string())
                }
                Err(e) => (400, format!(r#"{{"ok":false,"erro":"{e}"}}"#)),
            }
        }
        _ => (404, r#"{"ok":false,"erro":"rota desconhecida"}"#.to_string()),
    };

    let mut stream = leitor.into_inner();
    let status = match resposta.0 {
        200 => "200 OK",
        400 => "400 Bad Request",
        _ => "404 Not Found",
    };
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        resposta.1.len(),
        resposta.1
    )?;
    Ok(())
}

/// Traz a janela principal ao primeiro plano (RF-9).
fn focar_janela(app: &tauri::AppHandle) {
    if let Some(janela) = app.webview_windows().values().next() {
        let _ = janela.unminimize();
        let _ = janela.show();
        let _ = janela.set_focus();
    }
}
