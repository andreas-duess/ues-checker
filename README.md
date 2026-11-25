# UES Copy-Forward Checker

**Live:** [ues-checker.duess.com](https://ues-checker.duess.com)

A zero-upload, 100% browser-side tool for USDA FAS cooperators, commodity groups, and state regional trade groups (SRTGs) to spot recycled copy-forward text, stale years, unchanged numbers, and unquantified paragraphs before filing a Unified Export Strategy (UES).

## Privacy Guarantee

- **Zero uploads.** Every file (`.docx`, `.pdf`, `.txt`, `.md`) and every pasted character stays inside your browser tab.
- **Zero external requests.** Fonts, styles, and parsers (`fflate`, `pdfjs-dist`) are bundled locally. No analytics, no tracking, no AI APIs. Turn off Wi-Fi after the page loads and everything still runs.

## What It Checks

1. **Verbatim copy-forward sentences** (85%+ similarity to last year's draft)
2. **Light find-and-replace edits** (60–84% similarity — e.g. swapped a year or nudged one dollar figure while keeping the identical sentence structure)
3. **Stale years and fiscal cycles** (leftover `2024`, `2025`, `FY25`, `FY26` references relative to your target cycle, while treating explicit historical ranges more gently)
4. **Unchanged figures** (identical dollar amounts, percentages, or counts carried over from last year)
5. **Unquantified paragraphs** (long paragraphs with zero numbers or measurable results — a prompt against FAS's 50/100 evaluation & results weighting)

## Local Development

```bash
npm install
npm test
npm run dev
```

## Deploy

Deployed on Cloudflare Pages at [ues-checker.duess.com](https://ues-checker.duess.com) (project `ues-checker` under the Duess Cloudflare account):

```bash
npm run build
CLOUDFLARE_API_TOKEN=$(cat ~/.config/secrets/CLOUDFLARE_DUESS_API_TOKEN) CLOUDFLARE_ACCOUNT_ID=881f712a188eb3e93945c5afbff783e3 npx wrangler@4 pages deploy dist --project-name=ues-checker --branch=main
```

## License

MIT — built by [Andreas Duess](https://duess.com/for-usaedc-members/) (Duess Strategies Inc., USAEDC member).
