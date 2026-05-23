const express   = require("express");
const puppeteer = require("puppeteer");
const cors      = require("cors");
const https     = require("https");
const http      = require("http");
const fs        = require("fs");
const path      = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const SECRET = process.env.SECRET || "nid_pdf_secret_2025";
const PORT   = process.env.PORT   || 8080;

// ── Font URLs (fallback order) ──
const FONT_SOURCES = [
  "https://auto.onlinebd.top/fonts/Bangla.ttf",
  "https://onlinebd.top/fonts/Bangla.ttf",
  "https://fonts.maateen.me/solaiman-lipi/SolaimanLipi.ttf",
];

// ── Font একবার download করে memory তে রাখো ──
let fontBase64 = null;
let fontLoaded = false;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 NIDBot/1.0" },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchUrl(res.headers.location));
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function loadFont() {
  if (fontLoaded) return;
  for (const url of FONT_SOURCES) {
    try {
      console.log(`⏳ Font loading: ${url}`);
      const buf = await fetchUrl(url);
      if (buf.length > 10000) { // valid font check
        fontBase64 = buf.toString("base64");
        fontLoaded = true;
        console.log(`✅ Font loaded: ${url} (${Math.round(buf.length/1024)}KB)`);
        return;
      }
    } catch (e) {
      console.log(`⚠️ Font failed: ${url} — ${e.message}`);
    }
  }
  console.error("❌ All font sources failed — will use system font");
}

function buildFontCSS() {
  if (fontBase64) {
    return `
<style id="font-fix">
@font-face {
    font-family: 'Solaimanlipi';
    src: url('data:font/truetype;base64,${fontBase64}') format('truetype');
    font-weight: normal;
    font-style: normal;
}
@font-face {
    font-family: 'Solaiman Lipi';
    src: url('data:font/truetype;base64,${fontBase64}') format('truetype');
    font-weight: normal;
    font-style: normal;
}
@font-face {
    font-family: 'Bangla';
    src: url('data:font/truetype;base64,${fontBase64}') format('truetype');
    font-weight: normal;
    font-style: normal;
}
* {
    font-family: 'Solaimanlipi', 'Solaiman Lipi', 'Bangla', Arial, sans-serif !important;
}
</style>`;
  }
  // Fallback: URL দিয়ে try (কাজ না করলেও system font যাবে)
  return `
<style id="font-fix">
@font-face {
    font-family: 'Solaimanlipi';
    src: url('https://auto.onlinebd.top/fonts/Bangla.ttf') format('truetype');
}
* { font-family: 'Solaimanlipi', Arial, sans-serif !important; }
</style>`;
}

function injectFontFix(html) {
  const css = buildFontCSS();
  // existing @font-face গুলো remove করো যাতে conflict না হয়
  let fixed = html.replace(/<style[^>]*id="embedded-fonts"[^>]*>[\s\S]*?<\/style>/gi, "");
  if (fixed.includes("</head>")) {
    return fixed.replace("</head>", css + "\n</head>");
  }
  return css + fixed;
}

// ── Startup এ font load ──
loadFont();

app.post("/pdf", async (req, res) => {
  if (req.body.secret !== SECRET) {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }

  const { html, url } = req.body;
  if (!html && !url) {
    return res.status(400).json({ success: false, error: "No HTML or URL provided" });
  }

  // Font এখনো load না হলে একবার try
  if (!fontLoaded) await loadFont();

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--disable-web-security",
        "--allow-running-insecure-content",
        // বাংলা font render এর জন্য
        "--font-render-hinting=none",
        "--disable-font-subpixel-positioning",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });
    page.setDefaultNavigationTimeout(90000);
    page.setDefaultTimeout(90000);

    if (url) {
      await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
    } else {
      const fixedHtml = injectFontFix(html);
      await page.setContent(fixedHtml, {
        waitUntil: "networkidle0",
        timeout: 90000,
      });
    }

    // সব image load হওয়া পর্যন্ত wait
    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      if (!imgs.length) return;
      await Promise.allSettled(
        imgs.map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise(resolve => {
            img.onload  = resolve;
            img.onerror = resolve;
            setTimeout(resolve, 8000);
          });
        })
      );
    });

    // Barcode canvas wait
    await page.evaluate(() => new Promise(resolve => {
      const check = () => {
        const canvas = document.querySelector("#barcode canvas");
        if (canvas && canvas.width > 0) return resolve();
        setTimeout(check, 150);
      };
      check();
      setTimeout(resolve, 5000);
    })).catch(() => {});

    // Font render extra wait
    await new Promise(r => setTimeout(r, 2000));

    const pdfBuf = await page.pdf({
      format          : "A4",
      printBackground : true,
      margin          : { top: "0", right: "0", bottom: "0", left: "0" },
      preferCSSPageSize: true,
    });

    console.log(`✅ PDF: ${pdfBuf.length} bytes | Font: ${fontLoaded ? "embedded" : "fallback"}`);
    res.json({
      success: true,
      pdf    : Buffer.from(pdfBuf).toString("base64"),
      size   : pdfBuf.length,
    });

  } catch (err) {
    console.error("❌ PDF error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// Font status endpoint
app.get("/font-status", (_, res) => res.json({
  fontLoaded,
  fontSize: fontBase64 ? Math.round(fontBase64.length * 3/4 / 1024) + "KB" : null,
}));

app.get("/reload-font", async (_, res) => {
  fontLoaded = false;
  fontBase64 = null;
  await loadFont();
  res.json({ fontLoaded, message: fontLoaded ? "Font reloaded" : "Font load failed" });
});

app.get("/", (_, res) => res.json({
  status: "ok",
  service: "NID PDF API",
  fontLoaded,
}));

app.listen(PORT, () => console.log(`✅ PDF API on port ${PORT} | Font: loading...`));
