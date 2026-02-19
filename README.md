# FB Event Extractor

A Chrome extension that extracts event data (poster image, date/time, title, description, location) from Facebook event pages.

## Features

### Auto-Scanner (Part 1)
Navigate to any Facebook page's Events tab and a floating control panel appears automatically.

- **One-click scanning** - Processes all events on the page sequentially
- **Auto-scroll** - Scrolls down to load more events and keeps extracting
- **Full descriptions** - Clicks "See more" buttons to get complete event descriptions
- **Recurring events** - Handles events with multiple dates (`event_time_id`)
- **Deduplication** - Skips already-processed events
- **Visual markers** on the page:
  - Blue pulsing border + "Extracting..." = currently processing
  - Green border + "Extracted" = done
  - Red border + "Failed" = error
- **Draggable panel** - Move it anywhere on the page
- **Export JSON** - Download all extracted data as a JSON file
- **Copy Log** - Copy the full extraction log to clipboard for debugging

### Manual URL Extraction (Part 2)
Click the extension icon to open the popup, paste a list of Facebook event URLs, and extract data in batch.

- Paste multiple URLs (one per line)
- Automatic deduplication by event ID
- Validates URLs and skips invalid ones
- Visual card results with cover images
- Copy results as JSON

## Data Extracted

For each event, the extension extracts:

| Field | Description |
|-------|-------------|
| **Title** | Event name |
| **Date** | Full date and time |
| **Location** | Venue name and address |
| **Description** | Full event description (expands "See more") |
| **Image** | Cover/poster image URL |
| **URL** | Direct link to the Facebook event |

## Installation

1. Download or clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the extension folder

## Usage

### Auto-Scanner
1. Navigate to a Facebook page's Events tab (e.g. `facebook.com/pagename/events`)
2. The **FB Event Scanner** panel appears in the top-right corner
3. Click **Start Scanning**
4. Wait for all events to be processed (green badges appear on each card)
5. Click **Export JSON** to download the results

### Manual Extraction
1. Click the extension icon in Chrome toolbar
2. Paste Facebook event URLs (one per line)
3. Click **Extract Events**
4. View results as cards or click **Copy JSON**

## Example Output

```json
[
  {
    "title": "Concert at City Hall",
    "date": "Friday 15 March 2024 at 19:00",
    "location": "City Hall, Main Street 1, Sofia",
    "description": "Join us for an evening of classical music...",
    "image": "https://scontent.xx.fbcdn.net/v/...",
    "url": "https://www.facebook.com/events/1234567890/"
  }
]
```

## Requirements

- Google Chrome browser
- Must be logged into Facebook (the extension uses your session to access event pages)

## How It Works

1. For auto-scanning: A content script (`scanner.js`) injects a floating UI panel on Facebook page event listings
2. For each event, the background script (`background.js`) opens the event page in a hidden tab
3. A content script (`content.js`) is injected into the event page to:
   - Click "See more" buttons to expand truncated text
   - Extract title, date, location, description, and cover image from the DOM
4. Results are sent back via Chrome messaging and displayed/exported

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

MIT License - feel free to use, modify, and distribute.
