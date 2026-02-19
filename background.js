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
      await sleep(1500);
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

    // Create a promise that will be resolved when content script sends back results
    const resultPromise = new Promise((resolve) => {
      pendingExtractions.set(tab.id, resolve);

      // Timeout: if content script doesn't respond in 15s, resolve with error
      setTimeout(() => {
        if (pendingExtractions.has(tab.id)) {
          pendingExtractions.delete(tab.id);
          resolve({ success: false, url: url, error: 'Content script timeout' });
        }
      }, 15000);
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
