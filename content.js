// Content script injected into Facebook event pages to extract event data.
// Sends the result back via chrome.runtime.sendMessage when done.
(async function () {
  const result = { success: false };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  try {
    const main = document.querySelector('[role="main"]');
    if (!main) {
      result.error = 'Could not find main content area';
      chrome.runtime.sendMessage({ action: 'extractionResult', data: result });
      return;
    }

    // --- Click all "See more" buttons to expand truncated text ---
    function clickSeeMore(container) {
      const selectors = ['div[role="button"]', 'span[role="button"]', 'a[role="button"]', 'span'];
      for (const sel of selectors) {
        container.querySelectorAll(sel).forEach(btn => {
          const text = btn.innerText.trim().toLowerCase();
          if (text === 'see more' || text === 'вижте още') {
            btn.click();
          }
        });
      }
    }

    // First pass: click all "See more" on the page
    clickSeeMore(main);
    await sleep(1000);

    // --- Title ---
    const skipHeadings = new Set([
      'notifications', 'new', 'events', 'recommended events',
      'guests', 'details', 'meet your hosts', 'suggested events',
      'more events', 'other events', 'people also viewed'
    ]);
    const allH1 = [...main.querySelectorAll('h1')];
    const titleEl = allH1.find(h => !skipHeadings.has(h.innerText.trim().toLowerCase()));
    result.title = titleEl ? titleEl.innerText.trim() : '';

    // --- Date & Time ---
    const spans = main.querySelectorAll('span');
    const datePatterns = [];
    const fullDateRegex = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)[,\s]+\d{1,2}\s+\w+\s+\d{4}(\s+at\s+\d{1,2}:\d{2})?/i;
    const dateRegex = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i;

    spans.forEach(s => {
      const t = s.innerText.trim();
      if (t && fullDateRegex.test(t)) datePatterns.push(t);
    });

    if (datePatterns.length > 0) {
      datePatterns.sort((a, b) => b.length - a.length);
      result.date = datePatterns[0];
    } else {
      const fallbackDate = [];
      spans.forEach(s => {
        const t = s.innerText.trim();
        if (t && dateRegex.test(t) && t.length > 8 && t.length < 80) fallbackDate.push(t);
      });
      fallbackDate.sort((a, b) => b.length - a.length);
      result.date = fallbackDate[0] || '';
    }

    // --- Cover Image ---
    const imgs = main.querySelectorAll('img');
    let maxArea = 0;
    let coverSrc = '';
    imgs.forEach(img => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const area = w * h;
      if (area > maxArea && w > 200) {
        maxArea = area;
        coverSrc = img.src;
      }
    });
    result.image = coverSrc;

    // --- Location ---
    const locationCandidates = [];
    spans.forEach(s => {
      const t = s.innerText.trim();
      if (t.length < 5 || t.length > 200) return;
      if (t.match(/\d+.*,\s*\w+/) || t.match(/ул\.|бул\.|пл\.|str\.|ave\.|road|blvd/i)) {
        locationCandidates.push(t);
      }
    });
    let venue = '';
    if (titleEl) {
      let parent = titleEl.parentElement;
      while (parent && parent !== main) {
        const sibling = parent.nextElementSibling;
        if (sibling) {
          const aLinks = sibling.querySelectorAll('a');
          aLinks.forEach(a => {
            const text = a.innerText.trim();
            if (text.length > 3 && text.length < 100 && !text.match(/^(More|About|Discussion|Going|Interested|Share|Invite)$/i)) {
              if (!venue) venue = text;
            }
          });
        }
        parent = parent.parentElement;
      }
    }
    result.location = venue || locationCandidates[0] || '';

    // --- Description ---
    result.description = '';

    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, null);
    let detailsTextNode = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim() === 'Details') {
        detailsTextNode = walker.currentNode;
        break;
      }
    }

    if (detailsTextNode) {
      let section = detailsTextNode.parentElement;
      for (let i = 0; i < 8; i++) {
        if (!section.parentElement || section.parentElement === main) break;
        section = section.parentElement;
      }

      // Second pass: click "See more" specifically in the Details section
      clickSeeMore(section);
      await sleep(800);

      const sectionText = section.innerText || '';
      const lines = sectionText.split('\n');

      const skipPatterns = [
        /^Details$/,
        /^\d+ people responded$/,
        /^Event by /,
        /^Public$/,
        /^Private$/,
        /^Anyone on or off Facebook$/,
        /^· Anyone/,
        /^Duration:/,
        /^Price:/,
        /^Tickets/i,
        /^\d+ (Going|Interested|Went)$/,
        /^See more$/i,
        /^Вижте още$/i,
        /^See less$/i,
        /^Вижте по-малко$/i,
      ];

      const titleLower = (result.title || '').toLowerCase();
      const dateLower = (result.date || '').toLowerCase();
      const locationLower = (result.location || '').toLowerCase();

      const descLines = lines.filter(line => {
        const l = line.trim();
        if (l.length === 0) return false;
        for (const pat of skipPatterns) {
          if (pat.test(l)) return false;
        }
        if (titleLower && l.toLowerCase() === titleLower) return false;
        if (dateLower && l.toLowerCase().includes(dateLower)) return false;
        if (locationLower && l.toLowerCase() === locationLower) return false;
        if (l.length <= 3) return false;
        return true;
      });

      if (descLines.length > 0) {
        result.description = descLines.join('\n').trim();
      }
    }

    result.success = true;
    result.url = window.location.href;

  } catch (e) {
    result.error = e.message;
  }

  // Send result back to background script via messaging
  chrome.runtime.sendMessage({ action: 'extractionResult', data: result });
})();
