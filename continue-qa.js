const { chromium } = require('./node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = '/tmp/qa-screenshots';
const BASE_URL = 'http://localhost:5173';
const PASSWORD = 'demo123';

// Test configurations
const roles = [
  {
    name: 'Facility Manager',
    email: 'manager@sunrisemanor.com',
    routes: [
      { path: '/app', name: 'dashboard' },
      { path: '/app/med-admin-roster', name: 'med-roster' },
      { path: '/app/services', name: 'services', fallback: '/app/residents' }
    ],
    screenshotPrefix: '17-manager'
  },
  {
    name: 'Trainer',
    email: 'trainer@sunrisehealthcare.com',
    routes: [
      { path: '/trainer', name: 'dashboard' },
      { path: '/trainer/classes', name: 'classes' }
    ],
    screenshotPrefix: '20-trainer'
  },
  {
    name: 'Employee',
    email: 'employee@sunrisehealthcare.com',
    routes: [
      { path: '/me', name: 'dashboard' },
      { path: '/me/courses', name: 'courses' },
      { path: '/me/schedule', name: 'schedule' }
    ],
    screenshotPrefix: '23-employee'
  },
  {
    name: 'Auditor',
    email: 'auditor@sunrisehealthcare.com',
    routes: [
      { path: '/app', name: 'dashboard' }
    ],
    screenshotPrefix: '26-auditor'
  }
];

async function testRole(browser, role) {
  console.log(`\n=== Testing: ${role.name} (${role.email}) ===`);
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Navigate to login
    console.log('  → Navigating to login...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(1000);
    
    // Fill login form
    console.log('  → Filling login form...');
    await page.fill('input[type="email"], input[name="email"]', role.email);
    await page.fill('input[type="password"], input[name="password"]', PASSWORD);
    
    // Click sign in button
    console.log('  → Clicking sign in...');
    await page.click('button[type="submit"], button:has-text("Sign in")');
    
    // Wait for navigation
    await page.waitForTimeout(3000);
    
    // Check for MFA gate (should not exist for demo org)
    const hasMFA = await page.locator('text=multi-factor, text=MFA, text=2FA, text=verification code').count() > 0;
    if (hasMFA) {
      console.log('  ❌ MFA gate detected (should not exist for demo org)');
    } else {
      console.log('  ✅ No MFA gate (correct)');
    }
    
    // Test each route
    for (let i = 0; i < role.routes.length; i++) {
      const route = role.routes[i];
      console.log(`  → Testing route: ${route.path}`);
      
      try {
        await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(2000);
        
        // Check for errors or blank page
        const hasError = await page.locator('text=error, text=crashed, text=something went wrong').count() > 0;
        const hasContent = await page.locator('body').textContent();
        
        if (hasError) {
          console.log(`    ❌ Error detected on ${route.path}`);
        } else if (hasContent.trim().length < 100) {
          console.log(`    ⚠️  Page might be blank: ${route.path}`);
        } else {
          console.log(`    ✅ Page loaded successfully: ${route.path}`);
        }
        
        // Take screenshot
        const screenshotPath = path.join(SCREENSHOT_DIR, `${role.screenshotPrefix}-${route.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`    📸 Screenshot saved: ${screenshotPath}`);
        
      } catch (error) {
        console.log(`    ❌ Failed to load ${route.path}: ${error.message}`);
        
        // Try fallback if specified
        if (route.fallback) {
          console.log(`    → Trying fallback: ${route.fallback}`);
          try {
            await page.goto(`${BASE_URL}${route.fallback}`, { waitUntil: 'networkidle', timeout: 10000 });
            await page.waitForTimeout(2000);
            const screenshotPath = path.join(SCREENSHOT_DIR, `${role.screenshotPrefix}-${route.name}-fallback.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`    ✅ Fallback loaded, screenshot saved`);
          } catch (fallbackError) {
            console.log(`    ❌ Fallback also failed: ${fallbackError.message}`);
          }
        }
      }
    }
    
    console.log(`  ✅ ${role.name} testing complete`);
    
  } catch (error) {
    console.log(`  ❌ ${role.name} test failed: ${error.message}`);
  } finally {
    await context.close();
  }
}

async function testPublicNegatives(browser) {
  console.log('\n=== Testing: Public Negative Paths ===');
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const publicRoutes = [
    '/resident-portal',
    '/evidence-access'
  ];
  
  for (const route of publicRoutes) {
    console.log(`  → Testing unauthenticated access: ${route}`);
    try {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 10000 });
      await page.waitForTimeout(1000);
      
      const url = page.url();
      const hasLoginRedirect = url.includes('/login');
      const hasAccessDenied = await page.locator('text=access denied, text=unauthorized, text=not authorized, text=sign in').count() > 0;
      const hasBlankPage = (await page.locator('body').textContent()).trim().length < 50;
      
      if (hasLoginRedirect || hasAccessDenied) {
        console.log(`    ✅ Properly denied access (redirected or showed error)`);
      } else if (hasBlankPage) {
        console.log(`    ❌ FAIL: Blank page (should show error or redirect)`);
      } else {
        console.log(`    ⚠️  WARNING: Page loaded, verify it's not exposing data`);
      }
      
      const screenshotPath = path.join(SCREENSHOT_DIR, `30-public-${route.replace('/', '')}-denied.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`    📸 Screenshot saved`);
      
    } catch (error) {
      console.log(`    ⚠️  Navigation failed (may indicate proper blocking): ${error.message}`);
    }
  }
  
  await context.close();
}

async function testResidentDetail(browser) {
  console.log('\n=== Testing: Resident Detail & Needs Attention Panel ===');
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Login as admin
    console.log('  → Logging in as Org Admin...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.fill('input[type="email"]', 'admin@sunrisehealthcare.com');
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    
    // Navigate to residents page
    console.log('  → Navigating to residents list...');
    await page.goto(`${BASE_URL}/app/residents`, { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(2000);
    
    // Try to click on first resident name
    console.log('  → Attempting to click first resident...');
    
    // Try multiple selectors
    const selectors = [
      'table tr td:first-child a',  // Link in first column
      'table tr td a',  // Any link in row
      'text="Brooks, Evelyn"',  // Specific resident name
      'table tr:has-text("Brooks") td:first-child',  // First cell of Brooks row
      'button:has-text("View")',  // View button
    ];
    
    let clicked = false;
    for (const selector of selectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.count() > 0) {
          console.log(`    → Found element with selector: ${selector}`);
          await element.click();
          clicked = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!clicked) {
      console.log('    ⚠️  Could not click resident link, trying direct URL...');
      // Try to get resident ID from page or use common pattern
      await page.goto(`${BASE_URL}/app/residents/1`, { waitUntil: 'networkidle', timeout: 10000 });
    }
    
    await page.waitForTimeout(2000);
    
    // Check if we're on detail page
    const url = page.url();
    if (url.includes('/residents/') && !url.endsWith('/residents')) {
      console.log('    ✅ Navigated to resident detail page');
      
      // Look for Needs Attention panel
      const needsAttentionPanel = await page.locator('text="Needs Attention", text="needs attention", text="Attention Required"').count();
      const hasCrash = await page.locator('text=error, text=crashed').count() > 0;
      
      if (hasCrash) {
        console.log('    ❌ FAIL: Page crashed');
      } else if (needsAttentionPanel > 0) {
        console.log('    ✅ PASS: Needs Attention panel found and rendered');
      } else {
        console.log('    ⚠️  WARNING: Needs Attention panel not found (may not exist or different name)');
      }
      
      const screenshotPath = path.join(SCREENSHOT_DIR, '31-resident-detail-needs-attention.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`    📸 Screenshot saved`);
      
    } else {
      console.log('    ❌ Could not navigate to resident detail page');
      const screenshotPath = path.join(SCREENSHOT_DIR, '31-resident-list-clickfail.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    
  } catch (error) {
    console.log(`  ❌ Resident detail test failed: ${error.message}`);
  } finally {
    await context.close();
  }
}

async function findSignOutButton(browser) {
  console.log('\n=== Finding Sign Out Button ===');
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Login as admin
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.fill('input[type="email"]', 'admin@sunrisehealthcare.com');
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    
    // Look for sign out in common locations
    const possibleLocations = [
      { selector: 'text="Sign out"', desc: 'Direct "Sign out" text' },
      { selector: 'text="Log out"', desc: 'Direct "Log out" text' },
      { selector: '[aria-label*="user menu"], [aria-label*="account"]', desc: 'User menu aria-label' },
      { selector: 'button:has-text("Robert Chen")', desc: 'User name button' },
      { selector: '[class*="avatar"], [class*="profile"]', desc: 'Avatar/profile class' },
      { selector: 'nav button[type="button"]', desc: 'Nav buttons' },
    ];
    
    for (const loc of possibleLocations) {
      try {
        const count = await page.locator(loc.selector).count();
        if (count > 0) {
          console.log(`  ✓ Found: ${loc.desc} (selector: ${loc.selector})`);
          
          // Try clicking it
          const element = page.locator(loc.selector).first();
          await element.click();
          await page.waitForTimeout(1000);
          
          // Check if a menu appeared
          const signOutNow = await page.locator('text="Sign out", text="Log out"').count();
          if (signOutNow > 0) {
            console.log(`    ✅ FOUND SIGN OUT BUTTON AFTER CLICKING: ${loc.desc}`);
            const screenshotPath = path.join(SCREENSHOT_DIR, '32-signout-menu-found.png');
            await page.screenshot({ path: screenshotPath, fullPage: true });
            break;
          }
        }
      } catch (e) {
        // Continue searching
      }
    }
    
  } catch (error) {
    console.log(`  ⚠️  Sign out search failed: ${error.message}`);
  } finally {
    await context.close();
  }
}

async function main() {
  console.log('Starting CareMetric CareBase QA Continuation...');
  console.log(`Screenshots will be saved to: ${SCREENSHOT_DIR}\n`);
  
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    // First, find sign out button
    await findSignOutButton(browser);
    
    // Test resident detail
    await testResidentDetail(browser);
    
    // Test each role
    for (const role of roles) {
      await testRole(browser, role);
    }
    
    // Test public negatives
    await testPublicNegatives(browser);
    
    console.log('\n=== QA Testing Complete ===');
    console.log(`All screenshots saved to: ${SCREENSHOT_DIR}`);
    console.log('Review the results and update QA_REPORT.md accordingly.');
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
