use tokio::sync::broadcast;
use std::time::Duration;
use crate::ingest::pb::TickEventBatch;

// Stubbed out multiplexer for GDACS, GDELT, and NetBlocks
pub async fn start_multiplexer(_tx: broadcast::Sender<TickEventBatch>) {
    tokio::spawn(async move {
        loop {
            // Poll GDACS
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    });

    tokio::spawn(async move {
        loop {
            // Poll GDELT
            tokio::time::sleep(Duration::from_secs(900)).await;
        }
    });

    tokio::spawn(async move {
        loop {
            // Poll NetBlocks Cyber outages
            tokio::time::sleep(Duration::from_secs(600)).await;
        }
    });
}