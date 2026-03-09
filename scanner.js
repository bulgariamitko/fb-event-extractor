// FB Event Scanner - Auto-extracts events from a Facebook page's events listing
(function () {
  // Prevent double injection
  if (document.getElementById('fbe-scanner-panel')) return;

  // Only show panel on pages that have event links or are event-related URLs
  const url = window.location.href;
  const isEventPage = /\/(events|past_hosted_events|upcoming_hosted_events)/.test(url)
    || /sk=(past_hosted_events|upcoming_hosted_events|events)/.test(url);

  if (!isEventPage) {
    let checkCount = 0;
    const checker = setInterval(() => {
      checkCount++;
      const eventLinks = document.querySelectorAll('a[href*="/events/"]');
      if (eventLinks.length >= 2) {
        clearInterval(checker);
        initScanner();
      } else if (checkCount > 10) {
        clearInterval(checker);
      }
    }, 1500);
    return;
  }

  initScanner();

  function initScanner() {
  if (document.getElementById('fbe-scanner-panel')) return;

  let isRunning = false;
  let shouldStop = false;
  let extractedEvents = [];
  let processedKeys = new Set();

  // --- Build the UI panel ---
  const panel = document.createElement('div');
  panel.id = 'fbe-scanner-panel';
  panel.innerHTML = `
    <div class="fbe-header">
      <h3>FB Event Scanner <span style="font-weight:400;font-size:11px;opacity:0.7">v5.1</span></h3>
      <button class="fbe-minimize" title="Minimize">&#8212;</button>
    </div>
    <div class="fbe-body">
      <div class="fbe-stats">
        <div class="fbe-stat">
          <span class="fbe-stat-num" id="fbe-found">0</span>
          <span class="fbe-stat-label">Found</span>
        </div>
        <div class="fbe-stat">
          <span class="fbe-stat-num" id="fbe-extracted">0</span>
          <span class="fbe-stat-label">Extracted</span>
        </div>
      </div>
      <div class="fbe-progress">
        <div class="fbe-progress-bar"><div class="fbe-progress-fill" id="fbe-progress-fill"></div></div>
        <div class="fbe-progress-text" id="fbe-progress-text">Ready to scan</div>
      </div>
      <div class="fbe-actions">
        <button class="fbe-btn-start" id="fbe-start">Start Scanning</button>
        <button class="fbe-btn-start" id="fbe-incognito" style="background:#7c3aed">Start Incognito</button>
        <button class="fbe-btn-export" id="fbe-fix-missing" style="background:#e67e22;color:#fff">Fix Missing</button>
        <button class="fbe-btn-export" id="fbe-export" disabled>Export JSON</button>
        <button class="fbe-btn-stop" id="fbe-stop" style="grid-column:1/-1">Stop</button>
        <button class="fbe-btn-export" id="fbe-copy-log" title="Copy log to clipboard" style="grid-column:1/-1">Copy Log</button>
      </div>
      <input type="file" id="fbe-file-input" accept=".json" style="display:none">
      <div class="fbe-log" id="fbe-log"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // --- Make panel draggable ---
  const header = panel.querySelector('.fbe-header');
  let isDragging = false, dragX, dragY;
  header.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('fbe-minimize')) return;
    isDragging = true;
    dragX = e.clientX - panel.offsetLeft;
    dragY = e.clientY - panel.offsetTop;
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (e.clientX - dragX) + 'px';
    panel.style.top = (e.clientY - dragY) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { isDragging = false; });

  panel.querySelector('.fbe-minimize').addEventListener('click', () => {
    panel.classList.toggle('minimized');
  });

  // --- UI references ---
  const foundEl = document.getElementById('fbe-found');
  const extractedEl = document.getElementById('fbe-extracted');
  const progressFill = document.getElementById('fbe-progress-fill');
  const progressText = document.getElementById('fbe-progress-text');
  const startBtn = document.getElementById('fbe-start');
  const incognitoBtn = document.getElementById('fbe-incognito');
  const fixMissingBtn = document.getElementById('fbe-fix-missing');
  const stopBtn = document.getElementById('fbe-stop');
  const exportBtn = document.getElementById('fbe-export');
  const copyLogBtn = document.getElementById('fbe-copy-log');
  const fileInput = document.getElementById('fbe-file-input');
  const logEl = document.getElementById('fbe-log');

  const logHistory = [];

  function log(msg, type = '') {
    const timestamp = new Date().toLocaleTimeString();
    const fullMsg = `[${timestamp}] ${msg}`;
    logHistory.push(fullMsg);
    const div = document.createElement('div');
    if (type) div.className = 'fbe-log-' + type;
    div.textContent = fullMsg;
    logEl.prepend(div);
    while (logEl.children.length > 80) logEl.lastChild.remove();
  }

  function updateStats() {
    extractedEl.textContent = extractedEvents.length;
    exportBtn.disabled = extractedEvents.length === 0;
  }

  function getEventKey(href) {
    const match = href.match(/\/events\/(\d+)/);
    if (!match) return null;
    const eventId = match[1];
    try {
      const url = new URL(href);
      const timeId = url.searchParams.get('event_time_id');
      return timeId ? eventId + '_' + timeId : eventId;
    } catch {
      return eventId;
    }
  }

  // --- Find the actual scrollable container ---
  function findScrollContainer() {
    const eventLink = document.querySelector('a[href*="/events/"]');
    if (eventLink) {
      let el = eventLink.parentElement;
      while (el && el !== document.body && el !== document.documentElement) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50) {
          return el;
        }
        el = el.parentElement;
      }
    }

    const candidates = [
      document.querySelector('[role="main"]'),
      document.querySelector('[data-pagelet="page"]'),
      document.querySelector('[data-pagelet="ProfileTimeline"]'),
    ].filter(Boolean);

    for (const el of candidates) {
      let parent = el;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const style = window.getComputedStyle(parent);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight + 50) {
          return parent;
        }
        parent = parent.parentElement;
      }
    }

    const all = document.querySelectorAll('div');
    let best = null;
    let bestDiff = 0;
    all.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        const diff = el.scrollHeight - el.clientHeight;
        if (diff > bestDiff && diff > 100) { bestDiff = diff; best = el; }
      }
    });
    return best;
  }

  function scrollDown(container, amount) {
    if (container) { container.scrollTop += amount; } else { window.scrollBy(0, amount); }
  }

  function isAtBottom(container) {
    if (container) return container.scrollTop + container.clientHeight >= container.scrollHeight - 100;
    return window.scrollY + window.innerHeight >= document.body.scrollHeight - 100;
  }

  function getScrollHeight(container) {
    return container ? container.scrollHeight : document.body.scrollHeight;
  }

  // --- Find event cards on the page ---
  function findEventCards() {
    const eventLinks = [...document.querySelectorAll('a[href*="/events/"]')];
    const cards = new Map();

    eventLinks.forEach(a => {
      const href = a.href;
      const match = href.match(/\/events\/(\d+)/);
      if (!match) return;

      const eventKey = getEventKey(href);
      if (!eventKey || cards.has(eventKey)) return;

      let card = a;
      for (let i = 0; i < 15; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
        const links = card.querySelectorAll('a[href*="/events/' + match[1] + '"]');
        if (links.length >= 2) break;
      }

      let alreadyUsed = false;
      cards.forEach((existing) => {
        if (existing.el === card && existing.eventKey !== eventKey) alreadyUsed = true;
      });

      if (alreadyUsed) {
        card = a;
        for (let i = 0; i < 15; i++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          if (card.querySelector('img') && card.innerText.length > 10) break;
        }
      }

      const spans = card.querySelectorAll('span');
      const texts = [];
      spans.forEach(s => {
        const t = s.innerText.trim();
        if (t && t.length > 2 && t.length < 200 && !texts.includes(t)) texts.push(t);
      });

      const img = card.querySelector('img');
      const thumbSrc = img ? img.src : '';

      let fullUrl = 'https://www.facebook.com/events/' + match[1] + '/';
      try {
        const parsed = new URL(href);
        const timeId = parsed.searchParams.get('event_time_id');
        if (timeId) fullUrl += '?event_time_id=' + timeId;
      } catch {}

      cards.set(eventKey, {
        el: card, url: fullUrl, eventKey, eventId: match[1],
        listingDate: texts[0] || '', listingTitle: texts[1] || '',
        listingLocation: texts.find(t =>
          t.includes(',') || t.includes('·') || /ул\.|бул\.|пл\.|str|ave|road|blvd/i.test(t)
        ) || texts[2] || '',
        thumbnail: thumbSrc, allTexts: texts
      });
    });

    return cards;
  }

  // --- Scroll helpers ---
  async function scrollToLoadMore(container) {
    const beforeHeight = getScrollHeight(container);

    for (let i = 0; i < 50; i++) {
      if (shouldStop) return false;
      scrollDown(container, 300);
      await sleep(150);
      if (isAtBottom(container)) break;
    }

    for (let wait = 0; wait < 8; wait++) {
      await sleep(2000);
      if (shouldStop) return false;
      const newHeight = getScrollHeight(container);
      if (newHeight > beforeHeight + 100) {
        log(`Page grew: ${beforeHeight} -> ${newHeight} (+${newHeight - beforeHeight}px)`, 'ok');
        scrollDown(container, 300);
        await sleep(1500);
        return true;
      }
      scrollDown(container, 100);
      await sleep(200);
      scrollDown(container, -50);
    }
    return false;
  }

  async function scrollToLoadAll(container) {
    log('Scrolling to load all events...', 'info');
    let noGrowthRounds = 0;

    while (!shouldStop) {
      const beforeHeight = getScrollHeight(container);
      const beforeCards = findEventCards().size;

      for (let i = 0; i < 50; i++) {
        if (shouldStop) return;
        scrollDown(container, 300);
        await sleep(150);
        if (isAtBottom(container)) break;
      }

      let loaded = false;
      for (let wait = 0; wait < 8; wait++) {
        await sleep(2000);
        if (shouldStop) return;
        const newHeight = getScrollHeight(container);
        const newCards = findEventCards().size;
        if (newCards > beforeCards || newHeight > beforeHeight + 100) {
          log(`Loaded more: ${beforeCards} -> ${newCards} events`, 'ok');
          foundEl.textContent = newCards;
          progressText.textContent = `Loading events... (${newCards} found)`;
          loaded = true;
          break;
        }
        scrollDown(container, 100);
        await sleep(200);
        scrollDown(container, -50);
      }

      if (!loaded) {
        noGrowthRounds++;
        if (noGrowthRounds >= 3) { log('No more events loading.', 'ok'); break; }
        scrollDown(container, -500);
        await sleep(1000);
      } else {
        noGrowthRounds = 0;
      }
    }
  }

  // --- Extract functions ---
  function extractEventDetails(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'extractSingleEvent', url }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: 'No response from background' });
        }
      });
    });
  }

  function extractEventDetailsIncognito(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'extractSingleEventIncognito', url }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: 'No response from background' });
        }
      });
    });
  }

  // --- Process a single event card ---
  async function processCard(card, index, total, useIncognito) {
    processedKeys.add(card.eventKey);

    card.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);

    card.el.classList.remove('fbe-extracted', 'fbe-error');
    card.el.classList.add('fbe-extracting');

    const displayName = card.listingTitle || card.eventKey;
    const mode = useIncognito ? '[Incognito]' : '';
    progressText.textContent = `${mode} ${index + 1}/${total}: ${displayName}`;
    progressFill.style.width = Math.round(((index + 1) / total) * 100) + '%';

    log(`[${index + 1}/${total}] ${mode} ${displayName}`, 'info');

    try {
      const details = useIncognito
        ? await extractEventDetailsIncognito(card.url)
        : await extractEventDetails(card.url);

      card.el.classList.remove('fbe-extracting');

      if (details && details.error === 'RATE_LIMITED') {
        card.el.classList.add('fbe-error');
        processedKeys.delete(card.eventKey);
        log('RATE LIMITED! Pausing 2 min...', 'err');
        progressText.textContent = 'Rate limited! Pausing 2 min...';
        await sleep(120000);
        log('Resuming...', 'info');
        return 'rate_limited';
      }

      if (details && details.success) {
        card.el.classList.add('fbe-extracted');
        extractedEvents.push({
          eventId: card.eventId, eventKey: card.eventKey, url: card.url,
          title: details.title || card.listingTitle,
          date: details.date || card.listingDate,
          location: details.location || card.listingLocation,
          description: details.description || '',
          image: details.image || card.thumbnail,
          thumbnail: card.thumbnail
        });
        log(`  OK: "${details.title || card.listingTitle}"`, 'ok');
      } else {
        card.el.classList.add('fbe-extracted');
        extractedEvents.push({
          eventId: card.eventId, eventKey: card.eventKey, url: card.url,
          title: card.listingTitle, date: card.listingDate,
          location: card.listingLocation, description: '',
          image: card.thumbnail, thumbnail: card.thumbnail
        });
        log(`  Partial: "${card.listingTitle}" | ${details ? details.error : 'unknown'}`, 'skip');
      }
    } catch (err) {
      card.el.classList.remove('fbe-extracting');
      card.el.classList.add('fbe-error');
      log(`  ERROR: ${err.message}`, 'err');
    }

    updateStats();
    return 'ok';
  }

  // =============================================
  // Normal scan: extract visible, scroll, repeat
  // =============================================
  async function startScanning() {
    isRunning = true;
    shouldStop = false;
    startBtn.style.display = 'none';
    incognitoBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    log('=== Normal Scan started ===', 'info');

    const container = findScrollContainer();
    if (container) {
      log(`Scroll container: <${container.tagName}>`, 'ok');
    } else {
      log('Using window scroll', 'info');
    }

    let noNewEventsCount = 0;

    while (!shouldStop) {
      const cards = findEventCards();
      const newCards = [];
      cards.forEach((data, eventKey) => {
        if (!processedKeys.has(eventKey)) newCards.push({ eventKey, ...data });
      });

      foundEl.textContent = cards.size;
      log(`Round: ${cards.size} total, ${newCards.length} new, ${processedKeys.size} done`, 'info');

      if (newCards.length === 0) {
        log('No new events, scrolling...', 'info');
        progressText.textContent = 'Scrolling to load more...';
        const gotMore = await scrollToLoadMore(container);
        if (!gotMore) {
          noNewEventsCount++;
          if (noNewEventsCount >= 3) { log('No more events. Done!', 'ok'); break; }
          await sleep(2000);
          continue;
        }
        noNewEventsCount = 0;
        continue;
      }

      noNewEventsCount = 0;

      for (let i = 0; i < newCards.length; i++) {
        if (shouldStop) break;
        const result = await processCard(newCards[i], extractedEvents.length, cards.size, false);
        if (result === 'rate_limited') break;

        if (i < newCards.length - 1) {
          const delay = 5000 + Math.floor(Math.random() * 3000);
          log(`  Waiting ${(delay / 1000).toFixed(1)}s...`, 'info');
          await sleep(delay);
        }
      }

      if (!shouldStop) await sleep(3000);
    }

    finishScanning();
  }

  // =============================================
  // Incognito scan: scroll all, then extract
  // with NO delays (not logged in = no rate limit)
  // =============================================
  async function startIncognitoScan() {
    isRunning = true;
    shouldStop = false;
    startBtn.style.display = 'none';
    incognitoBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    log('=== Incognito Scan started ===', 'info');
    log('Requires "Allow in Incognito" enabled in chrome://extensions', 'info');

    const container = findScrollContainer();
    if (container) {
      log(`Scroll container: <${container.tagName}>`, 'ok');
    } else {
      log('Using window scroll', 'info');
    }

    // Step 1: Scroll to load all events
    progressText.textContent = 'Step 1: Loading all events...';
    await scrollToLoadAll(container);
    if (shouldStop) { finishScanning(); return; }

    // Step 2: Collect all event cards
    const cards = findEventCards();
    const allCards = [];
    cards.forEach((data, eventKey) => {
      if (!processedKeys.has(eventKey)) allCards.push({ eventKey, ...data });
    });

    foundEl.textContent = allCards.length;
    log(`Step 2: Extracting ${allCards.length} events via incognito (no delays)`, 'info');

    // Scroll back to top
    if (container) { container.scrollTop = 0; } else { window.scrollTo(0, 0); }
    await sleep(500);

    // Step 3: Extract each event in incognito - NO delays
    for (let i = 0; i < allCards.length; i++) {
      if (shouldStop) break;
      const result = await processCard(allCards[i], i, allCards.length, true);
      if (result === 'rate_limited') { i--; continue; }
    }

    finishScanning();
  }

  // =============================================
  // Fix Missing: load JSON, re-extract events
  // with empty descriptions via incognito (no delays)
  // =============================================
  async function startFixMissing(events) {
    isRunning = true;
    shouldStop = false;
    startBtn.style.display = 'none';
    incognitoBtn.style.display = 'none';
    fixMissingBtn.style.display = 'none';
    stopBtn.style.display = 'block';

    // Load all events into extractedEvents
    extractedEvents = events;
    updateStats();

    // Find events with empty description
    const missing = [];
    for (let i = 0; i < events.length; i++) {
      if (!events[i].description || events[i].description.trim() === '') {
        missing.push(i);
      }
    }

    const total = events.length;
    const missingCount = missing.length;
    log(`=== Fix Missing started ===`, 'info');
    log(`Total events: ${total}, with description: ${total - missingCount}, missing: ${missingCount}`, 'info');
    foundEl.textContent = total;

    if (missingCount === 0) {
      log('All events already have descriptions!', 'ok');
      finishScanning();
      return;
    }

    log(`Re-extracting ${missingCount} events via incognito (no delays)`, 'info');

    let fixed = 0;
    for (let j = 0; j < missing.length; j++) {
      if (shouldStop) break;

      const idx = missing[j];
      const event = events[idx];
      const displayName = event.title || event.url;
      progressText.textContent = `[Fix] ${j + 1}/${missingCount}: ${displayName}`;
      progressFill.style.width = Math.round(((j + 1) / missingCount) * 100) + '%';

      log(`[${j + 1}/${missingCount}] Fixing: "${displayName}"`, 'info');

      try {
        const details = await extractEventDetailsIncognito(event.url);

        if (details && details.error === 'RATE_LIMITED') {
          log('RATE LIMITED! Pausing 2 min...', 'err');
          progressText.textContent = 'Rate limited! Pausing 2 min...';
          await sleep(120000);
          log('Resuming...', 'info');
          j--; // retry this event
          continue;
        }

        if (details && details.success && details.description && details.description.trim()) {
          extractedEvents[idx].description = details.description;
          // Also update other fields if they were empty
          if (!extractedEvents[idx].title && details.title) extractedEvents[idx].title = details.title;
          if (!extractedEvents[idx].date && details.date) extractedEvents[idx].date = details.date;
          if (!extractedEvents[idx].location && details.location) extractedEvents[idx].location = details.location;
          if (!extractedEvents[idx].image && details.image) extractedEvents[idx].image = details.image;
          fixed++;
          log(`  OK: got description (${details.description.length} chars)`, 'ok');
        } else {
          log(`  SKIP: no description returned | ${details ? details.error || 'empty desc' : 'no response'}`, 'skip');
        }
      } catch (err) {
        log(`  ERROR: ${err.message}`, 'err');
      }

      updateStats();
    }

    log(`=== Fix Missing done: ${fixed}/${missingCount} descriptions recovered ===`, 'ok');
    finishScanning();
  }

  function finishScanning() {
    isRunning = false;
    startBtn.style.display = 'block';
    incognitoBtn.style.display = 'block';
    fixMissingBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    startBtn.textContent = 'Scan Again';
    incognitoBtn.textContent = 'Incognito Again';
    progressText.textContent = `Done! ${extractedEvents.length} events extracted.`;
    progressFill.style.width = '100%';
    log(`=== Finished: ${extractedEvents.length} events total ===`, 'ok');
  }

  // --- Event Listeners ---
  startBtn.addEventListener('click', () => { startScanning(); });
  incognitoBtn.addEventListener('click', () => { startIncognitoScan(); });

  fixMissingBtn.addEventListener('click', () => { fileInput.click(); });
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const events = JSON.parse(evt.target.result);
        if (!Array.isArray(events)) {
          log('Invalid JSON: expected an array of events', 'err');
          return;
        }
        log(`Loaded ${events.length} events from ${file.name}`, 'ok');
        startFixMissing(events);
      } catch (err) {
        log(`Failed to parse JSON: ${err.message}`, 'err');
      }
    };
    reader.readAsText(file);
    fileInput.value = ''; // reset so same file can be re-selected
  });

  stopBtn.addEventListener('click', () => {
    shouldStop = true;
    log('Stopping...', 'skip');
    progressText.textContent = 'Stopping...';
  });

  exportBtn.addEventListener('click', () => {
    const jsonData = extractedEvents.map(e => ({
      title: e.title, date: e.date, location: e.location,
      description: e.description, image: e.image, url: e.url
    }));
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = 'fb-events-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(dlUrl);
    log('JSON exported!', 'ok');
  });

  copyLogBtn.addEventListener('click', () => {
    const logText = logHistory.join('\n');
    navigator.clipboard.writeText(logText).then(() => {
      copyLogBtn.textContent = 'Copied!';
      setTimeout(() => { copyLogBtn.textContent = 'Copy Log'; }, 1500);
    });
  });

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  log('Panel ready. Click "Start Scanning" or "Start Incognito".', 'info');
  } // end initScanner
})();
