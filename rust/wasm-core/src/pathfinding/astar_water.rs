//! A* pathfinding algorithm for water navigation
//!
//! This is a direct port of the TypeScript AStarWater implementation
//! optimized for WASM execution.

use wasm_bindgen::prelude::*;

const LAND_BIT: u8 = 7; // Bit 7 in terrain indicates land
const MAGNITUDE_MASK: u8 = 0x1f;
const COST_SCALE: u32 = 100;
const BASE_COST: u32 = 1 * COST_SCALE;

/// Get penalty based on water magnitude (distance from shore)
/// Prefer magnitude 3-10 (3-10 tiles from shore)
#[inline(always)]
fn get_magnitude_penalty(magnitude: u8) -> u32 {
    if magnitude < 3 {
        10 * COST_SCALE // too close to shore
    } else if magnitude <= 10 {
        0 // sweet spot
    } else {
        1 * COST_SCALE // deep water, slight penalty
    }
}

/// A* pathfinding for water navigation
/// Uses stamping technique for efficient memory reuse without clearing arrays
#[wasm_bindgen]
pub struct AStarWater {
    terrain: Vec<u8>,
    width: u32,
    num_nodes: usize,
    heuristic_weight: u32,
    max_iterations: u32,

    // Pre-allocated arrays for pathfinding
    closed_stamp: Vec<u32>,
    g_score_stamp: Vec<u32>,
    g_score: Vec<u32>,
    came_from: Vec<i32>,
    stamp: u32,

    // Priority queue (inline min-heap for performance)
    heap_nodes: Vec<u32>,
    heap_priorities: Vec<u32>,
    heap_size: usize,
}

#[wasm_bindgen]
impl AStarWater {
    /// Create a new AStarWater pathfinder
    ///
    /// # Arguments
    /// * `terrain` - Uint8Array of terrain data
    /// * `width` - Map width
    /// * `height` - Map height
    /// * `heuristic_weight` - Weight for heuristic (default 5)
    /// * `max_iterations` - Maximum iterations before giving up (default 1_000_000)
    #[wasm_bindgen(constructor)]
    pub fn new(
        terrain: &[u8],
        width: u32,
        height: u32,
        heuristic_weight: Option<u32>,
        max_iterations: Option<u32>,
    ) -> Self {
        let num_nodes = (width * height) as usize;
        let heuristic_weight = heuristic_weight.unwrap_or(5);
        let max_iterations = max_iterations.unwrap_or(1_000_000);

        Self {
            terrain: terrain.to_vec(),
            width,
            num_nodes,
            heuristic_weight,
            max_iterations,
            closed_stamp: vec![0; num_nodes],
            g_score_stamp: vec![0; num_nodes],
            g_score: vec![0; num_nodes],
            came_from: vec![-1; num_nodes],
            stamp: 1,
            heap_nodes: vec![0; num_nodes],
            heap_priorities: vec![0; num_nodes],
            heap_size: 0,
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
        // Increment stamp, reset if overflow (wrapping_add handles u32 overflow)
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.closed_stamp.fill(0);
            self.g_score_stamp.fill(0);
            self.stamp = 1;
        }

        let stamp = self.stamp;
        let width = self.width;
        let num_nodes = self.num_nodes;
        let land_mask = 1u8 << LAND_BIT;
        let weight = self.heuristic_weight;

        let goal_x = goal % width;
        let goal_y = goal / width;

        // Clear heap
        self.heap_size = 0;

        // Cross-product tie-breaker setup
        let s0 = starts[0];
        let start_x = s0 % width;
        let start_y = s0 / width;
        let dx_goal = goal_x as i32 - start_x as i32;
        let dy_goal = goal_y as i32 - start_y as i32;
        let cross_norm = (dx_goal.abs() + dy_goal.abs()).max(1) as u32;

        // Initialize with start positions
        for &s in starts {
            self.g_score[s as usize] = 0;
            self.g_score_stamp[s as usize] = stamp;
            self.came_from[s as usize] = -1;

            let sx = s % width;
            let sy = s / width;
            let h = weight * BASE_COST * (abs_diff(sx, goal_x) + abs_diff(sy, goal_y));
            self.heap_push(s, h);
        }

        let mut iterations = self.max_iterations;

        while self.heap_size > 0 {
            iterations -= 1;
            if iterations == 0 {
                return None;
            }

            let current = self.heap_pop();
            let current_idx = current as usize;

            if self.closed_stamp[current_idx] == stamp {
                continue;
            }
            self.closed_stamp[current_idx] = stamp;

            if current == goal {
                return Some(self.build_path(goal));
            }

            let current_g = self.g_score[current_idx];
            let current_x = current % width;
            let current_y = current / width;

            // Process 4 neighbors (up, down, left, right)
            // Up
            if current >= width {
                let neighbor = current - width;
                self.try_neighbor(
                    neighbor,
                    goal,
                    current,
                    current_g,
                    current_x,
                    current_y - 1,
                    goal_x,
                    goal_y,
                    stamp,
                    land_mask,
                    weight,
                    dx_goal,
                    dy_goal,
                    cross_norm,
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
                    current_x,
                    current_y + 1,
                    goal_x,
                    goal_y,
                    stamp,
                    land_mask,
                    weight,
                    dx_goal,
                    dy_goal,
                    cross_norm,
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
                    current_x - 1,
                    current_y,
                    goal_x,
                    goal_y,
                    stamp,
                    land_mask,
                    weight,
                    dx_goal,
                    dy_goal,
                    cross_norm,
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
                    current_x + 1,
                    current_y,
                    goal_x,
                    goal_y,
                    stamp,
                    land_mask,
                    weight,
                    dx_goal,
                    dy_goal,
                    cross_norm,
                );
            }
        }

        None
    }

    #[inline(always)]
    fn try_neighbor(
        &mut self,
        neighbor: u32,
        goal: u32,
        current: u32,
        current_g: u32,
        neighbor_x: u32,
        neighbor_y: u32,
        goal_x: u32,
        goal_y: u32,
        stamp: u32,
        land_mask: u8,
        weight: u32,
        dx_goal: i32,
        dy_goal: i32,
        cross_norm: u32,
    ) {
        let neighbor_idx = neighbor as usize;
        let neighbor_terrain = self.terrain[neighbor_idx];

        // Skip if closed or is land (unless it's the goal)
        if self.closed_stamp[neighbor_idx] == stamp {
            return;
        }
        if neighbor != goal && (neighbor_terrain & land_mask) != 0 {
            return;
        }

        let magnitude = neighbor_terrain & MAGNITUDE_MASK;
        let cost = BASE_COST + get_magnitude_penalty(magnitude);
        let tentative_g = current_g + cost;

        if self.g_score_stamp[neighbor_idx] != stamp || tentative_g < self.g_score[neighbor_idx] {
            self.came_from[neighbor_idx] = current as i32;
            self.g_score[neighbor_idx] = tentative_g;
            self.g_score_stamp[neighbor_idx] = stamp;

            let h =
                weight * BASE_COST * (abs_diff(neighbor_x, goal_x) + abs_diff(neighbor_y, goal_y));
            let cross_tie_breaker = cross_product_tie_breaker(
                neighbor_x, neighbor_y, goal_x, goal_y, dx_goal, dy_goal, cross_norm,
            );
            let f = tentative_g + h + cross_tie_breaker;
            self.heap_push(neighbor, f);
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

    // Inline min-heap implementation for better performance
    #[inline(always)]
    fn heap_push(&mut self, node: u32, priority: u32) {
        let mut i = self.heap_size;
        self.heap_nodes[i] = node;
        self.heap_priorities[i] = priority;
        self.heap_size += 1;

        // Bubble up
        while i > 0 {
            let parent = (i - 1) >> 1;
            if self.heap_priorities[parent] <= self.heap_priorities[i] {
                break;
            }
            self.heap_nodes.swap(parent, i);
            self.heap_priorities.swap(parent, i);
            i = parent;
        }
    }

    #[inline(always)]
    fn heap_pop(&mut self) -> u32 {
        let result = self.heap_nodes[0];
        self.heap_size -= 1;

        if self.heap_size > 0 {
            self.heap_nodes[0] = self.heap_nodes[self.heap_size];
            self.heap_priorities[0] = self.heap_priorities[self.heap_size];

            // Bubble down
            let mut i = 0;
            loop {
                let left = (i << 1) + 1;
                let right = left + 1;
                let mut smallest = i;

                if left < self.heap_size
                    && self.heap_priorities[left] < self.heap_priorities[smallest]
                {
                    smallest = left;
                }
                if right < self.heap_size
                    && self.heap_priorities[right] < self.heap_priorities[smallest]
                {
                    smallest = right;
                }
                if smallest == i {
                    break;
                }

                self.heap_nodes.swap(smallest, i);
                self.heap_priorities.swap(smallest, i);
                i = smallest;
            }
        }
        result
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

/// Cross-product tie-breaker: measures deviation from start-goal line
#[inline(always)]
fn cross_product_tie_breaker(
    nx: u32,
    ny: u32,
    goal_x: u32,
    goal_y: u32,
    dx_goal: i32,
    dy_goal: i32,
    cross_norm: u32,
) -> u32 {
    let dx_n = nx as i32 - goal_x as i32;
    let dy_n = ny as i32 - goal_y as i32;
    let cross = (dx_goal * dy_n - dy_goal * dx_n).unsigned_abs();
    (cross * (COST_SCALE - 1)) / (cross_norm * cross_norm)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_simple_water_map(width: u32, height: u32) -> Vec<u8> {
        // Create a simple map where everything is water (magnitude 5)
        vec![5u8; (width * height) as usize]
    }

    #[test]
    fn test_simple_path() {
        let width = 10;
        let height = 10;
        let terrain = create_simple_water_map(width, height);
        let mut pathfinder = AStarWater::new(&terrain, width, height, None, None);

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
    fn test_no_path_through_land() {
        let width = 5;
        let height = 5;
        let mut terrain = create_simple_water_map(width, height);

        // Create a wall of land in the middle
        let land_value = 5 | (1 << LAND_BIT); // magnitude 5 + land bit
        for y in 0..height {
            terrain[(y * width + 2) as usize] = land_value;
        }

        let mut pathfinder = AStarWater::new(&terrain, width, height, None, None);

        // Try to find path from (0,0) to (4,0) - should fail due to land wall
        let start = 0;
        let goal = 4;
        let path = pathfinder.find_path(start, goal);

        assert!(path.is_none());
    }
}
