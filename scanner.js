// FB Event Scanner - Auto-extracts events from a Facebook page's events listing
(function () {
  // Prevent double injection
  if (document.getElementById('fbe-scanner-panel')) return;

  let isRunning = false;
  let shouldStop = false;
  let extractedEvents = [];
  let processedKeys = new Set(); // Use full key (eventId + event_time_id) for dedup

  // --- Build the UI panel ---
  const panel = document.createElement('div');
  panel.id = 'fbe-scanner-panel';
  panel.innerHTML = `
    <div class="fbe-header">
      <h3>FB Event Scanner <span style="font-weight:400;font-size:11px;opacity:0.7">v1.2</span></h3>
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
        <button class="fbe-btn-stop" id="fbe-stop">Stop</button>
        <button class="fbe-btn-export" id="fbe-export" disabled>Export JSON</button>
        <button class="fbe-btn-export" id="fbe-copy-log" title="Copy log to clipboard">Copy Log</button>
      </div>
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

  // Minimize toggle
  panel.querySelector('.fbe-minimize').addEventListener('click', () => {
    panel.classList.toggle('minimized');
  });

  // --- UI references ---
  const foundEl = document.getElementById('fbe-found');
  const extractedEl = document.getElementById('fbe-extracted');
  const progressFill = document.getElementById('fbe-progress-fill');
  const progressText = document.getElementById('fbe-progress-text');
  const startBtn = document.getElementById('fbe-start');
  const stopBtn = document.getElementById('fbe-stop');
  const exportBtn = document.getElementById('fbe-export');
  const copyLogBtn = document.getElementById('fbe-copy-log');
  const logEl = document.getElementById('fbe-log');

  // Full log history for copying
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

  // --- Build a unique key for an event link (handles recurring events) ---
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

  // --- Find event cards on the page ---
  function findEventCards() {
    const eventLinks = [...document.querySelectorAll('a[href*="/events/"]')];
    const cards = new Map(); // eventKey -> { card element, url, listingData }

    log(`DOM scan: found ${eventLinks.length} total event <a> tags`, 'info');

    eventLinks.forEach(a => {
      const href = a.href;
      const match = href.match(/\/events\/(\d+)/);
      if (!match) return;

      const eventKey = getEventKey(href);
      if (!eventKey || cards.has(eventKey)) return;

      // Find the parent card container
      let card = a;
      for (let i = 0; i < 15; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
        const links = card.querySelectorAll('a[href*="/events/' + match[1] + '"]');
        if (links.length >= 2) break;
      }

      // For recurring events sharing a parent, we need a more specific card element.
      // Walk back down to find the tightest container that has this specific link.
      // Check if this card element is already used by another event key.
      let alreadyUsed = false;
      cards.forEach((existing) => {
        if (existing.el === card && existing.eventKey !== eventKey) {
          alreadyUsed = true;
        }
      });

      if (alreadyUsed) {
        // Find a more specific container for this link
        card = a;
        for (let i = 0; i < 15; i++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          // Accept a smaller container that still has the image
          if (card.querySelector('img') && card.innerText.length > 10) break;
        }
      }

      // Extract listing-level data
      const spans = card.querySelectorAll('span');
      const texts = [];
      spans.forEach(s => {
        const t = s.innerText.trim();
        if (t && t.length > 2 && t.length < 200 && !texts.includes(t)) {
          texts.push(t);
        }
      });

      const img = card.querySelector('img');
      const thumbSrc = img ? img.src : '';

      // Build the full URL preserving event_time_id
      let fullUrl = 'https://www.facebook.com/events/' + match[1] + '/';
      try {
        const parsed = new URL(href);
        const timeId = parsed.searchParams.get('event_time_id');
        if (timeId) fullUrl += '?event_time_id=' + timeId;
      } catch {}

      cards.set(eventKey, {
        el: card,
        url: fullUrl,
        eventKey: eventKey,
        eventId: match[1],
        listingDate: texts[0] || '',
        listingTitle: texts[1] || '',
        listingLocation: texts.find(t =>
          t.includes(',') || t.includes('·') ||
          /ул\.|бул\.|пл\.|str|ave|road|blvd/i.test(t)
        ) || texts[2] || '',
        thumbnail: thumbSrc,
        allTexts: texts
      });
    });

    log(`Card scan: ${cards.size} unique events (by eventId+timeId)`, 'info');
    return cards;
  }

  // --- Scroll to load more events ---
  function scrollToLoadMore() {
    return new Promise(resolve => {
      const beforeCount = document.querySelectorAll('a[href*="/events/"]').length;
      log(`Scrolling... (${beforeCount} links before)`, 'info');
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

      let checks = 0;
      const interval = setInterval(() => {
        checks++;
        const afterCount = document.querySelectorAll('a[href*="/events/"]').length;
        if (afterCount > beforeCount) {
          log(`Scroll loaded ${afterCount - beforeCount} new links (total: ${afterCount})`, 'ok');
          clearInterval(interval);
          resolve(true);
        } else if (checks > 10) {
          log(`Scroll: no new links after ${checks} checks`, 'skip');
          clearInterval(interval);
          resolve(false);
        }
      }, 800);
    });
  }

  // --- Extract full details from an event page (via background tab) ---
  function extractEventDetails(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'extractSingleEvent', url: url },
        (response) => {
          if (chrome.runtime.lastError) {
            log(`Chrome runtime error: ${chrome.runtime.lastError.message}`, 'err');
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: 'No response from background' });
          }
        }
      );
    });
  }

  // --- Main scan loop ---
  async function startScanning() {
    isRunning = true;
    shouldStop = false;
    startBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    log('=== Scanning started ===', 'info');

    let noNewEventsCount = 0;
    let totalFound = 0;

    while (!shouldStop) {
      const cards = findEventCards();
      const newCards = [];

      cards.forEach((data, eventKey) => {
        if (!processedKeys.has(eventKey)) {
          newCards.push({ eventKey, ...data });
        }
      });

      totalFound = cards.size;
      foundEl.textContent = totalFound;

      log(`Round: ${cards.size} total, ${newCards.length} new, ${processedKeys.size} already processed`, 'info');

      if (newCards.length === 0) {
        log('No new events visible, will scroll...', 'info');
        progressText.textContent = 'Scrolling to load more events...';
        const gotMore = await scrollToLoadMore();

        if (!gotMore) {
          noNewEventsCount++;
          log(`No new content attempt ${noNewEventsCount}/3`, 'skip');
          if (noNewEventsCount >= 3) {
            log('No more events to load. Done!', 'ok');
            break;
          }
          await sleep(2000);
          continue;
        }
        noNewEventsCount = 0;
        continue;
      }

      noNewEventsCount = 0;

      for (let i = 0; i < newCards.length; i++) {
        if (shouldStop) break;

        const card = newCards[i];
        processedKeys.add(card.eventKey);

        card.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500);

        card.el.classList.remove('fbe-extracted', 'fbe-error');
        card.el.classList.add('fbe-extracting');

        const displayName = card.listingTitle || card.eventKey;
        progressText.textContent = `Extracting ${i + 1}/${newCards.length}: ${displayName}`;
        const pct = Math.round(((extractedEvents.length + 1) / totalFound) * 100);
        progressFill.style.width = Math.min(pct, 100) + '%';

        log(`[${i + 1}/${newCards.length}] Extracting: ${displayName} (key: ${card.eventKey})`, 'info');
        log(`  URL: ${card.url}`, 'info');

        try {
          const details = await extractEventDetails(card.url);

          card.el.classList.remove('fbe-extracting');

          if (details && details.success) {
            card.el.classList.add('fbe-extracted');

            const event = {
              eventId: card.eventId,
              eventKey: card.eventKey,
              url: card.url,
              title: details.title || card.listingTitle,
              date: details.date || card.listingDate,
              location: details.location || card.listingLocation,
              description: details.description || '',
              image: details.image || card.thumbnail,
              thumbnail: card.thumbnail
            };

            extractedEvents.push(event);
            log(`  OK: "${event.title}" | date: ${event.date} | desc: ${event.description ? event.description.substring(0, 60) + '...' : '(empty)'}`, 'ok');
          } else {
            // Use listing data as fallback
            card.el.classList.add('fbe-extracted');

            const event = {
              eventId: card.eventId,
              eventKey: card.eventKey,
              url: card.url,
              title: card.listingTitle,
              date: card.listingDate,
              location: card.listingLocation,
              description: '',
              image: card.thumbnail,
              thumbnail: card.thumbnail
            };

            extractedEvents.push(event);
            const reason = details ? details.error : 'unknown';
            log(`  Partial (listing only): "${card.listingTitle}" | reason: ${reason}`, 'skip');
            log(`  Listing texts: ${card.allTexts.join(' | ')}`, 'skip');
          }
        } catch (err) {
          card.el.classList.remove('fbe-extracting');
          card.el.classList.add('fbe-error');
          log(`  ERROR: ${card.eventKey} - ${err.message}`, 'err');
        }

        updateStats();

        if (i < newCards.length - 1) {
          await sleep(2000);
        }
      }

      if (!shouldStop) {
        await sleep(1000);
      }
    }

    finishScanning();
  }

  function finishScanning() {
    isRunning = false;
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    startBtn.textContent = 'Scan Again';
    progressText.textContent = `Done! ${extractedEvents.length} events extracted.`;
    progressFill.style.width = '100%';
    log(`=== Finished: ${extractedEvents.length} events total ===`, 'ok');
  }

  // --- Event Listeners ---
  startBtn.addEventListener('click', () => {
    startScanning();
  });

  stopBtn.addEventListener('click', () => {
    shouldStop = true;
    log('Stopping...', 'skip');
    progressText.textContent = 'Stopping...';
  });

  exportBtn.addEventListener('click', () => {
    const jsonData = extractedEvents.map(e => ({
      title: e.title,
      date: e.date,
      location: e.location,
      description: e.description,
      image: e.image,
      url: e.url
    }));

    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fb-events-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

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

  log('Panel ready. Click "Start Scanning" to begin.', 'info');
})();
