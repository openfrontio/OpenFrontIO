use sha2::{Sha256, Digest};
use crate::geo::MapBounds;

pub mod pb {
    tonic::include_proto!("openfront.events");
}

pub struct IngestionEngine {
    bounds: MapBounds,
}

impl IngestionEngine {
    pub fn new(bounds: MapBounds) -> Self {
        Self { bounds }
    }

    pub async fn poll_and_process(&self, current_game_tick: u64) -> pb::TickEventBatch {
        let mut events = Vec::new();

        // Simulated Payload
        let raw_lat = 35.6892;
        let raw_lon = 139.6917;
        let magnitude = 7.1;

        if let Some((grid_x, grid_y)) = self.bounds.project_wgs84_to_grid(raw_lat, raw_lon) {
            let severity = (magnitude / 10.0) as f32;
            let radius_tiles = magnitude as f32 * 5.0;
            
            let mut hasher = Sha256::new();
            hasher.update(format!("EQ|{}|{}|{}|{}", grid_x, grid_y, current_game_tick, severity));
            let event_hash = hex::encode(hasher.finalize());

            events.push(pb::WorldHazardEvent {
                event_hash,
                center_x: grid_x,
                center_y: grid_y,
                severity,
                radius: radius_tiles,
                tick_applied: current_game_tick,
                category: pb::HazardCategory::HazardEarthquake as i32,
            });
        }

        pb::TickEventBatch {
            game_tick: current_game_tick,
            events,
        }
    }
}