const express = require('express');
const bodyParser = require('body-parser');
const { randomBytes } = require('crypto');
const cors = require('cors');
const axios = require('axios');
const { console } = require('inspector');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// const validISINs = [
//     "US5949181045",
//     "IE00BHZPJ569",
//     "US0378331005",
//     "US30303M1027"
// ]

const PORT = 3005;
app.listen(PORT, () => {
    console.info(`Server is running on port ${PORT}`)
});

async function getPriceData(isin) {
    try {
        const response = await axios.get(`https://onlineweiterbildung-reutlingen-university.de/vswsp4/index.php?isin=${isin}`);
        return response.data;
    } catch (error) {
        console.error("Price data could not be retrieved");
        return null;
    }
}

app.get("/confirmation", async (req, res) => {
    console.log("Angekommen")
    const { isin } = req.query;

    if (!isin) {
        return res.status(400).json({ answer: "ISIN is required" });
    }

    const priceData = await getPriceData(isin);

    if (priceData && !priceData.answer) {
        const confirmed = true;
        res.json({ confirmed, ...priceData });
    } else {
        res.json({ "confirmed": false, answer: "wrong isin" });
    }
});