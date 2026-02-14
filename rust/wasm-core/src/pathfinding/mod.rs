//! Pathfinding algorithms for OpenFront.io
//!
//! This module contains WASM-compiled pathfinding implementations
//! that replace the TypeScript versions for better performance.

mod astar_rail;
mod astar_water;
mod astar_water_bounded;
mod priority_queue;

pub use astar_rail::AStarRail;
pub use astar_water::AStarWater;
pub use astar_water_bounded::AStarWaterBounded;
pub use priority_queue::MinHeap;
