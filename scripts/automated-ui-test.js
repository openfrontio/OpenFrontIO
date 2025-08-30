#!/usr/bin/env node

/**
 * Automated UI Test Script for WinModal
 * Requires playwright for browser automation
 */

import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class AutomatedUITest {
  constructor() {
    this.browser = null;
    this.page = null;
    this.testResults = [];
  }

  async setup() {
    console.log('🚀 Setting up automated UI test...');
    
    this.browser = await chromium.launch({ headless: false });
    this.page = await this.browser.newPage();
    
    // Set viewport
    await this.page.setViewportSize({ width: 1280, height: 720 });
    
    // Load test page
    const testPagePath = join(__dirname, 'winmodal-ui-test.html');
    await this.page.goto(`file://${testPagePath}`);
    
    console.log('✅ Browser setup complete');
  }

  async runAutomatedTests() {
    console.log('🧪 Starting automated UI tests...');
    
    try {
      await this.testPageLoad();
      await this.testWinModalInteraction();
      await this.testButtonFunctionality();
      await this.testBlockchainStatusDisplay();
      await this.testResponsiveDesign();
      
      console.log('✅ All automated tests completed');
      this.printResults();
      
    } catch (error) {
      console.error('❌ Test failed:', error);
    }
  }

  async testPageLoad() {
    console.log('🧪 Testing page load...');
    
    await this.page.waitForSelector('h1');
    const title = await this.page.textContent('h1');
    
    if (title.includes('WinModal')) {
      this.addResult('Page Load', 'PASS', 'Page loaded with correct title');
    } else {
      this.addResult('Page Load', 'FAIL', 'Incorrect or missing title');
    }
  }

  async testWinModalInteraction() {
    console.log('🧪 Testing WinModal interaction...');
    
    // Click test button
    await this.page.click('text=Test WinModal Display');
    
    // Wait for modal to appear
    await this.page.waitForSelector('.mock-winmodal.visible', { timeout: 5000 });
    
    const modalVisible = await this.page.isVisible('.mock-winmodal.visible');
    if (modalVisible) {
      this.addResult('WinModal Display', 'PASS', 'Modal opens correctly');
      
      // Test close functionality
      await this.page.click('.modal-close');
      await this.page.waitForFunction(() => {
        const modal = document.querySelector('.mock-winmodal');
        return !modal.classList.contains('visible');
      });
      
      this.addResult('WinModal Close', 'PASS', 'Modal closes correctly');
    } else {
      this.addResult('WinModal Display', 'FAIL', 'Modal failed to open');
    }
  }

  async testButtonFunctionality() {
    console.log('🧪 Testing button functionality...');
    
    const buttons = [
      'Test Blockchain Status Display',
      'Test Prize Claim Button',
      'Test Real-time Updates',
      'Test Error Handling'
    ];
    
    for (const buttonText of buttons) {
      try {
        await this.page.click(`text=${buttonText}`);
        await this.page.waitForTimeout(1000); // Wait for action
        
        // Check if log entries were added
        const logEntries = await this.page.$$('.log-entry');
        if (logEntries.length > 0) {
          this.addResult(`Button: ${buttonText}`, 'PASS', 'Button triggers functionality');
        } else {
          this.addResult(`Button: ${buttonText}`, 'FAIL', 'No response detected');
        }
      } catch (error) {
        this.addResult(`Button: ${buttonText}`, 'FAIL', error.message);
      }
    }
  }

  async testBlockchainStatusDisplay() {
    console.log('🧪 Testing blockchain status display...');
    
    // Open modal first
    await this.page.click('text=Test WinModal Display');
    await this.page.waitForSelector('.mock-winmodal.visible');
    
    // Check if blockchain status is displayed
    const statusEl = await this.page.$('#modalStatus');
    if (statusEl) {
      const statusText = await statusEl.textContent();
      this.addResult('Blockchain Status Display', 'PASS', `Status shown: ${statusText}`);
    } else {
      this.addResult('Blockchain Status Display', 'FAIL', 'Status element not found');
    }
    
    // Close modal
    await this.page.click('.modal-close');
  }

  async testResponsiveDesign() {
    console.log('🧪 Testing responsive design...');
    
    // Test mobile viewport
    await this.page.setViewportSize({ width: 375, height: 667 });
    await this.page.waitForTimeout(500);
    
    const modal = await this.page.$('.mock-winmodal');
    const modalStyles = await modal.evaluate(el => getComputedStyle(el));
    
    if (parseInt(modalStyles.width) <= 375) {
      this.addResult('Responsive Design', 'PASS', 'Modal adapts to mobile viewport');
    } else {
      this.addResult('Responsive Design', 'FAIL', 'Modal does not adapt to mobile');
    }
    
    // Reset viewport
    await this.page.setViewportSize({ width: 1280, height: 720 });
  }

  addResult(testName, status, details) {
    this.testResults.push({ testName, status, details, timestamp: new Date() });
    console.log(`  ${status === 'PASS' ? '✅' : '❌'} ${testName}: ${details}`);
  }

  printResults() {
    console.log('\n📊 Test Results Summary:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    
    console.log(`Total Tests: ${this.testResults.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / this.testResults.length) * 100).toFixed(1)}%`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(`  - ${r.testName}: ${r.details}`));
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log('🧹 Cleanup complete');
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new AutomatedUITest();
  
  try {
    await tester.setup();
    await tester.runAutomatedTests();
  } catch (error) {
    console.error('Test suite failed:', error);
  } finally {
    await tester.cleanup();
  }
}

export default AutomatedUITest;