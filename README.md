# TradeLog — NSE Swing Trade Journal

Full-featured PWA trading journal. Works as:
- **Android App** (install from Chrome)
- **Website** (deploy to Netlify)
- Both synced via **Supabase**

---

## Files
```
index.html          — App shell + all modals
style.css           — Complete dark theme CSS
app.js              — All JS logic (math, render, sync)
manifest.json       — PWA manifest
sw.js               — Service Worker (offline support)
supabase-schema.sql — Run once in Supabase SQL editor
netlify.toml        — Netlify SPA routing
```

---

## Deploy to Netlify (Website)

1. Push these files to a GitHub repo
2. Go to https://app.netlify.com → New site → Import from GitHub
3. Build command: *(leave empty)*  
   Publish directory: `.` (root)
4. Deploy — your site is live!

---

## Install on Android (PWA)

1. Open the Netlify URL in **Chrome** on Android
2. Tap ⋮ menu → **Add to Home Screen**
3. Done — it works offline and feels native

### Optional: Build a real .apk (Capacitor)
```bash
npm install -g @capacitor/cli
npm init -y
npm install @capacitor/core @capacitor/android

npx cap init TradeLog com.tradelog.app --web-dir .
npx cap add android
npx cap copy android
npx cap open android   # Opens in Android Studio → Build APK
```

---

## Supabase Cloud Sync Setup

1. Create a free project at https://supabase.com
2. Go to **SQL Editor** and paste + run `supabase-schema.sql`
3. Go to **Settings → API** and copy:
   - Project URL
   - `anon` public key
4. In the app: tap ⚙ Config → paste URL + Key → Done
5. Tap **Push to Cloud** — your trades are now in Supabase
6. On any other device (phone/web), **Pull from Cloud** to sync

---

## Features

| Feature | Details |
|---|---|
| Auto-calculations | SL%, Alloc%, Qty, P&L ₹/%, Port P&L%, R:R, Days |
| Dashboard | Portfolio banner, Win Rate, Avg R:R, Avg Days, Best/Worst |
| Trade Cards | Color-coded by profit/loss/open, all key metrics |
| Filters | All / Open / Closed / Profit / Loss / Real / Virtual |
| Table | 23-column scrollable spreadsheet |
| Setup Dropdown | 19 chart patterns including VCP, Flag, EMA Pullback |
| Exit Dropdown | 8 exit reason types |
| Market State | 10 detailed market conditions |
| Trade Type | Real / Virtual paper trade tagging |
| Notes | Free-text trade observations |
| Cloud Sync | Supabase push/pull (same DB for app + web) |
| Offline | Full offline support via Service Worker |
| Export/Import | JSON backup and restore |

---

## Calculated Fields Formula Reference

| Field | Formula |
|---|---|
| SL % | `(Buy Price − SL Price) / Buy Price × 100` |
| Alloc % | `Allocation / Portfolio Value × 100` |
| Quantity | `floor(Allocation / Buy Price)` |
| P&L ₹ | `(Sell − Buy) × Qty` |
| P&L % | `(Sell − Buy) / Buy × 100` |
| Port P&L % | `P&L ₹ / Portfolio Value × 100` |
| R:R Ratio | `(Sell − Buy) / (Buy − SL)` |
| Days Held | `Sell Date − Buy Date` |
