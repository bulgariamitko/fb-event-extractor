// Background service worker for FB Event Extractor

// Store for pending extraction results (tabId -> resolve function)
const pendingExtractions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle extraction result from content script
  if (message.action === 'extractionResult' && sender.tab) {
    const tabId = sender.tab.id;
    const resolve = pendingExtractions.get(tabId);
    if (resolve) {
      pendingExtractions.delete(tabId);
      resolve(message.data);
    }
    return;
  }

  // Handle batch extraction request from popup
  if (message.action === 'extractEvents') {
    handleExtraction(message.urls).then(sendResponse);
    return true;
  }

  // Handle single event extraction request from scanner
  if (message.action === 'extractSingleEvent') {
    extractSingleEvent(message.url).then(sendResponse);
    return true;
  }

  // Handle incognito event extraction
  if (message.action === 'extractSingleEventIncognito') {
    extractSingleEventIncognito(message.url).then(sendResponse);
    return true;
  }

  // Handle debug incognito extraction (verbose logging)
  if (message.action === 'debugIncognitoExtract') {
    debugIncognitoExtract(message.url).then(sendResponse);
    return true;
  }
});

// --- Batch extraction (from popup) ---
async function handleExtraction(urls) {
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    chrome.runtime.sendMessage({
      action: 'progress',
      current: i + 1,
      total: urls.length,
      url: url
    }).catch(() => {});

    const result = await extractSingleEvent(url);
    results.push(result);

    if (i < urls.length - 1) {
      // Random delay 5-8s between events to avoid rate limiting
      await sleep(5000 + Math.floor(Math.random() * 3000));
    }
  }

  return results;
}

// --- Single event extraction (shared by popup and scanner) ---
async function extractSingleEvent(url) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: url, active: false });

    await waitForTabLoad(tab.id, 15000);

    // Give Facebook's JS time to render the event page
    await sleep(3000);

    // Check if Facebook rate-limited us before injecting content script
    const [titleCheck] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.title + ' ||| ' + document.body.innerText.substring(0, 500)
    });
    const pageText = (titleCheck && titleCheck.result) || '';
    if (/temporarily blocked|you.?re temporarily/i.test(pageText)) {
      await chrome.tabs.remove(tab.id);
      return { success: false, url: url, error: 'RATE_LIMITED' };
    }

    // Create a promise that will be resolved when content script sends back results
    const resultPromise = new Promise((resolve) => {
      pendingExtractions.set(tab.id, resolve);

      // Timeout: if content script doesn't respond in 20s, resolve with error
      setTimeout(() => {
        if (pendingExtractions.has(tab.id)) {
          pendingExtractions.delete(tab.id);
          resolve({ success: false, url: url, error: 'Content script timeout' });
        }
      }, 20000);
    });

    // Inject the content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    // Wait for the content script to send back its result
    const result = await resultPromise;

    await chrome.tabs.remove(tab.id);

    return result || { success: false, url: url, error: 'No data returned' };

  } catch (err) {
    // Try to clean up the tab
    if (tab) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
    return { success: false, url: url, error: err.message };
  }
}

// --- Single event extraction in INCOGNITO window ---
async function extractSingleEventIncognito(url) {
  let win;
  try {
    // Create an incognito window with the event URL
    win = await chrome.windows.create({
      url: url,
      incognito: true,
      state: 'minimized'
    });

    const tab = win.tabs[0];

    await waitForTabLoad(tab.id, 15000);

    // Give Facebook's JS time to render
    await sleep(3000);

    // Check for rate limiting or login wall
    const [titleCheck] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.title + ' ||| ' + document.body.innerText.substring(0, 500)
    });
    const pageText = (titleCheck && titleCheck.result) || '';
    if (/temporarily blocked|you.?re temporarily/i.test(pageText)) {
      await chrome.windows.remove(win.id);
      return { success: false, url: url, error: 'RATE_LIMITED' };
    }

    // Create a promise for the content script result
    const resultPromise = new Promise((resolve) => {
      pendingExtractions.set(tab.id, resolve);
      setTimeout(() => {
        if (pendingExtractions.has(tab.id)) {
          pendingExtractions.delete(tab.id);
          resolve({ success: false, url: url, error: 'Content script timeout' });
        }
      }, 20000);
    });

    // Inject the content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    const result = await resultPromise;

    // Close the incognito window
    await chrome.windows.remove(win.id);

    return result || { success: false, url: url, error: 'No data returned' };

  } catch (err) {
    if (win) {
      try { await chrome.windows.remove(win.id); } catch {}
    }
    return { success: false, url: url, error: err.message };
  }
}

// --- DEBUG: Verbose incognito extraction for a single event ---
async function debugIncognitoExtract(url) {
  const logs = [];
  function dlog(msg) { logs.push(`[BG] ${msg}`); }

  let win;
  try {
    dlog(`Starting debug incognito for: ${url}`);

    // Step 1: Create incognito window
    dlog('Creating incognito window...');
    try {
      win = await chrome.windows.create({
        url: url,
        incognito: true,
        state: 'normal' // Normal so user can SEE it
      });
      dlog(`Incognito window created: windowId=${win.id}, tabId=${win.tabs[0].id}`);
    } catch (err) {
      dlog(`FAILED to create incognito window: ${err.message}`);
      dlog('Make sure "Allow in Incognito" is enabled in chrome://extensions');
      return { success: false, url, error: err.message, logs };
    }

    const tab = win.tabs[0];

    // Step 2: Wait for page load
    dlog('Waiting for page load (max 15s)...');
    await waitForTabLoad(tab.id, 15000);
    dlog('Page load complete (or timed out)');

    // Step 3: Wait for Facebook JS rendering
    dlog('Waiting 4s for Facebook JS to render...');
    await sleep(4000);

    // Step 4: Check what page loaded
    dlog('Checking page title and content...');
    let pageText = '';
    try {
      const [titleCheck] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          title: document.title,
          url: window.location.href,
          bodyStart: document.body ? document.body.innerText.substring(0, 800) : '(no body)',
          hasMain: !!document.querySelector('[role="main"]'),
          h1Count: document.querySelectorAll('h1').length,
          h1Texts: [...document.querySelectorAll('h1')].map(h => h.innerText.trim()).join(' | '),
          imgCount: document.querySelectorAll('img').length,
          spanCount: document.querySelectorAll('span').length
        })
      });
      const info = titleCheck.result;
      dlog(`Page title: "${info.title}"`);
      dlog(`Final URL: ${info.url}`);
      dlog(`Has [role=main]: ${info.hasMain}`);
      dlog(`H1 tags: ${info.h1Count} -> "${info.h1Texts}"`);
      dlog(`Images: ${info.imgCount}, Spans: ${info.spanCount}`);
      dlog(`Body text (first 300): ${info.bodyStart.substring(0, 300)}`);
      pageText = info.title + ' ' + info.bodyStart;
    } catch (err) {
      dlog(`FAILED to read page: ${err.message}`);
      await chrome.windows.remove(win.id);
      return { success: false, url, error: 'Cannot read page: ' + err.message, logs };
    }

    // Step 5: Check for rate limiting / login wall
    if (/temporarily blocked|you.?re temporarily/i.test(pageText)) {
      dlog('RATE LIMITED detected in page text!');
      await chrome.windows.remove(win.id);
      return { success: false, url, error: 'RATE_LIMITED', logs };
    }

    if (/log in|sign up|create an account/i.test(pageText.substring(0, 200))) {
      dlog('LOGIN WALL detected - Facebook requires login in incognito!');
      dlog('This means incognito approach may not work for this event');
    }

    // Step 6: Inject content script
    dlog('Injecting content.js...');
    const resultPromise = new Promise((resolve) => {
      pendingExtractions.set(tab.id, resolve);
      setTimeout(() => {
        if (pendingExtractions.has(tab.id)) {
          pendingExtractions.delete(tab.id);
          dlog('Content script TIMED OUT after 20s');
          resolve({ success: false, url, error: 'Content script timeout' });
        }
      }, 20000);
    });

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      dlog('content.js injected successfully');
    } catch (err) {
      dlog(`FAILED to inject content.js: ${err.message}`);
      await chrome.windows.remove(win.id);
      return { success: false, url, error: 'Inject failed: ' + err.message, logs };
    }

    // Step 7: Wait for result
    dlog('Waiting for content.js to send results...');
    const result = await resultPromise;
    dlog(`Content script result received:`);
    dlog(`  success: ${result.success}`);
    dlog(`  title: "${result.title || '(empty)'}"`);
    dlog(`  date: "${result.date || '(empty)'}"`);
    dlog(`  location: "${result.location || '(empty)'}"`);
    dlog(`  description: "${(result.description || '(empty)').substring(0, 200)}"`);
    dlog(`  image: ${result.image ? 'YES (' + result.image.substring(0, 60) + '...)' : '(empty)'}`);
    dlog(`  error: ${result.error || '(none)'}`);

    // Step 8: Close window
    dlog('Closing incognito window...');
    await chrome.windows.remove(win.id);
    dlog('Done!');

    // Return result with logs attached
    return { ...result, logs };

  } catch (err) {
    dlog(`UNEXPECTED ERROR: ${err.message}`);
    if (win) {
      try { await chrome.windows.remove(win.id); } catch {}
    }
    return { success: false, url, error: err.message, logs };
  }
}

function waitForTabLoad(tabId, timeout) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
