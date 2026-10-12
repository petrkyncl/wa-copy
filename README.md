# WA Copy

Rozšíření pro Chrome/Arc: rychlé kopírování zpráv z WhatsApp Web s časem a odesílatelem.

## Ovládání

- **Najetí na zprávu** → vedle bubliny se ukáže lišta: ✓ (vybrat) a kopírovat.
- **Kopírovat** → zkopíruje tu jednu zprávu. Pokud je zpráva součástí výběru, zkopíruje celý výběr.
- **✓** → vybere zprávu. **Shift + ✓** (nebo Shift + klik na bublinu) na jiné zprávě → vybere celý rozsah mezi nimi, i přes zprávy, které už odscrollovaly z obrazovky.
- **⌘ + klik** → přidá nebo odebere jednu zprávu.
- Dole se objeví lišta **„N zpráv · Kopírovat · ✕“**. Funguje i **⌘C**, **Esc** výběr zruší.

## Formát

```
[12.10.2026 14:32] Petr: text zprávy
[12.10.2026 14:33] Rohit: <image> popisek
[12.10.2026 14:35] Petr: (↩ Rohit: "původní zpráva…") odpověď
[12.10.2026 14:40] Rohit: <voice message 0:42>
[12.10.2026 14:41] Petr: <document: faktura.pdf>
```

Média: `<image>`, `<video m:ss>`, `<GIF>`, `<voice message m:ss>`, `<audio>`, `<document: název>`, `<sticker>`, `<location: lat, lng>`, `<contact: jméno>`, `<poll: otázka> [a | b]`, `<message deleted>`.

## Jak to funguje

Content script běží ve `world: "MAIN"` a čte zprávy z interního úložiště WhatsAppu (`require('WAWebCollections')`). Odtud bere přesný čas, typ média i odesílatele ve skupinách. Úložiště nemá zprávy v pořadí zobrazení, proto se řadí podle času. Záznamy o hovorech (`call_log`) se vynechávají, protože je WhatsApp Web v chatu nezobrazuje. Když úložiště není dostupné (WhatsApp změní interní API), přepne se na čtení z DOM (`data-pre-plain-text`).

## Instalace (Arc / Chrome)

1. `arc://extensions` (v Chromu `chrome://extensions`) → zapnout **Developer mode**
2. **Load unpacked** → vybrat složku `~/Projects/wa-copy`
3. Znovu načíst web.whatsapp.com

Po změně kódu: na stránce rozšíření kliknout na ↻ u WA Copy a znovu načíst WhatsApp.
