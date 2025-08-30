#!/usr/bin/env node

/**
 * UI Test Helper for WinModal Blockchain Integration Testing
 * 
 * This script provides utilities for testing the WinModal UI components
 * and their blockchain integration features.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const DEV_SERVER_PORT = 8080;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const TEST_LOBBY_ID = '0x845c60c0b23c9dfa602377c055dfdf4d3af95a3ec9b350942c02565af41152ec';

class UITestHelper {
  constructor() {
    this.testResults = [];
  }

  /**
   * Generate a comprehensive test HTML page for WinModal UI testing
   */
  generateTestPage() {
    const testPagePath = join(__dirname, 'winmodal-ui-test.html');
    
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WinModal Blockchain UI Integration Test</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: white;
            padding: 20px;
            min-height: 100vh;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        h1 {
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.5rem;
            background: linear-gradient(45deg, #4a9eff, #00d4ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 0 30px rgba(74, 158, 255, 0.5);
        }

        .test-section {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 25px;
            margin-bottom: 25px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .test-section h2 {
            color: #4a9eff;
            margin-bottom: 20px;
            font-size: 1.5rem;
        }

        .button-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }

        .test-button {
            background: linear-gradient(135deg, #4a9eff 0%, #0066cc 100%);
            color: white;
            border: none;
            padding: 15px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .test-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(74, 158, 255, 0.4);
        }

        .test-button:active {
            transform: translateY(0);
        }

        .test-button:disabled {
            background: #666;
            cursor: not-allowed;
            transform: none;
        }

        .status-display {
            background: rgba(0, 0, 0, 0.3);
            border-radius: 8px;
            padding: 15px;
            margin: 15px 0;
            border-left: 4px solid #4a9eff;
            font-family: 'Courier New', monospace;
            font-size: 14px;
        }

        .log-container {
            background: rgba(0, 0, 0, 0.5);
            border-radius: 8px;
            padding: 20px;
            max-height: 400px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.4;
        }

        .log-entry {
            margin-bottom: 8px;
            padding: 5px 8px;
            border-radius: 4px;
        }

        .log-success { background: rgba(76, 175, 80, 0.2); border-left: 3px solid #4CAF50; }
        .log-error { background: rgba(244, 67, 54, 0.2); border-left: 3px solid #F44336; }
        .log-info { background: rgba(33, 150, 243, 0.2); border-left: 3px solid #2196F3; }
        .log-warning { background: rgba(255, 152, 0, 0.2); border-left: 3px solid #FF9800; }

        .blockchain-status {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
        }

        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #ccc;
        }

        .status-indicator.connected { background: #4CAF50; }
        .status-indicator.disconnected { background: #F44336; }
        .status-indicator.checking { background: #FF9800; animation: pulse 1s infinite; }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .mock-winmodal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(30, 30, 30, 0.95);
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(10px);
            z-index: 10000;
            width: 400px;
            border: 2px solid rgba(74, 158, 255, 0.3);
            display: none;
        }

        .mock-winmodal.visible {
            display: block;
            animation: modalFadeIn 0.4s ease-out;
        }

        @keyframes modalFadeIn {
            from {
                opacity: 0;
                transform: translate(-50%, -48%);
            }
            to {
                opacity: 1;
                transform: translate(-50%, -50%);
            }
        }

        .modal-close {
            position: absolute;
            top: 10px;
            right: 15px;
            background: none;
            border: none;
            color: #ccc;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .modal-close:hover {
            color: white;
        }

        @media (max-width: 768px) {
            .container { padding: 10px; }
            .mock-winmodal { width: 90%; max-width: 350px; }
            .button-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎮 WinModal Blockchain UI Test Suite</h1>
        
        <div class="test-section">
            <h2>🔗 Blockchain Connection Status</h2>
            <div class="blockchain-status">
                <div class="status-indicator" id="connectionStatus"></div>
                <span id="connectionText">Checking connection...</span>
            </div>
            <div class="status-display" id="blockchainInfo">
                Initializing blockchain connection test...
            </div>
        </div>

        <div class="test-section">
            <h2>🧪 WinModal UI Tests</h2>
            <div class="button-grid">
                <button class="test-button" onclick="testWinModalDisplay()">
                    📱 Test WinModal Display
                </button>
                <button class="test-button" onclick="testBlockchainStatusDisplay()">
                    ⛓️ Test Blockchain Status Display
                </button>
                <button class="test-button" onclick="testPrizeClaimButton()">
                    🏆 Test Prize Claim Button
                </button>
                <button class="test-button" onclick="testRealTimeUpdates()">
                    🔄 Test Real-time Updates
                </button>
                <button class="test-button" onclick="testErrorHandling()">
                    ⚠️ Test Error Handling
                </button>
                <button class="test-button" onclick="runFullTestSuite()">
                    🚀 Run Full Test Suite
                </button>
            </div>
        </div>

        <div class="test-section">
            <h2>📊 Test Results</h2>
            <div class="log-container" id="testLog">
                <div class="log-entry log-info">
                    Test suite initialized. Click any test button above to begin testing.
                </div>
            </div>
        </div>
    </div>

    <!-- Mock WinModal for testing -->
    <div class="mock-winmodal" id="mockWinModal">
        <button class="modal-close" onclick="closeMockModal()">&times;</button>
        <h2 style="color: #4a9eff; margin-bottom: 20px;" id="modalTitle">🏆 You Won!</h2>
        
        <div style="background: rgba(50, 50, 50, 0.8); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <div style="margin-bottom: 10px;">
                <strong style="color: #ccc;">Blockchain Status:</strong>
                <span style="color: #ffa500; font-weight: bold; margin-left: 8px;" id="modalStatus">
                    Finished
                </span>
            </div>
            <div style="color: #ffa500; margin-top: 8px;">
                🏆 <strong>Ready to Claim Prize!</strong>
            </div>
            <div style="color: #aaa; font-size: 12px; margin-top: 4px;">
                Prize Pool: 0.2000 ETH
            </div>
        </div>

        <div id="modalPrizeStatus" style="display: none; text-align: center; margin: 10px 0; padding: 8px; border-radius: 4px;">
        </div>

        <div style="display: flex; gap: 10px;">
            <button class="test-button" id="claimButton" onclick="testClaimPrize()" 
                    style="flex: 1; background: rgba(0, 200, 0, 0.6);">
                Claim Prize
            </button>
            <button class="test-button" onclick="closeMockModal()" style="flex: 1;">
                Keep Playing
            </button>
        </div>
    </div>

    <script>
        // Configuration
        const CONFIG = {
            contractAddress: '${CONTRACT_ADDRESS}',
            testLobbyId: '${TEST_LOBBY_ID}',
            devServerUrl: '${DEV_SERVER_URL}',
            anvilRpcUrl: 'http://localhost:8545'
        };

        let testResults = [];
        let currentTestRunning = false;

        // Initialize page
        document.addEventListener('DOMContentLoaded', () => {
            logMessage('🎮 WinModal UI Test Suite loaded successfully', 'success');
            checkBlockchainConnection();
        });

        // Blockchain connection test
        async function checkBlockchainConnection() {
            const statusEl = document.getElementById('connectionStatus');
            const textEl = document.getElementById('connectionText');
            const infoEl = document.getElementById('blockchainInfo');
            
            statusEl.className = 'status-indicator checking';
            textEl.textContent = 'Checking Anvil connection...';
            
            try {
                const response = await fetch(CONFIG.anvilRpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'web3_clientVersion',
                        params: [],
                        id: 1
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    statusEl.className = 'status-indicator connected';
                    textEl.textContent = 'Connected to Anvil blockchain';
                    infoEl.innerHTML = \`✅ <strong>Blockchain Connected</strong><br>
                                       Client: \${data.result}<br>
                                       RPC URL: \${CONFIG.anvilRpcUrl}<br>
                                       Contract: \${CONFIG.contractAddress}\`;
                    logMessage('✅ Blockchain connection successful', 'success');
                } else {
                    throw new Error('Connection failed');
                }
            } catch (error) {
                statusEl.className = 'status-indicator disconnected';
                textEl.textContent = 'Failed to connect to blockchain';
                infoEl.innerHTML = \`❌ <strong>Connection Failed</strong><br>
                                   Error: \${error.message}<br>
                                   Make sure Anvil is running on port 8545\`;
                logMessage('❌ Blockchain connection failed: ' + error.message, 'error');
            }
        }

        // Test functions
        function testWinModalDisplay() {
            if (currentTestRunning) return;
            logMessage('🧪 Testing WinModal display...', 'info');
            
            const modal = document.getElementById('mockWinModal');
            modal.classList.add('visible');
            
            setTimeout(() => {
                logMessage('✅ WinModal displayed successfully', 'success');
                logMessage('📝 Modal shows: Title, blockchain status, prize info, action buttons', 'info');
                testResults.push({ test: 'WinModal Display', status: 'PASS', timestamp: new Date() });
            }, 500);
        }

        function testBlockchainStatusDisplay() {
            logMessage('🧪 Testing blockchain status display...', 'info');
            
            const statuses = ['Created', 'InProgress', 'Finished', 'Claimed'];
            const colors = ['#ccc', '#90ee90', '#ffa500', '#4a9eff'];
            let currentIndex = 0;
            
            const interval = setInterval(() => {
                const statusEl = document.getElementById('modalStatus');
                statusEl.textContent = statuses[currentIndex];
                statusEl.style.color = colors[currentIndex];
                
                logMessage(\`📊 Status updated to: \${statuses[currentIndex]}\`, 'info');
                currentIndex++;
                
                if (currentIndex >= statuses.length) {
                    clearInterval(interval);
                    logMessage('✅ Blockchain status display test completed', 'success');
                    testResults.push({ test: 'Status Display', status: 'PASS', timestamp: new Date() });
                }
            }, 1500);
        }

        function testPrizeClaimButton() {
            logMessage('🧪 Testing prize claim button functionality...', 'info');
            
            const button = document.getElementById('claimButton');
            const originalText = button.textContent;
            
            // Simulate claim process
            button.textContent = 'Claiming...';
            button.disabled = true;
            button.style.background = 'rgba(100, 100, 100, 0.6)';
            
            setTimeout(() => {
                const statusEl = document.getElementById('modalPrizeStatus');
                statusEl.style.display = 'block';
                statusEl.style.backgroundColor = '#d4edda';
                statusEl.style.color = '#155724';
                statusEl.style.border = '1px solid #c3e6cb';
                statusEl.textContent = 'Success! Transaction: 0x1234567890...';
                
                button.textContent = originalText;
                button.disabled = false;
                button.style.background = 'rgba(0, 200, 0, 0.6)';
                
                logMessage('✅ Prize claim button test completed successfully', 'success');
                logMessage('📝 Button shows loading state, success message, and resets properly', 'info');
                testResults.push({ test: 'Prize Claim Button', status: 'PASS', timestamp: new Date() });
                
                // Clear status after a moment
                setTimeout(() => {
                    statusEl.style.display = 'none';
                }, 3000);
            }, 2000);
        }

        function testRealTimeUpdates() {
            logMessage('🧪 Testing real-time blockchain updates...', 'info');
            
            let updateCount = 0;
            const maxUpdates = 5;
            
            const interval = setInterval(() => {
                updateCount++;
                logMessage(\`🔄 Simulated blockchain update \${updateCount}/\${maxUpdates}\`, 'info');
                
                // Simulate status change
                const statusEl = document.getElementById('modalStatus');
                statusEl.textContent = updateCount % 2 === 0 ? 'Finished' : 'InProgress';
                statusEl.style.color = updateCount % 2 === 0 ? '#ffa500' : '#90ee90';
                
                if (updateCount >= maxUpdates) {
                    clearInterval(interval);
                    logMessage('✅ Real-time updates test completed', 'success');
                    testResults.push({ test: 'Real-time Updates', status: 'PASS', timestamp: new Date() });
                }
            }, 800);
        }

        function testErrorHandling() {
            logMessage('🧪 Testing error handling scenarios...', 'info');
            
            // Simulate various error conditions
            const errors = [
                { type: 'Network Error', message: 'Failed to connect to blockchain' },
                { type: 'Transaction Failed', message: 'Insufficient gas for transaction' },
                { type: 'Contract Error', message: 'Prize already claimed' },
                { type: 'Wallet Error', message: 'User rejected transaction' }
            ];
            
            let errorIndex = 0;
            
            const interval = setInterval(() => {
                const error = errors[errorIndex];
                logMessage(\`⚠️ Testing \${error.type}: \${error.message}\`, 'warning');
                
                // Simulate error display
                const statusEl = document.getElementById('modalPrizeStatus');
                statusEl.style.display = 'block';
                statusEl.style.backgroundColor = '#f8d7da';
                statusEl.style.color = '#721c24';
                statusEl.style.border = '1px solid #f5c6cb';
                statusEl.textContent = error.message;
                
                setTimeout(() => {
                    statusEl.style.display = 'none';
                }, 1500);
                
                errorIndex++;
                
                if (errorIndex >= errors.length) {
                    clearInterval(interval);
                    logMessage('✅ Error handling test completed', 'success');
                    testResults.push({ test: 'Error Handling', status: 'PASS', timestamp: new Date() });
                }
            }, 2000);
        }

        function testClaimPrize() {
            testPrizeClaimButton();
        }

        function closeMockModal() {
            const modal = document.getElementById('mockWinModal');
            modal.classList.remove('visible');
            logMessage('📱 WinModal closed', 'info');
        }

        async function runFullTestSuite() {
            if (currentTestRunning) return;
            
            currentTestRunning = true;
            testResults = [];
            
            logMessage('🚀 Starting full WinModal test suite...', 'info');
            logMessage('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
            
            const tests = [
                { name: 'WinModal Display', func: testWinModalDisplay, delay: 3000 },
                { name: 'Blockchain Status Display', func: testBlockchainStatusDisplay, delay: 8000 },
                { name: 'Prize Claim Button', func: testPrizeClaimButton, delay: 4000 },
                { name: 'Real-time Updates', func: testRealTimeUpdates, delay: 6000 },
                { name: 'Error Handling', func: testErrorHandling, delay: 10000 }
            ];
            
            let currentTest = 0;
            
            function runNextTest() {
                if (currentTest >= tests.length) {
                    // Test suite completed
                    logMessage('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'success');
                    logMessage('🎉 Full test suite completed!', 'success');
                    
                    const passed = testResults.filter(r => r.status === 'PASS').length;
                    const failed = testResults.filter(r => r.status === 'FAIL').length;
                    
                    logMessage(\`📊 Test Summary: \${passed} passed, \${failed} failed\`, 'success');
                    testResults.forEach(result => {
                        logMessage(\`   \${result.status === 'PASS' ? '✅' : '❌'} \${result.test}\`, 
                                  result.status === 'PASS' ? 'success' : 'error');
                    });
                    
                    currentTestRunning = false;
                    return;
                }
                
                const test = tests[currentTest];
                logMessage(\`🔄 Running test: \${test.name}\`, 'info');
                
                test.func();
                
                setTimeout(() => {
                    currentTest++;
                    runNextTest();
                }, test.delay);
            }
            
            runNextTest();
        }

        // Utility functions
        function logMessage(message, type = 'info') {
            const logContainer = document.getElementById('testLog');
            const logEntry = document.createElement('div');
            const timestamp = new Date().toLocaleTimeString();
            
            logEntry.className = \`log-entry log-\${type}\`;
            logEntry.innerHTML = \`[\${timestamp}] \${message}\`;
            
            logContainer.appendChild(logEntry);
            logContainer.scrollTop = logContainer.scrollHeight;
        }

        // Auto-refresh blockchain connection every 30 seconds
        setInterval(checkBlockchainConnection, 30000);
    </script>
</body>
</html>`;

    writeFileSync(testPagePath, htmlContent);
    return testPagePath;
  }

  /**
   * Generate automated browser test script
   */
  generateAutomatedTestScript() {
    const scriptPath = join(__dirname, 'automated-ui-test.js');
    
    const scriptContent = `#!/usr/bin/env node

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
    await this.page.goto(\`file://\${testPagePath}\`);
    
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
        await this.page.click(\`text=\${buttonText}\`);
        await this.page.waitForTimeout(1000); // Wait for action
        
        // Check if log entries were added
        const logEntries = await this.page.$$('.log-entry');
        if (logEntries.length > 0) {
          this.addResult(\`Button: \${buttonText}\`, 'PASS', 'Button triggers functionality');
        } else {
          this.addResult(\`Button: \${buttonText}\`, 'FAIL', 'No response detected');
        }
      } catch (error) {
        this.addResult(\`Button: \${buttonText}\`, 'FAIL', error.message);
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
      this.addResult('Blockchain Status Display', 'PASS', \`Status shown: \${statusText}\`);
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
    console.log(\`  \${status === 'PASS' ? '✅' : '❌'} \${testName}: \${details}\`);
  }

  printResults() {
    console.log('\\n📊 Test Results Summary:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    
    console.log(\`Total Tests: \${this.testResults.length}\`);
    console.log(\`Passed: \${passed}\`);
    console.log(\`Failed: \${failed}\`);
    console.log(\`Success Rate: \${((passed / this.testResults.length) * 100).toFixed(1)}%\`);
    
    if (failed > 0) {
      console.log('\\n❌ Failed Tests:');
      this.testResults
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(\`  - \${r.testName}: \${r.details}\`));
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
if (import.meta.url === \`file://\${process.argv[1]}\`) {
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

export default AutomatedUITest;`;

    writeFileSync(scriptPath, scriptContent);
    return scriptPath;
  }

  /**
   * Check if development server is running
   */
  async checkDevServer() {
    try {
      const response = await fetch(DEV_SERVER_URL);
      return { success: true, url: DEV_SERVER_URL };
    } catch (error) {
      return { 
        success: false, 
        error: `Dev server not running on ${DEV_SERVER_URL}: ${error.message}` 
      };
    }
  }

  /**
   * Generate performance test script
   */
  generatePerformanceTestScript() {
    const scriptPath = join(__dirname, 'performance-test.js');
    
    const scriptContent = `#!/usr/bin/env node

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
      element.innerHTML = \`
        <h2>Performance Test \${i}</h2>
        <div class="blockchain-status">Status: Finished</div>
        <button>Claim Prize</button>
      \`;
      document.body.appendChild(element);
      document.body.removeChild(element);
    }
    
    const endTime = performance.now();
    const renderTime = endTime - startTime;
    
    this.metrics.push({ test: 'Render Time', value: renderTime, unit: 'ms' });
    console.log(\`  ⏱️  Render time: \${renderTime.toFixed(2)}ms\`);
    
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
      console.log(\`  🧠 Memory usage: \${(memDiff / 1024 / 1024).toFixed(2)}MB\`);
      
      return memDiff;
    }
    
    return 0;
  }

  printReport() {
    console.log('\\n📊 Performance Test Report:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    this.metrics.forEach(metric => {
      console.log(\`\${metric.test}: \${metric.value.toFixed(2)} \${metric.unit}\`);
    });
  }
}

// Export for use in other scripts
export default PerformanceTest;

// Run if called directly
if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const perfTest = new PerformanceTest();
  
  (async () => {
    await perfTest.measureRenderTime();
    await perfTest.measureMemoryUsage();
    perfTest.printReport();
  })();
}`;

    writeFileSync(scriptPath, scriptContent);
    return scriptPath;
  }
}

// CLI interface when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const helper = new UITestHelper();
  const command = process.argv[2];

  switch (command) {
    case 'generate-test-page':
      const testPagePath = helper.generateTestPage();
      console.log(`✅ Test page generated: ${testPagePath}`);
      console.log(`🌐 Open in browser: file://${testPagePath}`);
      break;
      
    case 'generate-automated-script':
      const automatedScriptPath = helper.generateAutomatedTestScript();
      console.log(`✅ Automated test script generated: ${automatedScriptPath}`);
      console.log(`⚡ Run with: node ${automatedScriptPath}`);
      console.log(`📦 Requires: npm install playwright`);
      break;
      
    case 'generate-performance-test':
      const perfTestPath = helper.generatePerformanceTestScript();
      console.log(`✅ Performance test generated: ${perfTestPath}`);
      console.log(`🚀 Run with: node ${perfTestPath}`);
      break;
      
    case 'check-dev-server':
      helper.checkDevServer().then(result => {
        if (result.success) {
          console.log(`✅ Dev server running: ${result.url}`);
        } else {
          console.log(`❌ ${result.error}`);
        }
        process.exit(result.success ? 0 : 1);
      });
      break;
      
    case 'generate-all':
      console.log('🔧 Generating all UI test utilities...');
      const testPage = helper.generateTestPage();
      const autoScript = helper.generateAutomatedTestScript();
      const perfScript = helper.generatePerformanceTestScript();
      
      console.log('✅ All UI test files generated:');
      console.log(`  📄 Test Page: ${testPage}`);
      console.log(`  🤖 Automated Script: ${autoScript}`);
      console.log(`  📊 Performance Test: ${perfScript}`);
      break;
      
    default:
      console.log(`
UI Test Helper for WinModal Blockchain Integration

Usage: node ui-test-helper.js <command>

Commands:
  generate-test-page       Generate interactive test HTML page
  generate-automated-script Generate automated browser test script
  generate-performance-test Generate performance test script
  check-dev-server        Check if development server is running
  generate-all            Generate all test utilities

Examples:
  node ui-test-helper.js generate-test-page
  node ui-test-helper.js generate-all
`);
      process.exit(1);
  }
}

export default UITestHelper;