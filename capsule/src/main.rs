use std::pin::Pin;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tonic::{transport::Server, Request, Response, Status};

mod geo;
mod ingest;
mod multiplexer;

use ingest::pb::{world_monitor_streamer_server::{WorldMonitorStreamer, WorldMonitorStreamerServer}, SubscribeRequest, TickEventBatch};

pub struct MonitorService {
    tx: broadcast::Sender<TickEventBatch>,
}

#[tonic::async_trait]
impl WorldMonitorStreamer for MonitorService {
    type SubscribeToWorldEventsStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<TickEventBatch, Status>> + Send>>;

    async fn subscribe_to_world_events(
        &self,
        request: Request<SubscribeRequest>,
    ) -> Result<Response<Self::SubscribeToWorldEventsStream>, Status> {
        println!("Node.js Server connected: {:?}", request.into_inner().server_id);
        
        let rx = self.tx.subscribe();
        let stream = BroadcastStream::new(rx);
        
        let output_stream = tokio_stream::StreamExt::map(stream, |res| {
            match res {
                Ok(batch) => Ok(batch),
                Err(_) => Err(Status::internal("Capsule stream lagged")),
            }
        });

        Ok(Response::new(Box::pin(output_stream)))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "[::1]:50051".parse()?;
    let (tx, _) = broadcast::channel(1024);
    let service = MonitorService { tx: tx.clone() };

    // Start background ingestion workers
    let tx_clone = tx.clone();
    tokio::spawn(async move {
        multiplexer::start_multiplexer(tx_clone).await;
    });

    let engine = ingest::IngestionEngine::new(geo::MapBounds::new(10000, 10000));
    tokio::spawn(async move {
        let mut current_tick = 0;
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await; // 10 TPS
            let batch = engine.poll_and_process(current_tick).await;
            if !batch.events.is_empty() {
                let _ = tx.send(batch);
            }
            current_tick += 1;
        }
    });

    println!("RealFront World Monitor Capsule running on {}", addr);
    Server::builder()
        .add_service(WorldMonitorStreamerServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}