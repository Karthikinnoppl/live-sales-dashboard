# Live Sales Dashboard for 2026 Meeting Details

This is a one-page React dashboard that reads live data from a Google Sheet and reports by outbound caller, salesperson, lead status, and services.

## Metrics

- Total meetings booked = all rows loaded from selected tabs
- Valid meetings = total rows excluding `No Show`, `Not a right fitment`, `Cancelled/Canceled`
- Success rate = Proposal Won / Valid Meetings
- Closure rate = Proposal Won / (Proposal Won + Proposal Lost)
- Quality rate = Valid Meetings / Total Meetings

## Sheet setup

The dashboard reads tabs from the Google Sheet using the public CSV/gviz endpoint. Your current sheet ID is already configured:

`1CbIkGkSyFi5K1Ups7wgwnCP5vM9vsdNtv44hxNfrqG8`

Make sure the sheet is either shared as viewable or published to the web.

Default tabs included:

`External, Adam, Patrick, Sean, Sam, Mike, Tail, Clinton`

You can edit the tab list directly inside the dashboard UI.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

1. Create a new GitHub repository, for example: `meeting-dashboard`.
2. Upload/push these files.
3. In GitHub, go to **Settings > Pages**.
4. Choose **GitHub Actions** or deploy from the `/dist` folder after running `npm run build`.

Recommended GitHub Action is included in `.github/workflows/deploy.yml`.
