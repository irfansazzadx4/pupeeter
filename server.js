const express = require('express');
const puppeteer = require('puppeteer');

const app = express();

app.get('/test', async (req, res) => {
    try {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        await page.goto(
            'https://server24.kesug.com/bot/storage/69fb96176df69_card.html?i=2',
            { waitUntil: 'networkidle0' }
        );

        // ✅ HTML এর body তে directly margin inject করুন
      await page.evaluate(() => {
    document.body.style.marginTop = '0.3in';
    document.body.style.paddingTop = '0.3in';
});

        await page.emulateMediaType('screen');

        await page.pdf({
            path: 'nid.pdf',
            format: 'Letter',
            printBackground: true,
            preferCSSPageSize: false,
            margin: {
                top: '0px',  // ✅ এখানে 0 রাখুন
                right: '0px',
                bottom: '0px',
                left: '0px'
            }
        });

        await browser.close();
        res.send('PDF Generated Successfully');

    } catch (e) {
        console.log(e);
        res.send(e.message);
    }
});

app.listen(3000, () => {
    console.log('Server Running On Port 3000');
});