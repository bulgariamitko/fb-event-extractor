const urlInput = document.getElementById('urlInput');
const extractBtn = document.getElementById('extractBtn');
const clearBtn = document.getElementById('clearBtn');
const copyBtn = document.getElementById('copyBtn');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

let extractedData = [];

// Listen for progress updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'progress') {
    const pct = Math.round((message.current / message.total) * 100);
    progressFill.style.width = pct + '%';
    statusEl.innerHTML = `Processing <span class="count">${message.current}/${message.total}</span>...`;
  }
});

extractBtn.addEventListener('click', async () => {
  const raw = urlInput.value.trim();
  if (!raw) return;

  // Parse and validate URLs
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const fbEventRegex = /^https?:\/\/(www\.|m\.)?facebook\.com\/events\/\d+\/?/;

  const validUrls = [];
  const duplicates = new Set();
  const seen = new Set();
  let invalidCount = 0;

  for (const line of lines) {
    // Normalize URL
    let url = line.replace(/\/$/, '');
    if (!url.endsWith('/')) url += '/';
    // Normalize to www.facebook.com
    url = url.replace(/m\.facebook\.com/, 'www.facebook.com');

    if (!fbEventRegex.test(url)) {
      invalidCount++;
      continue;
    }

    // Extract event ID for deduplication
    const match = url.match(/\/events\/(\d+)/);
    const eventId = match ? match[1] : url;

    if (seen.has(eventId)) {
      duplicates.add(eventId);
      continue;
    }

    seen.add(eventId);
    validUrls.push(url);
  }

  if (validUrls.length === 0) {
    statusEl.innerHTML = '<span class="error">No valid Facebook event URLs found.</span>';
    return;
  }

  // Show status
  let statusMsg = `Found <span class="count">${validUrls.length}</span> unique event(s)`;
  if (duplicates.size > 0) {
    statusMsg += ` <span class="skipped">(${duplicates.size} duplicate(s) skipped)</span>`;
  }
  if (invalidCount > 0) {
    statusMsg += ` <span class="error">(${invalidCount} invalid URL(s) skipped)</span>`;
  }
  statusEl.innerHTML = statusMsg;

  // Disable UI during extraction
  extractBtn.disabled = true;
  extractBtn.textContent = 'Extracting...';
  progressBar.style.display = 'block';
  progressFill.style.width = '0%';
  resultsEl.innerHTML = '';
  copyBtn.style.display = 'none';

  try {
    // Send to background for processing
    const results = await chrome.runtime.sendMessage({
      action: 'extractEvents',
      urls: validUrls
    });

    extractedData = results || [];
    renderResults(extractedData);

    const successCount = extractedData.filter(r => r.success).length;
    const errorCount = extractedData.filter(r => !r.success).length;

    statusEl.innerHTML = `Done! <span class="count">${successCount} extracted</span>`;
    if (errorCount > 0) {
      statusEl.innerHTML += ` <span class="error">(${errorCount} failed)</span>`;
    }
    if (duplicates.size > 0) {
      statusEl.innerHTML += ` <span class="skipped">(${duplicates.size} duplicate(s) skipped)</span>`;
    }

    if (successCount > 0) {
      copyBtn.style.display = 'block';
    }

  } catch (err) {
    statusEl.innerHTML = `<span class="error">Error: ${err.message}</span>`;
  }

  extractBtn.disabled = false;
  extractBtn.textContent = 'Extract Events';
  progressBar.style.display = 'none';
});

clearBtn.addEventListener('click', () => {
  urlInput.value = '';
  resultsEl.innerHTML = '';
  statusEl.innerHTML = '';
  copyBtn.style.display = 'none';
  extractedData = [];
});

copyBtn.addEventListener('click', () => {
  const jsonData = extractedData.filter(r => r.success).map(r => ({
    title: r.title,
    date: r.date,
    location: r.location,
    description: r.description,
    image: r.image,
    url: r.url
  }));

  navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2)).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy JSON'; }, 1500);
  });
});

function renderResults(results) {
  resultsEl.innerHTML = '';

  results.forEach(event => {
    const card = document.createElement('div');
    card.className = 'event-card' + (event.success ? '' : ' error-card');

    if (event.success) {
      card.innerHTML = `
        ${event.image ? `<img class="cover" src="${escapeHtml(event.image)}" alt="Event cover">` : ''}
        <div class="info">
          <div class="date">${escapeHtml(event.date || 'Date not found')}</div>
          <div class="title">${escapeHtml(event.title || 'Untitled Event')}</div>
          ${event.location ? `<div class="location">${escapeHtml(event.location)}</div>` : ''}
          ${event.description ? `<div class="desc">${escapeHtml(event.description)}</div>` : ''}
        </div>
        <div class="link"><a href="${escapeHtml(event.url)}" target="_blank">${escapeHtml(event.url)}</a></div>
      `;
    } else {
      card.innerHTML = `
        <div class="info">
          <div class="title">Failed to extract</div>
          <div class="desc">${escapeHtml(event.error || 'Unknown error')}</div>
        </div>
        <div class="link"><a href="${escapeHtml(event.url)}" target="_blank">${escapeHtml(event.url)}</a></div>
      `;
    }

    resultsEl.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
