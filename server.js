const express    = require("express");
const puppeteer  = require("puppeteer");
const app        = express();

app.use(express.json({ limit: "10mb" }));

const SECRET = process.env.SECRET || "nid_pdf_secret_2025";
const PORT   = process.env.PORT   || 3001;

app.get("/", (req, res) => res.send("Puppeteer PDF API running ✅"));

app.post("/pdf", async (req, res) => {
    if (req.body.secret !== SECRET) {
        return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const { html } = req.body;
    if (!html) {
        return res.status(400).json({ success: false, error: "No HTML" });
    }

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
            ],
        });

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });

        // window.print() বন্ধ
        await page.evaluate(() => { window.print = () => {}; });

        const pdfBuf = await page.pdf({
            format         : "Letter",
            printBackground: true,
            margin         : { top: "0", right: "0", bottom: "0", left: "0" },
        });

        res.json({
            success: true,
            pdf    : Buffer.from(pdfBuf).toString("base64"),
            size   : pdfBuf.length,
        });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
});

app.listen(PORT, () => console.log(`✅ PDF API on port ${PORT}`));
