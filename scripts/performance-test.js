#!/usr/bin/env node

/**
 * Performance Test for WinModal UI Components
 */

import { performance } from 'perf_hooks';

class PerformanceTest {
  constructor() {
    this.metrics = [];
  }

  async measureRenderTime() {
    console.log('📊 Measuring WinModal render performance...');
    
    const startTime = performance.now();
    
    // Simulate DOM creation and styling
    for (let i = 0; i < 100; i++) {
      const element = document.createElement('div');
      element.className = 'win-modal visible';
      element.innerHTML = `
        <h2>Performance Test ${i}</h2>
        <div class="blockchain-status">Status: Finished</div>
        <button>Claim Prize</button>
      `;
      document.body.appendChild(element);
      document.body.removeChild(element);
    }
    
    const endTime = performance.now();
    const renderTime = endTime - startTime;
    
    this.metrics.push({ test: 'Render Time', value: renderTime, unit: 'ms' });
    console.log(`  ⏱️  Render time: ${renderTime.toFixed(2)}ms`);
    
    return renderTime;
  }

  async measureMemoryUsage() {
    console.log('📊 Measuring memory usage...');
    
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memBefore = process.memoryUsage();
      
      // Create and destroy many elements
      const elements = [];
      for (let i = 0; i < 1000; i++) {
        elements.push({ id: i, data: 'test'.repeat(100) });
      }
      
      const memAfter = process.memoryUsage();
      const memDiff = memAfter.heapUsed - memBefore.heapUsed;
      
      this.metrics.push({ test: 'Memory Usage', value: memDiff / 1024 / 1024, unit: 'MB' });
      console.log(`  🧠 Memory usage: ${(memDiff / 1024 / 1024).toFixed(2)}MB`);
      
      return memDiff;
    }
    
    return 0;
  }

  printReport() {
    console.log('\n📊 Performance Test Report:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    this.metrics.forEach(metric => {
      console.log(`${metric.test}: ${metric.value.toFixed(2)} ${metric.unit}`);
    });
  }
}

// Export for use in other scripts
export default PerformanceTest;

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const perfTest = new PerformanceTest();
  
  (async () => {
    await perfTest.measureRenderTime();
    await perfTest.measureMemoryUsage();
    perfTest.printReport();
  })();
}