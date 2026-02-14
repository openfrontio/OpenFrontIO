use axum::body::{Body, Bytes};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{OriginalUri, State};
use axum::http::{header, HeaderMap, HeaderName, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::{Json, Router};
use futures_util::{future::join_all, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, RwLock};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message as UpstreamWsMessage;
use url::Url;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum ControlPlaneMode {
    Proxy,
    Standalone,
}

impl ControlPlaneMode {
    fn parse(value: &str) -> Self {
        match value {
            "standalone" | "masterless" => Self::Standalone,
            _ => Self::Proxy,
        }
    }
}

#[derive(Clone)]
struct AppState {
    config: Arc<ControlPlaneConfig>,
    ports: Arc<PortsResponse>,
    http_client: reqwest::Client,
    public_lobbies: Arc<RwLock<PublicLobbiesPayload>>,
    lobbies_updates_tx: broadcast::Sender<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlPlaneConfig {
    env: String,
    mode: ControlPlaneMode,
    bind_addr: String,
    bind_port: u16,
    worker_count: u16,
    upstream_master_port: u16,
    upstream_worker_base_port: u16,
    upstream_master_base_url: String,
    upstream_worker_base_url: String,
    matchmaking_upstream_url: Option<String>,
    request_timeout_ms: u64,
    lobby_poll_ms: u64,
    static_dir: String,
    instance_id: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct PublicLobbiesPayload {
    lobbies: Vec<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyResponse {
    ready: bool,
    service: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortsResponse {
    master_base_url: String,
    worker_base_url_pattern: String,
    lobbies_websocket_url: String,
}

#[derive(Serialize)]
struct EnvApiResponse {
    game_env: String,
}

fn env_u16(name: &str, default: u16) -> u16 {
    match env::var(name) {
        Ok(value) => value.parse::<u16>().unwrap_or(default),
        Err(_) => default,
    }
}

fn env_u64(name: &str, default: u64) -> u64 {
    match env::var(name) {
        Ok(value) => value.parse::<u64>().unwrap_or(default),
        Err(_) => default,
    }
}

fn default_worker_count(env_name: &str) -> u16 {
    match env_name {
        "prod" | "production" => 20,
        "staging" => 2,
        _ => 2,
    }
}

fn load_config() -> ControlPlaneConfig {
    let env_name = env::var("GAME_ENV").unwrap_or_else(|_| "dev".to_string());
    let mode = ControlPlaneMode::parse(
        &env::var("CONTROL_PLANE_MODE").unwrap_or_else(|_| "proxy".to_string()),
    );
    let bind_addr = env::var("CONTROL_PLANE_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0".to_string());
    let bind_port = env_u16("CONTROL_PLANE_PORT", 3100);

    let upstream_master_port = env_u16("MASTER_PORT", 3000);
    let upstream_worker_base_port = env_u16("WORKER_BASE_PORT", 3001);

    let upstream_master_base_url = env::var("CONTROL_PLANE_UPSTREAM_MASTER_URL")
        .unwrap_or_else(|_| format!("http://127.0.0.1:{upstream_master_port}"));
    let upstream_worker_base_url = env::var("CONTROL_PLANE_UPSTREAM_WORKER_BASE_URL")
        .unwrap_or_else(|_| format!("http://127.0.0.1:{upstream_worker_base_port}"));
    let matchmaking_upstream_url = env::var("CONTROL_PLANE_MATCHMAKING_UPSTREAM_URL").ok();

    let worker_count = env::var("CONTROL_PLANE_WORKER_COUNT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| *value > 0)
        .unwrap_or_else(|| default_worker_count(&env_name));

    let lobby_poll_ms = env_u64("CONTROL_PLANE_LOBBY_POLL_MS", 1000).max(200);
    let request_timeout_ms = env_u64("CONTROL_PLANE_REQUEST_TIMEOUT_MS", 5000);

    let static_dir = env::var("CONTROL_PLANE_STATIC_DIR").unwrap_or_else(|_| {
        if Path::new("../static").exists() {
            "../static".to_string()
        } else {
            "static".to_string()
        }
    });

    let instance_id = env::var("INSTANCE_ID").ok();

    ControlPlaneConfig {
        env: env_name,
        mode,
        bind_addr,
        bind_port,
        worker_count,
        upstream_master_port,
        upstream_worker_base_port,
        upstream_master_base_url,
        upstream_worker_base_url,
        matchmaking_upstream_url,
        request_timeout_ms,
        lobby_poll_ms,
        static_dir,
        instance_id,
    }
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "openfront-control-plane",
    })
}

async fn readyz(State(state): State<AppState>) -> impl IntoResponse {
    let ready = if state.config.mode == ControlPlaneMode::Standalone {
        all_workers_ready(&state).await
    } else {
        true
    };
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(ReadyResponse {
            ready,
            service: "openfront-control-plane",
        }),
    )
}

async fn configz(State(state): State<AppState>) -> Json<ControlPlaneConfig> {
    Json((*state.config).clone())
}

async fn ports(State(state): State<AppState>) -> Json<PortsResponse> {
    Json((*state.ports).clone())
}

async fn env_api(State(state): State<AppState>) -> Json<EnvApiResponse> {
    Json(EnvApiResponse {
        game_env: state.config.env.clone(),
    })
}

async fn public_lobbies(State(state): State<AppState>) -> Result<Response, StatusCode> {
    if state.config.mode == ControlPlaneMode::Standalone {
        let payload = state.public_lobbies.read().await.clone();
        return Ok(Json(payload).into_response());
    }

    let target_url = join_base_with_path(
        &state.config.upstream_master_base_url,
        "/api/public_lobbies",
    )
    .map_err(|error| {
        eprintln!("failed to build /api/public_lobbies proxy target: {error}");
        StatusCode::BAD_GATEWAY
    })?;
    proxy_http_request(
        &state,
        Method::GET,
        HeaderMap::new(),
        Bytes::new(),
        target_url,
    )
    .await
}

async fn lobbies_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    uri: OriginalUri,
) -> Response {
    let path_with_query = path_and_query(&uri).to_string();

    if state.config.mode == ControlPlaneMode::Standalone {
        return ws
            .on_upgrade(move |client_socket| async move {
                if let Err(error) = bridge_local_lobbies_ws(client_socket, state).await {
                    eprintln!("standalone lobbies websocket failed: {error}");
                }
            })
            .into_response();
    }

    let upstream_url = match websocket_url(&state.config.upstream_master_base_url, &path_with_query)
    {
        Ok(url) => url,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("failed to derive upstream websocket url: {error}"),
            )
                .into_response();
        }
    };

    ws.on_upgrade(move |client_socket| async move {
        if let Err(error) = bridge_websocket_to_upstream(client_socket, upstream_url).await {
            eprintln!("websocket bridge failed: {error}");
        }
    })
    .into_response()
}

async fn matchmaking_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    uri: OriginalUri,
) -> Response {
    let path_with_query = path_and_query(&uri).to_string();
    let upstream_base = match state.config.mode {
        ControlPlaneMode::Proxy => Some(state.config.upstream_master_base_url.clone()),
        ControlPlaneMode::Standalone => state.config.matchmaking_upstream_url.clone(),
    };

    let Some(upstream_base) = upstream_base else {
        return (
            StatusCode::NOT_IMPLEMENTED,
            "matchmaking websocket is not configured in standalone mode",
        )
            .into_response();
    };

    let upstream_url = match websocket_url(&upstream_base, &path_with_query) {
        Ok(url) => url,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("failed to derive matchmaking websocket url: {error}"),
            )
                .into_response();
        }
    };

    ws.on_upgrade(move |client_socket| async move {
        if let Err(error) = bridge_websocket_to_upstream(client_socket, upstream_url).await {
            eprintln!("matchmaking websocket bridge failed: {error}");
        }
    })
    .into_response()
}

fn path_and_query(uri: &OriginalUri) -> &str {
    uri.0
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/")
}

fn extract_worker_id(path: &str) -> Option<u16> {
    let stripped = path.strip_prefix("/w")?;
    let mut end = 0usize;

    for byte in stripped.as_bytes() {
        if byte.is_ascii_digit() {
            end += 1;
        } else {
            break;
        }
    }

    if end == 0 {
        return None;
    }

    if let Some(next) = stripped.as_bytes().get(end) {
        if *next != b'/' {
            return None;
        }
    }

    stripped[..end].parse::<u16>().ok()
}

fn join_base_with_path(base: &str, incoming_path_and_query: &str) -> Result<Url, String> {
    let mut url = Url::parse(base).map_err(|err| format!("invalid base url `{base}`: {err}"))?;

    let sanitized = if incoming_path_and_query.is_empty() {
        "/"
    } else {
        incoming_path_and_query
    };

    let (path, query) = match sanitized.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (sanitized, None),
    };

    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };

    url.set_path(&normalized_path);
    url.set_query(query);

    Ok(url)
}

fn worker_base_url(base: &str, worker_id: u16) -> Result<Url, String> {
    let mut url =
        Url::parse(base).map_err(|err| format!("invalid worker base url `{base}`: {err}"))?;
    let base_port = url
        .port_or_known_default()
        .ok_or_else(|| format!("worker base url `{base}` does not expose a port"))?;

    let worker_port = base_port as u32 + worker_id as u32;
    if worker_port > u16::MAX as u32 {
        return Err(format!(
            "worker id `{worker_id}` overflows port derived from `{base}`"
        ));
    }

    url.set_port(Some(worker_port as u16))
        .map_err(|_| format!("failed to set worker port from `{base}`"))?;
    Ok(url)
}

fn worker_upstream_url(
    worker_base: &str,
    worker_id: u16,
    incoming_path_and_query: &str,
) -> Result<Url, String> {
    let worker_url = worker_base_url(worker_base, worker_id)?;
    join_base_with_path(worker_url.as_str(), incoming_path_and_query)
}

fn websocket_url(base: &str, incoming_path_and_query: &str) -> Result<Url, String> {
    let mut url = join_base_with_path(base, incoming_path_and_query)?;
    match url.scheme() {
        "http" => {
            let _ = url.set_scheme("ws");
        }
        "https" => {
            let _ = url.set_scheme("wss");
        }
        "ws" | "wss" => {}
        scheme => {
            return Err(format!(
                "unsupported scheme `{scheme}` while deriving websocket url"
            ));
        }
    }

    Ok(url)
}

fn is_hop_by_hop_header(name: &HeaderName) -> bool {
    matches!(
        name.as_str().to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailers"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn is_websocket_upgrade(headers: &HeaderMap) -> bool {
    let Some(upgrade) = headers.get(header::UPGRADE) else {
        return false;
    };
    let Ok(upgrade) = upgrade.to_str() else {
        return false;
    };
    upgrade.eq_ignore_ascii_case("websocket")
}

async fn proxy_http_request(
    state: &AppState,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
    target_url: Url,
) -> Result<Response, StatusCode> {
    let mut request_builder = state.http_client.request(method, target_url);

    for (name, value) in headers.iter() {
        if name == header::HOST || is_hop_by_hop_header(name) {
            continue;
        }
        request_builder = request_builder.header(name, value);
    }

    let upstream_response = request_builder.body(body).send().await.map_err(|error| {
        eprintln!("proxy request failed: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    let status = upstream_response.status();
    let upstream_headers = upstream_response.headers().clone();
    let upstream_body = upstream_response.bytes().await.map_err(|error| {
        eprintln!("proxy body read failed: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    let mut response_builder = Response::builder().status(status);
    for (name, value) in upstream_headers.iter() {
        if is_hop_by_hop_header(name) {
            continue;
        }
        response_builder = response_builder.header(name, value);
    }

    response_builder
        .body(Body::from(upstream_body))
        .map_err(|error| {
            eprintln!("proxy response build failed: {error}");
            StatusCode::BAD_GATEWAY
        })
}

async fn proxy_or_serve_fallback_impl(
    state: &AppState,
    method: Method,
    headers: HeaderMap,
    uri: OriginalUri,
    body: Bytes,
) -> Result<Response, StatusCode> {
    let path = uri.0.path();
    let path_with_query = path_and_query(&uri);

    if let Some(worker_id) = extract_worker_id(path) {
        let target_url = worker_upstream_url(
            &state.config.upstream_worker_base_url,
            worker_id,
            path_with_query,
        )
        .map_err(|error| {
            eprintln!("failed to build worker upstream target url: {error}");
            StatusCode::BAD_GATEWAY
        })?;

        return proxy_http_request(state, method, headers, body, target_url).await;
    }

    if state.config.mode == ControlPlaneMode::Standalone {
        if path.starts_with("/api/") {
            return Ok((StatusCode::NOT_FOUND, "not found").into_response());
        }
        return serve_static(state, path).await;
    }

    let target_url = join_base_with_path(&state.config.upstream_master_base_url, path_with_query)
        .map_err(|error| {
        eprintln!("failed to build upstream target url for `{path_with_query}`: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    proxy_http_request(state, method, headers, body, target_url).await
}

async fn get_fallback_with_ws(
    ws_upgrade: Result<WebSocketUpgrade, axum::extract::ws::rejection::WebSocketUpgradeRejection>,
    State(state): State<AppState>,
    headers: HeaderMap,
    uri: OriginalUri,
) -> Result<Response, StatusCode> {
    let path = uri.0.path();
    let path_with_query = path_and_query(&uri);

    if let Some(worker_id) = extract_worker_id(path) {
        if is_websocket_upgrade(&headers) {
            if let Ok(ws) = ws_upgrade {
                let worker_base =
                    worker_base_url(&state.config.upstream_worker_base_url, worker_id).map_err(
                        |error| {
                            eprintln!("failed to build worker base url: {error}");
                            StatusCode::BAD_GATEWAY
                        },
                    )?;
                let upstream_ws =
                    websocket_url(worker_base.as_str(), path_with_query).map_err(|error| {
                        eprintln!("failed to build worker websocket url: {error}");
                        StatusCode::BAD_GATEWAY
                    })?;
                let response: Response = ws
                    .on_upgrade(move |client_socket| async move {
                        if let Err(error) =
                            bridge_websocket_to_upstream(client_socket, upstream_ws).await
                        {
                            eprintln!("worker websocket bridge failed: {error}");
                        }
                    })
                    .into_response();
                return Ok(response);
            }
        }
    }

    proxy_or_serve_fallback_impl(&state, Method::GET, headers, uri, Bytes::new()).await
}

async fn proxy_or_serve_fallback(
    State(state): State<AppState>,
    method: Method,
    headers: HeaderMap,
    uri: OriginalUri,
    body: Bytes,
) -> Result<Response, StatusCode> {
    proxy_or_serve_fallback_impl(&state, method, headers, uri, body).await
}

async fn bridge_websocket_to_upstream(
    client_socket: WebSocket,
    upstream_url: Url,
) -> Result<(), String> {
    let (upstream_socket, _) = connect_async(upstream_url.as_str())
        .await
        .map_err(|error| {
            format!("failed to connect upstream websocket `{upstream_url}`: {error}")
        })?;

    let (mut client_sender, mut client_receiver) = client_socket.split();
    let (mut upstream_sender, mut upstream_receiver) = upstream_socket.split();

    let client_to_upstream = async {
        while let Some(message_result) = client_receiver.next().await {
            let message = message_result
                .map_err(|error| format!("client websocket receive failed: {error}"))?;

            let mapped = match message {
                Message::Text(text) => UpstreamWsMessage::Text(text.to_string().into()),
                Message::Binary(binary) => UpstreamWsMessage::Binary(binary.to_vec()),
                Message::Ping(payload) => UpstreamWsMessage::Ping(payload.to_vec()),
                Message::Pong(payload) => UpstreamWsMessage::Pong(payload.to_vec()),
                Message::Close(_) => {
                    let _ = upstream_sender.send(UpstreamWsMessage::Close(None)).await;
                    break;
                }
            };

            upstream_sender
                .send(mapped)
                .await
                .map_err(|error| format!("upstream websocket send failed: {error}"))?;
        }

        Ok::<(), String>(())
    };

    let upstream_to_client = async {
        while let Some(message_result) = upstream_receiver.next().await {
            let message = message_result
                .map_err(|error| format!("upstream websocket receive failed: {error}"))?;

            let mapped = match message {
                UpstreamWsMessage::Text(text) => Message::Text(text.into()),
                UpstreamWsMessage::Binary(binary) => Message::Binary(binary.into()),
                UpstreamWsMessage::Ping(payload) => Message::Ping(payload.into()),
                UpstreamWsMessage::Pong(payload) => Message::Pong(payload.into()),
                UpstreamWsMessage::Close(_) => {
                    let _ = client_sender.send(Message::Close(None)).await;
                    break;
                }
                UpstreamWsMessage::Frame(_) => {
                    continue;
                }
            };

            client_sender
                .send(mapped)
                .await
                .map_err(|error| format!("client websocket send failed: {error}"))?;
        }

        Ok::<(), String>(())
    };

    tokio::select! {
        result = client_to_upstream => result?,
        result = upstream_to_client => result?,
    }

    let _ = client_sender.close().await;
    let _ = upstream_sender.close().await;

    Ok(())
}

async fn bridge_local_lobbies_ws(client_socket: WebSocket, state: AppState) -> Result<(), String> {
    let (mut sender, mut receiver) = client_socket.split();
    let initial = {
        let payload = state.public_lobbies.read().await.clone();
        lobbies_update_message(&payload)
    };
    sender
        .send(Message::Text(initial.into()))
        .await
        .map_err(|error| format!("failed to send initial lobbies payload: {error}"))?;

    let mut updates = state.lobbies_updates_tx.subscribe();
    loop {
        tokio::select! {
            inbound = receiver.next() => {
                match inbound {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        sender.send(Message::Pong(payload)).await.map_err(|error| {
                            format!("failed to send pong to lobbies client: {error}")
                        })?;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(format!("lobbies client receive failed: {error}")),
                }
            }
            update = updates.recv() => {
                match update {
                    Ok(message) => {
                        sender.send(Message::Text(message.into())).await.map_err(|error| {
                            format!("failed to send lobbies update to client: {error}")
                        })?;
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let payload = state.public_lobbies.read().await.clone();
                        let catch_up = lobbies_update_message(&payload);
                        sender.send(Message::Text(catch_up.into())).await.map_err(|error| {
                            format!("failed to send catch-up lobbies update: {error}")
                        })?;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    let _ = sender.close().await;
    Ok(())
}

fn lobbies_update_message(payload: &PublicLobbiesPayload) -> String {
    json!({
        "type": "lobbies_update",
        "data": payload,
    })
    .to_string()
}

async fn all_workers_ready(state: &AppState) -> bool {
    let checks = (0..state.config.worker_count).map(|worker_id| async move {
        let path = format!("/w{worker_id}/readyz");
        let target_url =
            match worker_upstream_url(&state.config.upstream_worker_base_url, worker_id, &path) {
                Ok(url) => url,
                Err(error) => {
                    eprintln!("failed to build worker readyz url for worker {worker_id}: {error}");
                    return false;
                }
            };
        match state.http_client.get(target_url).send().await {
            Ok(response) => response.status().is_success(),
            Err(error) => {
                eprintln!("worker {worker_id} readiness check failed: {error}");
                false
            }
        }
    });

    let statuses = join_all(checks).await;
    statuses.into_iter().all(|status| status)
}

async fn start_lobbies_poll_loop(state: AppState) {
    if let Err(error) = refresh_public_lobbies(&state).await {
        eprintln!("failed initial lobbies refresh: {error}");
    }

    let mut ticker = tokio::time::interval(Duration::from_millis(state.config.lobby_poll_ms));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        if let Err(error) = refresh_public_lobbies(&state).await {
            eprintln!("failed lobbies refresh: {error}");
        }
    }
}

async fn refresh_public_lobbies(state: &AppState) -> Result<(), String> {
    let fetches = (0..state.config.worker_count)
        .map(|worker_id| fetch_worker_public_lobbies(state, worker_id));
    let results = join_all(fetches).await;

    let mut by_id: BTreeMap<String, Value> = BTreeMap::new();
    for worker_lobbies in results {
        for lobby in worker_lobbies {
            let Some(game_id) = lobby.get("gameID").and_then(Value::as_str) else {
                continue;
            };
            if game_id.is_empty() {
                continue;
            }
            by_id.insert(game_id.to_string(), lobby);
        }
    }

    let payload = PublicLobbiesPayload {
        lobbies: by_id.into_values().collect(),
    };

    let changed = {
        let mut current = state.public_lobbies.write().await;
        if *current == payload {
            false
        } else {
            *current = payload.clone();
            true
        }
    };

    if changed {
        let _ = state
            .lobbies_updates_tx
            .send(lobbies_update_message(&payload));
    }

    Ok(())
}

async fn fetch_worker_public_lobbies(state: &AppState, worker_id: u16) -> Vec<Value> {
    let path = format!("/w{worker_id}/api/public_lobbies");
    let target_url =
        match worker_upstream_url(&state.config.upstream_worker_base_url, worker_id, &path) {
            Ok(url) => url,
            Err(error) => {
                eprintln!(
                    "failed to build worker public_lobbies url for worker {worker_id}: {error}"
                );
                return Vec::new();
            }
        };

    let response = match state.http_client.get(target_url).send().await {
        Ok(response) => response,
        Err(error) => {
            eprintln!("worker {worker_id} public_lobbies request failed: {error}");
            return Vec::new();
        }
    };

    if !response.status().is_success() {
        return Vec::new();
    }

    let payload = match response.json::<Value>().await {
        Ok(payload) => payload,
        Err(error) => {
            eprintln!("worker {worker_id} public_lobbies payload parse failed: {error}");
            return Vec::new();
        }
    };

    payload
        .get("lobbies")
        .and_then(Value::as_array)
        .map(|lobbies| {
            lobbies
                .iter()
                .filter(|value| value.is_object())
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn sanitize_relative_path(request_path: &str) -> Option<PathBuf> {
    let stripped = request_path.trim_start_matches('/');
    if stripped.is_empty() {
        return Some(PathBuf::new());
    }

    let path = Path::new(stripped);
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => result.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    Some(result)
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
    {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "wasm" => "application/wasm",
        "map" => "application/json; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn is_html(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("html"))
        .unwrap_or(false)
}

fn is_static_cacheable_asset(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default(),
        "js" | "css" | "svg" | "bin" | "dat" | "exe" | "dll" | "so" | "dylib"
    )
}

async fn serve_static(state: &AppState, request_path: &str) -> Result<Response, StatusCode> {
    let static_root = PathBuf::from(&state.config.static_dir);
    let relative_path = sanitize_relative_path(request_path).ok_or(StatusCode::BAD_REQUEST)?;

    let index_path = static_root.join("index.html");
    let requested_path = if relative_path.as_os_str().is_empty() {
        index_path.clone()
    } else {
        static_root.join(&relative_path)
    };

    let file_path = if requested_path.is_file() {
        requested_path
    } else if relative_path.extension().is_none() {
        index_path
    } else {
        return Ok((StatusCode::NOT_FOUND, "not found").into_response());
    };

    let body = tokio::fs::read(&file_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let mut response_builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type_for_path(&file_path));

    if is_html(&file_path) {
        response_builder = response_builder
            .header(
                header::CACHE_CONTROL,
                "no-store, no-cache, must-revalidate, proxy-revalidate",
            )
            .header(header::PRAGMA, "no-cache")
            .header(header::EXPIRES, "0")
            .header(header::ETAG, "");
    } else if is_static_cacheable_asset(&file_path) {
        response_builder =
            response_builder.header(header::CACHE_CONTROL, "public, max-age=31536000, immutable");
    }

    response_builder.body(Body::from(body)).map_err(|error| {
        eprintln!("failed to build static response: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Arc::new(load_config());
    let public_base_url = env::var("CONTROL_PLANE_PUBLIC_BASE_URL")
        .unwrap_or_else(|_| format!("http://127.0.0.1:{}", config.bind_port));
    let ports_response = Arc::new(PortsResponse {
        master_base_url: if config.mode == ControlPlaneMode::Standalone {
            public_base_url.clone()
        } else {
            config.upstream_master_base_url.clone()
        },
        worker_base_url_pattern: if config.mode == ControlPlaneMode::Standalone {
            format!("{public_base_url}/w<worker_id>")
        } else {
            format!("{} + <worker_id>", config.upstream_worker_base_url)
        },
        lobbies_websocket_url: match websocket_url(&public_base_url, "/lobbies") {
            Ok(url) => url.to_string(),
            Err(_) => "ws://invalid/lobbies".to_string(),
        },
    });

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.request_timeout_ms))
        .build()?;

    let (lobbies_updates_tx, _) = broadcast::channel::<String>(64);
    let state = AppState {
        config: Arc::clone(&config),
        ports: ports_response,
        http_client,
        public_lobbies: Arc::new(RwLock::new(PublicLobbiesPayload::default())),
        lobbies_updates_tx,
    };

    if config.mode == ControlPlaneMode::Standalone {
        tokio::spawn(start_lobbies_poll_loop(state.clone()));
    }

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/configz", get(configz))
        .route("/api/env", get(env_api))
        .route("/api/public_lobbies", get(public_lobbies))
        .route("/v1/metadata/ports", get(ports))
        .route("/lobbies", get(lobbies_ws))
        .route("/matchmaking/join", get(matchmaking_ws))
        .route("/{*rest}", get(get_fallback_with_ws))
        .fallback(any(proxy_or_serve_fallback))
        .with_state(state);

    let bind_ip: IpAddr = config
        .bind_addr
        .parse()
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let addr = SocketAddr::from((bind_ip, config.bind_port));

    println!(
        "openfront-control-plane listening on {} (env={}, mode={:?}, upstreamMaster={}, upstreamWorkerBase={}, workers={})",
        addr,
        config.env,
        config.mode,
        config.upstream_master_base_url,
        config.upstream_worker_base_url,
        config.worker_count
    );

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state(mode: ControlPlaneMode) -> AppState {
        let config = Arc::new(ControlPlaneConfig {
            env: "dev".to_string(),
            mode,
            bind_addr: "127.0.0.1".to_string(),
            bind_port: 3199,
            worker_count: 2,
            upstream_master_port: 3000,
            upstream_worker_base_port: 3001,
            upstream_master_base_url: "http://127.0.0.1:3000".to_string(),
            upstream_worker_base_url: "http://127.0.0.1:3001".to_string(),
            matchmaking_upstream_url: None,
            request_timeout_ms: 1500,
            lobby_poll_ms: 1000,
            static_dir: "../static".to_string(),
            instance_id: Some("instance-a".to_string()),
        });
        let ports = Arc::new(PortsResponse {
            master_base_url: "http://127.0.0.1:3000".to_string(),
            worker_base_url_pattern: "http://127.0.0.1:3001 + <worker_id>".to_string(),
            lobbies_websocket_url: "ws://127.0.0.1:3000/lobbies".to_string(),
        });
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()
            .expect("client should build");
        let (lobbies_updates_tx, _) = broadcast::channel::<String>(16);

        AppState {
            config,
            ports,
            http_client,
            public_lobbies: Arc::new(RwLock::new(PublicLobbiesPayload::default())),
            lobbies_updates_tx,
        }
    }

    #[tokio::test]
    async fn env_api_matches_master_contract_shape() {
        let state = test_state(ControlPlaneMode::Proxy);
        let Json(response) = env_api(State(state)).await;
        assert_eq!(response.game_env, "dev");
    }

    #[tokio::test]
    async fn configz_includes_proxy_metadata() {
        let state = test_state(ControlPlaneMode::Proxy);
        let Json(response) = configz(State(state)).await;
        assert_eq!(response.bind_port, 3199);
        assert_eq!(response.mode, ControlPlaneMode::Proxy);
        assert_eq!(response.upstream_master_port, 3000);
        assert_eq!(response.upstream_master_base_url, "http://127.0.0.1:3000");
        assert_eq!(response.upstream_worker_base_url, "http://127.0.0.1:3001");
        assert_eq!(response.instance_id.as_deref(), Some("instance-a"));
    }

    #[test]
    fn worker_id_extraction_matches_worker_route_shape() {
        assert_eq!(extract_worker_id("/w0/api/game/id"), Some(0));
        assert_eq!(extract_worker_id("/w12/game/abcd"), Some(12));
        assert_eq!(extract_worker_id("/w/api/game/id"), None);
        assert_eq!(extract_worker_id("/w12x/game/id"), None);
        assert_eq!(extract_worker_id("/api/game/id"), None);
    }

    #[test]
    fn worker_url_builder_offsets_port_by_worker_id() {
        let url = worker_upstream_url("http://127.0.0.1:3001", 7, "/w7/api/game/id")
            .expect("worker url should build");
        assert_eq!(url.as_str(), "http://127.0.0.1:3008/w7/api/game/id");
    }

    #[test]
    fn websocket_url_builder_converts_http_scheme() {
        let ws_url =
            websocket_url("http://127.0.0.1:3000", "/lobbies").expect("ws url should build");
        assert_eq!(ws_url.as_str(), "ws://127.0.0.1:3000/lobbies");

        let wss_url =
            websocket_url("https://openfront.io", "/lobbies?v=1").expect("wss url should build");
        assert_eq!(wss_url.as_str(), "wss://openfront.io/lobbies?v=1");
    }

    #[test]
    fn mode_parser_accepts_standalone_aliases() {
        assert_eq!(ControlPlaneMode::parse("proxy"), ControlPlaneMode::Proxy);
        assert_eq!(
            ControlPlaneMode::parse("standalone"),
            ControlPlaneMode::Standalone
        );
        assert_eq!(
            ControlPlaneMode::parse("masterless"),
            ControlPlaneMode::Standalone
        );
    }

    #[test]
    fn worker_count_defaults_by_environment() {
        assert_eq!(default_worker_count("dev"), 2);
        assert_eq!(default_worker_count("staging"), 2);
        assert_eq!(default_worker_count("prod"), 20);
    }

    #[test]
    fn sanitize_relative_path_rejects_parent_segments() {
        assert_eq!(
            sanitize_relative_path("/assets/index.js"),
            Some(PathBuf::from("assets/index.js"))
        );
        assert!(sanitize_relative_path("/../../etc/passwd").is_none());
    }

    #[tokio::test]
    async fn standalone_public_lobbies_returns_cached_payload() {
        let state = test_state(ControlPlaneMode::Standalone);
        {
            let mut payload = state.public_lobbies.write().await;
            payload.lobbies = vec![json!({ "gameID": "abc" })];
        }

        let response = public_lobbies(State(state))
            .await
            .expect("public lobbies response should succeed");
        assert_eq!(response.status(), StatusCode::OK);
    }
}
