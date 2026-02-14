//! Priority Queue implementations for pathfinding
//!
//! Binary min-heap: O(log n) push/pop, works with any priority values

use wasm_bindgen::prelude::*;

/// Binary min-heap implementation
/// Mirrors the TypeScript MinHeap for drop-in replacement
#[wasm_bindgen]
pub struct MinHeap {
    heap: Vec<i32>,
    priorities: Vec<f32>,
    size: usize,
}

#[wasm_bindgen]
impl MinHeap {
    #[wasm_bindgen(constructor)]
    pub fn new(capacity: usize) -> Self {
        Self {
            heap: vec![0; capacity],
            priorities: vec![0.0; capacity],
            size: 0,
        }
    }

    pub fn push(&mut self, node: i32, priority: f32) {
        // Resize if needed
        if self.size >= self.heap.len() {
            let new_capacity = self.heap.len() * 2;
            self.heap.resize(new_capacity, 0);
            self.priorities.resize(new_capacity, 0.0);
        }

        let mut i = self.size;
        self.heap[i] = node;
        self.priorities[i] = priority;
        self.size += 1;

        // Bubble up
        while i > 0 {
            let parent = (i - 1) >> 1;
            if self.priorities[parent] <= self.priorities[i] {
                break;
            }
            // Swap
            self.heap.swap(parent, i);
            self.priorities.swap(parent, i);
            i = parent;
        }
    }

    pub fn pop(&mut self) -> i32 {
        let result = self.heap[0];
        self.size -= 1;

        if self.size > 0 {
            self.heap[0] = self.heap[self.size];
            self.priorities[0] = self.priorities[self.size];

            // Bubble down
            let mut i = 0;
            loop {
                let left = (i << 1) + 1;
                let right = left + 1;
                let mut smallest = i;

                if left < self.size && self.priorities[left] < self.priorities[smallest] {
                    smallest = left;
                }
                if right < self.size && self.priorities[right] < self.priorities[smallest] {
                    smallest = right;
                }
                if smallest == i {
                    break;
                }

                // Swap
                self.heap.swap(smallest, i);
                self.priorities.swap(smallest, i);
                i = smallest;
            }
        }
        result
    }

    #[wasm_bindgen(js_name = isEmpty)]
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }

    pub fn clear(&mut self) {
        self.size = 0;
    }

    pub fn len(&self) -> usize {
        self.size
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_min_heap_basic() {
        let mut heap = MinHeap::new(10);

        heap.push(1, 5.0);
        heap.push(2, 3.0);
        heap.push(3, 7.0);
        heap.push(4, 1.0);

        assert_eq!(heap.pop(), 4); // priority 1.0
        assert_eq!(heap.pop(), 2); // priority 3.0
        assert_eq!(heap.pop(), 1); // priority 5.0
        assert_eq!(heap.pop(), 3); // priority 7.0
        assert!(heap.is_empty());
    }

    #[test]
    fn test_min_heap_clear() {
        let mut heap = MinHeap::new(10);

        heap.push(1, 1.0);
        heap.push(2, 2.0);

        heap.clear();
        assert!(heap.is_empty());
    }
}
