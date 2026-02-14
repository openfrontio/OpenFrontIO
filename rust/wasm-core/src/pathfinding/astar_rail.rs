//! A* pathfinding algorithm for rail navigation
//!
//! This is a direct port of the TypeScript AStarRail implementation
//! optimized for WASM execution.

use wasm_bindgen::prelude::*;

const LAND_BIT: u8 = 7;
const SHORELINE_BIT: u8 = 6;
const WATER_PENALTY: u32 = 5;
const DIRECTION_CHANGE_PENALTY: u32 = 3;
const HEURISTIC_WEIGHT: u32 = 2;

/// A* pathfinding for rail navigation
/// Uses stamping technique for efficient memory reuse without clearing arrays
#[wasm_bindgen]
pub struct AStarRail {
    terrain: Vec<u8>,
    width: u32,
    num_nodes: usize,
    max_iterations: u32,

    // Pre-allocated arrays for pathfinding
    closed_stamp: Vec<u32>,
    g_score_stamp: Vec<u32>,
    g_score: Vec<u32>,
    came_from: Vec<i32>,
    stamp: u32,

    // Priority queue (bucket queue for integer priorities)
    buckets: Vec<Vec<u32>>,
    min_bucket: usize,
    bucket_count: usize,
    queue_size: usize,
}

#[wasm_bindgen]
impl AStarRail {
    /// Create a new AStarRail pathfinder
    ///
    /// # Arguments
    /// * `terrain` - Uint8Array of terrain data
    /// * `width` - Map width
    /// * `height` - Map height
    /// * `max_iterations` - Maximum iterations before giving up (default 500_000)
    #[wasm_bindgen(constructor)]
    pub fn new(terrain: &[u8], width: u32, height: u32, max_iterations: Option<u32>) -> Self {
        let num_nodes = (width * height) as usize;
        let max_iterations = max_iterations.unwrap_or(500_000);

        // Calculate max priority for bucket queue
        // max cost per step = 1 + WATER_PENALTY + DIRECTION_CHANGE_PENALTY = 9
        // max heuristic = HEURISTIC_WEIGHT * (width + height)
        let max_cost = 1 + WATER_PENALTY + DIRECTION_CHANGE_PENALTY;
        let max_priority = (HEURISTIC_WEIGHT * (width + height) * max_cost) as usize;

        let mut buckets = Vec::with_capacity(max_priority + 1);
        for _ in 0..=max_priority {
            buckets.push(Vec::new());
        }

        Self {
            terrain: terrain.to_vec(),
            width,
            num_nodes,
            max_iterations,
            closed_stamp: vec![0; num_nodes],
            g_score_stamp: vec![0; num_nodes],
            g_score: vec![0; num_nodes],
            came_from: vec![-1; num_nodes],
            stamp: 1,
            buckets,
            min_bucket: 0,
            bucket_count: max_priority + 1,
            queue_size: 0,
        }
    }

    /// Find path from start to goal
    /// Returns null if no path found
    #[wasm_bindgen(js_name = findPath)]
    pub fn find_path(&mut self, start: u32, goal: u32) -> Option<Vec<u32>> {
        self.find_path_multi(&[start], goal)
    }

    /// Find path from multiple start positions to goal
    /// Returns null if no path found
    #[wasm_bindgen(js_name = findPathMulti)]
    pub fn find_path_multi(&mut self, starts: &[u32], goal: u32) -> Option<Vec<u32>> {
        // Increment stamp, reset if overflow
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.closed_stamp.fill(0);
            self.g_score_stamp.fill(0);
            self.stamp = 1;
        }

        let stamp = self.stamp;
        let width = self.width;
        let num_nodes = self.num_nodes;

        let goal_x = goal % width;
        let goal_y = goal / width;

        // Clear queue
        self.queue_clear();

        // Initialize with start positions
        for &s in starts {
            self.g_score[s as usize] = 0;
            self.g_score_stamp[s as usize] = stamp;
            self.came_from[s as usize] = -1;

            let sx = s % width;
            let sy = s / width;
            let h = Self::heuristic(sx, sy, goal_x, goal_y);
            self.queue_push(s, h);
        }

        let mut iterations = self.max_iterations;

        while self.queue_size > 0 {
            iterations -= 1;
            if iterations == 0 {
                return None;
            }

            let current = self.queue_pop();
            let current_idx = current as usize;

            if self.closed_stamp[current_idx] == stamp {
                continue;
            }
            self.closed_stamp[current_idx] = stamp;

            if current == goal {
                return Some(self.build_path(goal));
            }

            let current_g = self.g_score[current_idx];
            let prev = self.came_from[current_idx];
            let current_x = current % width;
            let from_shoreline = self.is_shoreline(current);

            // Process 4 neighbors (up, down, left, right)
            // Up
            if current >= width {
                let neighbor = current - width;
                self.try_neighbor(
                    neighbor,
                    goal,
                    current,
                    current_g,
                    prev,
                    goal_x,
                    goal_y,
                    stamp,
                    from_shoreline,
                );
            }

            // Down
            if current < (num_nodes - width as usize) as u32 {
                let neighbor = current + width;
                self.try_neighbor(
                    neighbor,
                    goal,
                    current,
                    current_g,
                    prev,
                    goal_x,
                    goal_y,
                    stamp,
                    from_shoreline,
                );
            }

            // Left
            if current_x != 0 {
                let neighbor = current - 1;
                self.try_neighbor(
                    neighbor,
                    goal,
                    current,
                    current_g,
                    prev,
                    goal_x,
                    goal_y,
                    stamp,
                    from_shoreline,
                );
            }

            // Right
            if current_x != width - 1 {
                let neighbor = current + 1;
                self.try_neighbor(
                    neighbor,
                    goal,
                    current,
                    current_g,
                    prev,
                    goal_x,
                    goal_y,
                    stamp,
                    from_shoreline,
                );
            }
        }

        None
    }

    #[inline(always)]
    fn is_water(&self, tile: u32) -> bool {
        (self.terrain[tile as usize] & (1 << LAND_BIT)) == 0
    }

    #[inline(always)]
    fn is_shoreline(&self, tile: u32) -> bool {
        (self.terrain[tile as usize] & (1 << SHORELINE_BIT)) != 0
    }

    #[inline(always)]
    fn is_traversable(&self, to: u32, from_shoreline: bool) -> bool {
        let to_water = self.is_water(to);
        if !to_water {
            return true;
        }
        from_shoreline || self.is_shoreline(to)
    }

    #[inline(always)]
    fn cost(&self, from: u32, to: u32, prev: i32) -> u32 {
        let penalized = self.is_water(to) || self.is_shoreline(to);
        let mut c = if penalized { 1 + WATER_PENALTY } else { 1 };

        if prev != -1 {
            let d1 = from as i32 - prev;
            let d2 = to as i32 - from as i32;
            if d1 != d2 {
                c += DIRECTION_CHANGE_PENALTY;
            }
        }

        c
    }

    #[inline(always)]
    fn heuristic(nx: u32, ny: u32, gx: u32, gy: u32) -> u32 {
        HEURISTIC_WEIGHT * (abs_diff(nx, gx) + abs_diff(ny, gy))
    }

    #[inline(always)]
    fn try_neighbor(
        &mut self,
        neighbor: u32,
        _goal: u32,
        current: u32,
        current_g: u32,
        prev: i32,
        goal_x: u32,
        goal_y: u32,
        stamp: u32,
        from_shoreline: bool,
    ) {
        let neighbor_idx = neighbor as usize;

        // Skip if closed
        if self.closed_stamp[neighbor_idx] == stamp {
            return;
        }

        // Check traversability
        if !self.is_traversable(neighbor, from_shoreline) {
            return;
        }

        let move_cost = self.cost(current, neighbor, prev);
        let tentative_g = current_g + move_cost;

        if self.g_score_stamp[neighbor_idx] != stamp || tentative_g < self.g_score[neighbor_idx] {
            self.came_from[neighbor_idx] = current as i32;
            self.g_score[neighbor_idx] = tentative_g;
            self.g_score_stamp[neighbor_idx] = stamp;

            let neighbor_x = neighbor % self.width;
            let neighbor_y = neighbor / self.width;
            let h = Self::heuristic(neighbor_x, neighbor_y, goal_x, goal_y);
            let f = tentative_g + h;
            self.queue_push(neighbor, f);
        }
    }

    fn build_path(&self, goal: u32) -> Vec<u32> {
        let mut path = Vec::new();
        let mut current = goal as i32;

        while current != -1 {
            path.push(current as u32);
            current = self.came_from[current as usize];
        }

        path.reverse();
        path
    }

    // Bucket queue implementation for integer priorities
    #[inline(always)]
    fn queue_push(&mut self, node: u32, priority: u32) {
        let bucket = (priority as usize).min(self.bucket_count - 1);
        self.buckets[bucket].push(node);
        self.queue_size += 1;
        if bucket < self.min_bucket {
            self.min_bucket = bucket;
        }
    }

    #[inline(always)]
    fn queue_pop(&mut self) -> u32 {
        while self.min_bucket < self.bucket_count {
            if let Some(node) = self.buckets[self.min_bucket].pop() {
                self.queue_size -= 1;
                return node;
            }
            self.min_bucket += 1;
        }
        0 // Should never reach here if queue_size > 0
    }

    #[inline(always)]
    fn queue_clear(&mut self) {
        for bucket in &mut self.buckets {
            bucket.clear();
        }
        self.min_bucket = 0;
        self.queue_size = 0;
    }
}

/// Absolute difference between two unsigned integers
#[inline(always)]
fn abs_diff(a: u32, b: u32) -> u32 {
    if a > b {
        a - b
    } else {
        b - a
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_map(width: u32, height: u32) -> Vec<u8> {
        // Create a map with all land (bit 7 set)
        vec![1 << LAND_BIT; (width * height) as usize]
    }

    #[test]
    fn test_simple_path_on_land() {
        let width = 10;
        let height = 10;
        let terrain = create_test_map(width, height);
        let mut pathfinder = AStarRail::new(&terrain, width, height, None);

        // Find path from (0,0) to (5,5)
        let start = 0;
        let goal = 5 * width + 5;
        let path = pathfinder.find_path(start, goal);

        assert!(path.is_some());
        let path = path.unwrap();
        assert_eq!(*path.first().unwrap(), start);
        assert_eq!(*path.last().unwrap(), goal);
    }

    #[test]
    fn test_path_via_shoreline() {
        let width = 5;
        let height = 3;
        // Create: [Land][Shoreline+Water][Water][Shoreline+Water][Land]
        //         [Land][Land]          [Land] [Land]           [Land]
        //         [Land][Land]          [Land] [Land]           [Land]
        let mut terrain = vec![1 << LAND_BIT; (width * height) as usize];

        // Set water with shoreline on row 0
        terrain[1] = (1 << SHORELINE_BIT); // Water + shoreline (no land bit)
        terrain[2] = 0; // Pure water (no land bit, no shoreline)
        terrain[3] = (1 << SHORELINE_BIT); // Water + shoreline (no land bit)

        let mut pathfinder = AStarRail::new(&terrain, width, height, None);

        // Find path from (0,0) to (4,0) - should go through shoreline tiles
        let start = 0;
        let goal = 4;
        let path = pathfinder.find_path(start, goal);

        // Should find a path via the shoreline or around
        assert!(path.is_some());
        let path = path.unwrap();
        assert_eq!(*path.first().unwrap(), start);
        assert_eq!(*path.last().unwrap(), goal);
    }

    #[test]
    fn test_no_path_through_water_without_shoreline() {
        let width = 3;
        let height = 3;
        // Create a map with water blocking the path (no shoreline)
        let mut terrain = vec![1 << LAND_BIT; (width * height) as usize];

        // Set middle column to pure water (no land bit, no shoreline)
        for y in 0..height {
            terrain[(y * width + 1) as usize] = 0;
        }

        let mut pathfinder = AStarRail::new(&terrain, width, height, None);

        // Find path from (0,0) to (2,0) - should fail due to water wall
        let start = 0;
        let goal = 2;
        let path = pathfinder.find_path(start, goal);

        assert!(path.is_none());
    }
}
