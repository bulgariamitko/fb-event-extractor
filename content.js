// Content script injected into Facebook event pages to extract event data.
// Sends the result back via chrome.runtime.sendMessage when done.
// Language-agnostic: works in English, Bulgarian, Swedish, and other languages.
(async function () {
  const result = { success: false };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Facebook footer/navigation junk to filter out
  const footerJunk = [
    'integritet', 'användarvillkor', 'annonsering', 'annonsalternativ',
    'cookies', 'mer information', 'privacy', 'terms', 'advertising',
    'ad choices', 'datenschutz', 'impressum', 'nutzungsbedingungen',
    'confidentialité', 'conditions', 'meta © 2', 'meta ©'
  ];

  function isFooterJunk(text) {
    const lower = text.toLowerCase();
    // Check if the line contains footer markers
    if (/integritet\s*·|privacy\s*·|cookies\s*·|användarvillkor/i.test(lower)) return true;
    if (/^\s*(integritet|privacy|terms|cookies|annonsering|advertising|ad choices)\s*$/i.test(lower)) return true;
    // Check for footer separator pattern: "Word · Word · Word"
    if ((lower.match(/·/g) || []).length >= 2 && lower.length < 200) {
      const parts = lower.split('·').map(p => p.trim());
      const junkParts = parts.filter(p => footerJunk.some(j => p.includes(j)));
      if (junkParts.length >= 2) return true;
    }
    return false;
  }

  try {
    const main = document.querySelector('[role="main"]');
    if (!main) {
      result.error = 'Could not find main content area';
      chrome.runtime.sendMessage({ action: 'extractionResult', data: result });
      return;
    }

    // --- Click all "See more" buttons to expand truncated text ---
    const seeMorePatterns = [
      'see more', 'вижте още', 'visa mer', 'mehr anzeigen', 'voir plus',
      'ver más', 'mostra altro', 'mais informações', 'daha fazla gör'
    ];
    const seeLessPatterns = [
      'see less', 'вижте по-малко', 'visa mindre', 'weniger anzeigen',
      'voir moins', 'ver menos', 'mostra meno', 'menos informações'
    ];

    function clickSeeMore(container) {
      const selectors = ['div[role="button"]', 'span[role="button"]', 'a[role="button"]', 'span'];
      for (const sel of selectors) {
        container.querySelectorAll(sel).forEach(btn => {
          const text = btn.innerText.trim().toLowerCase();
          if (seeMorePatterns.includes(text)) {
            btn.click();
          }
        });
      }
    }

    clickSeeMore(main);
    await sleep(1000);

    // --- Title ---
    const skipHeadings = new Set([
      'notifications', 'new', 'events', 'recommended events',
      'guests', 'details', 'meet your hosts', 'suggested events',
      'more events', 'other events', 'people also viewed',
      'evenemang', 'aviseringar', 'gäster', 'detaljer', 'föreslagna evenemang',
      'събития', 'известия', 'гости', 'подробности', 'предложени събития',
      'veranstaltungen', 'benachrichtigungen', 'gäste', 'details',
    ]);
    const allH1 = [...main.querySelectorAll('h1')];
    const titleEl = allH1.find(h => !skipHeadings.has(h.innerText.trim().toLowerCase()));
    result.title = titleEl ? titleEl.innerText.trim() : '';

    // --- Date & Time (language-agnostic) ---
    result.date = '';

    // Strategy 1: <time> elements with datetime attribute
    const timeEls = main.querySelectorAll('time[datetime]');
    if (timeEls.length > 0) {
      const dtText = timeEls[0].innerText.trim();
      const dtAttr = timeEls[0].getAttribute('datetime');
      result.date = dtText || dtAttr || '';
    }

    // Strategy 2: Multi-language day/month name matching in spans
    if (!result.date) {
      const spans = main.querySelectorAll('span');
      const dayPattern = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday' +
        '|mon|tue|wed|thu|fri|sat|sun' +
        '|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|mån|tis|ons|tor|fre|lör|sön' +
        '|понеделник|вторник|сряда|четвъртък|петък|събота|неделя' +
        '|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag' +
        '|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)';
      const monthPattern = '(january|february|march|april|may|june|july|august|september|october|november|december' +
        '|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec' +
        '|januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december' +
        '|януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември' +
        '|januar|februar|märz|mai|oktober|dezember' +
        '|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)';

      const dateRegexFull = new RegExp('^' + dayPattern + '[,\\s]+\\d{1,2}\\s+\\w+\\s+\\d{4}', 'i');
      const dateRegexDayMonth = new RegExp('^' + dayPattern + '[,\\s]+\\d{1,2}\\s+' + monthPattern, 'i');
      const dateRegexNumFirst = new RegExp('^\\d{1,2}\\s+' + monthPattern + '\\s+\\d{4}', 'i');

      const candidates = [];
      spans.forEach(s => {
        const t = s.innerText.trim();
        if (!t || t.length < 5 || t.length > 80) return;
        // SKIP image alt text (starts with "Kan vara en bild" or similar)
        if (/^(kan vara|may be|може да|peut être|könnte ein)/i.test(t)) return;
        if (dateRegexFull.test(t)) {
          candidates.push({ text: t, score: 3 });
        } else if (dateRegexDayMonth.test(t)) {
          candidates.push({ text: t, score: 2 });
        } else if (dateRegexNumFirst.test(t)) {
          candidates.push({ text: t, score: 2 });
        }
      });

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
        result.date = candidates[0].text;
      }
    }

    // Strategy 3: aria-label with date info
    if (!result.date) {
      const allEls = main.querySelectorAll('[aria-label]');
      allEls.forEach(el => {
        if (result.date) return;
        const label = el.getAttribute('aria-label') || '';
        if (label.length > 5 && label.length < 80 &&
            (/\d{4}-\d{2}-\d{2}/.test(label) || /\d{1,2}:\d{2}/.test(label))) {
          result.date = label;
        }
      });
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
    let venue = '';
    const locationCandidates = [];

    // Strategy 1: Look for links near the title that point to venue pages
    if (titleEl) {
      let parent = titleEl.parentElement;
      while (parent && parent !== main) {
        const sibling = parent.nextElementSibling;
        if (sibling) {
          const aLinks = sibling.querySelectorAll('a');
          aLinks.forEach(a => {
            const text = a.innerText.trim();
            const href = a.href || '';
            if (text.length > 3 && text.length < 100 &&
                // Skip navigation/footer links
                !isFooterJunk(text) &&
                !text.match(/^(More|About|Discussion|Going|Interested|Share|Invite|Log.in|Sign.up|Logga.in)$/i) &&
                !href.includes('/privacy') && !href.includes('/policies') &&
                !href.includes('/help') && !href.includes('/login') &&
                !href.includes('/legal') && !href.includes('/cookie') &&
                // Must link to a Facebook page/place, not a generic FB link
                (href.includes('facebook.com/') && !href.includes('facebook.com/policies'))) {
              if (!venue) venue = text;
            }
          });
        }
        parent = parent.parentElement;
      }
    }

    // Strategy 2: Look for spans with address patterns
    if (!venue) {
      const spans = main.querySelectorAll('span');
      spans.forEach(s => {
        const t = s.innerText.trim();
        if (t.length < 5 || t.length > 200) return;
        if (isFooterJunk(t)) return;
        if (t.match(/\d+.*,\s*\w+/) || t.match(/ул\.|бул\.|пл\.|str\.|ave\.|road|blvd/i)) {
          locationCandidates.push(t);
        }
      });
    }
    result.location = venue || locationCandidates[0] || '';

    // --- Description ---
    result.description = '';

    // "Details" heading in multiple languages
    const detailsWords = [
      'details', 'detaljer', 'подробности', 'détails', 'einzelheiten',
      'detalles', 'dettagli', 'detalhes', 'ayrıntılar', 'informacje',
      'information'
    ];

    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, null);
    let detailsTextNode = null;
    while (walker.nextNode()) {
      const nodeText = walker.currentNode.textContent.trim().toLowerCase();
      if (detailsWords.includes(nodeText)) {
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

      clickSeeMore(section);
      await sleep(800);

      const sectionText = section.innerText || '';
      const lines = sectionText.split('\n');

      const skipPatterns = [
        new RegExp('^(' + detailsWords.join('|') + ')$', 'i'),
        /^\d+ people responded$/,
        /^\d+ personer svarade$/,
        /^\d+ человек ответили$/,
        /^Event by /i,
        /^Evenemang av /i,
        /^Събитие от /i,
        /^Public$/i, /^Offentligt$/i, /^Публично$/i,
        /^Private$/i, /^Privat$/i,
        /^Anyone on or off Facebook$/i,
        /^Alla på och utanför Facebook$/i,
        /^· Anyone/i, /^· Alla/i,
        /^Duration:/i, /^Varaktighet:/i,
        /^Price:/i, /^Pris:/i,
        /^Tickets/i, /^Biljetter/i,
        /^\d+ (Going|Interested|Went|Ska|Intresserade|Deltog)$/i,
        /^Logga in/i, /^Log in/i, /^Har du glömt/i,
        new RegExp('^(' + seeMorePatterns.join('|') + ')$', 'i'),
        new RegExp('^(' + seeLessPatterns.join('|') + ')$', 'i'),
      ];

      const titleLower = (result.title || '').toLowerCase();
      const dateLower = (result.date || '').toLowerCase();
      const locationLower = (result.location || '').toLowerCase();

      const descLines = lines.filter(line => {
        const l = line.trim();
        if (l.length === 0) return false;
        if (l.length <= 3) return false;
        if (isFooterJunk(l)) return false;
        for (const pat of skipPatterns) {
          if (pat.test(l)) return false;
        }
        if (titleLower && l.toLowerCase() === titleLower) return false;
        if (dateLower && dateLower.length > 5 && l.toLowerCase().includes(dateLower)) return false;
        if (locationLower && locationLower.length > 3 && l.toLowerCase() === locationLower) return false;
        return true;
      });

      if (descLines.length > 0) {
        result.description = descLines.join('\n').trim();
      }
    }

    // --- Fallback description: if no "Details" section found ---
    if (!result.description && titleEl) {
      let eventContainer = titleEl.parentElement;
      for (let i = 0; i < 10; i++) {
        if (!eventContainer.parentElement || eventContainer.parentElement === main) break;
        eventContainer = eventContainer.parentElement;
      }

      let nextEl = eventContainer.nextElementSibling;
      let attempts = 0;
      while (nextEl && attempts < 5) {
        const text = nextEl.innerText.trim();
        if (text.length > 20) {
          const lines = text.split('\n').filter(l => {
            const lt = l.trim();
            if (lt.length <= 3) return false;
            if (isFooterJunk(lt)) return false;
            if (seeMorePatterns.includes(lt.toLowerCase())) return false;
            if (seeLessPatterns.includes(lt.toLowerCase())) return false;
            if (/^\d+ (Going|Interested|Went|Ska|Intresserade|Deltog)$/i.test(lt)) return false;
            if (/^(Logga in|Log in|Har du glömt|Sign up|Create)/i.test(lt)) return false;
            // Skip "Kan vara en bild" (image alt text)
            if (/^(Kan vara|May be|Може да|Peut être)/i.test(lt)) return false;
            return true;
          });
          if (lines.length > 0 && !isFooterJunk(lines.join(' '))) {
            result.description = lines.join('\n').trim();
            break;
          }
        }
        nextEl = nextEl.nextElementSibling;
        attempts++;
      }
    }

    result.success = true;
    result.url = window.location.href;

  } catch (e) {
    result.error = e.message;
  }

  chrome.runtime.sendMessage({ action: 'extractionResult', data: result });
})();
