# WA Copy

Chrome/Arc extension for WhatsApp Web: fast copying of messages with time and sender, plus loading older history from the phone.

## Usage

- **Hover a message**: next to WhatsApp's own React button you get **Copy** and **Select**.
- **Copy** copies that one message.
- **Select** turns on WhatsApp's native selection mode with that message checked. In select mode:
  - **Shift + click** another message selects everything in between, including messages that already scrolled out of view.
  - The bottom bar gets a **Copy** button (next to Star/Delete/Forward), and **⌘C** works too.
- **Hover a date pill** ("Today", "Friday", "7/14/2026"): **Select whole day** / **Copy whole day**.
- **History icon in the chat header** (or clicking "Use WhatsApp on your phone to see older messages…"): loads older messages from the phone in batches of 500 until it reaches the start of the chat. A progress pill shows the count and the oldest date; when it finishes, **Copy all** copies the whole chat. Clicking the icon again stops it.

## Format

```
[12.10.2026 14:32] Petr: message text
[12.10.2026 14:33] Rohit: <image> caption
[12.10.2026 14:35] Petr: (↩ Rohit: "original message…") reply
[12.10.2026 14:40] Rohit: <voice message 0:42>
[12.10.2026 14:41] Petr: <document: invoice.pdf>
```

Media: `<image>`, `<video m:ss>`, `<GIF>`, `<voice message m:ss>`, `<audio>`, `<document: name>`, `<sticker>`, `<location: lat, lng>`, `<contact: name>`, `<poll: question> [a | b]`, `<message deleted>`.

## How it works

The content script runs in `world: "MAIN"` so it can use WhatsApp's own modules (`window.require`):

- **Data**: `WAWebCollections` (Chat/Msg/Contact) gives exact timestamps, media types and group senders. The chat's message collection is *not* in display order, so it is sorted by time. `call_log` entries are skipped, because WhatsApp Web doesn't show them in the chat.
- **Native look**: the hover buttons, the select-bar Copy and the header icon are clones of WhatsApp's own buttons (React button, Star/Forward, Search), so they carry the same classes, sizes, hover states and dark mode. Toasts use WhatsApp's `ToastManager`.
- **Selection**: the conversation's React props expose `onSelectMessages()` and the `selectedMessages` multi-selection (`setVal`, `getSelected`).
- **History from the phone**: WhatsApp Web dropped the button but still ships the mechanism, a `HISTORY_SYNC_ON_DEMAND` peer-data request (`WAWebSendNonMessageDataRequest.sendPeerDataOperationRequest`) to your own phone. Gated by `WAWebSyncGatingUtils.isHistorySyncOnDemandEnabled()`. The batch size comes from the AB prop `history_sync_on_demand_message_count` (50); the extension raises it to 500 for its own requests. The phone's answer arrives as `history_sync_on_demand_events:success_history_sync_od` / `…:error_history_sync_od` (error = nothing older), then `WAWebChatLoadMessages.loadEarlierMsgs({chat})` pulls the messages from the local DB into the chat. This works past the "older messages from before …" boundary. The phone has to be online with WhatsApp running.
- If the store isn't reachable (WhatsApp changed its internals), single-message copy falls back to the DOM (`data-pre-plain-text`).

## Install (Arc / Chrome)

1. Open `arc://extensions` (`chrome://extensions` in Chrome) and turn on **Developer mode**
2. **Load unpacked** → pick the `~/Projects/wa-copy` folder
3. Reload web.whatsapp.com

After changing the code: click ↻ on WA Copy on the extensions page and reload WhatsApp.
