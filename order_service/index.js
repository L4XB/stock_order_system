const express = require('express');
const bodyParser = require('body-parser');
const { randomBytes } = require('crypto');
const cors = require('cors');
const axios = require('axios');
const db = require('./dbConnection');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const app = express();
app.use(bodyParser.json());
app.use(cors());

const PORT = 3000;
app.listen(PORT, () => {
    console.info(`Server is running on port ${PORT}`)
});

const STATE_CREATED = 0;
const STATE_CONFIRMED = 1;
const STATE_EXECUTED = 2;
const STATE_SOLD = 3;

const validTransitions = {
    [STATE_CREATED]: [STATE_CONFIRMED],
    [STATE_CONFIRMED]: [STATE_EXECUTED],
    [STATE_EXECUTED]: [STATE_SOLD]
};


const packageDefinition = protoLoader.loadSync(__dirname + '/confirmation.proto', {});
const confirmationProto = grpc.loadPackageDefinition(packageDefinition).confirmation;

const client = new confirmationProto.ConfirmationService('verteilte_systeme-confirmation_service-1:50051', grpc.credentials.createInsecure());

async function callConfirmationService(isin) {
    return new Promise((resolve, reject) => {
        client.ConfirmOrder({ isin: isin }, (error, response) => {
            if (error) {
                console.error("Call to confirmation service could not be completed", error);
                return reject(null);
            }
            resolve(response);
        });
    });
}

app.post("/orders", async (req, res) => {
    try {
        const id = randomBytes(4).toString('hex');
        const { name, isin, amount } = req.body;
        const price = 0;
        const state = STATE_CREATED;
        console.info("Creating new Order with ID: " + id);

        if (!name || !isin || amount == null || price == null) {
            console.error("Error Creating Order: Invalid order data");
            return res.status(400).send({ error: "Invalid order data" });
        }

        const newOrder = { id, name, isin, amount, price, state };
        db.execute(
            'INSERT INTO orders (id, name, isin, amount, price, status) VALUES (?, ?, ?, ?, ?, ?)',
            [id, name, isin, amount, price, state])
            .then(result => {
                res.status(201).send({ statusCode: "201", statusText: "Created order successfully", newOrder });
                console.log("Created Order Successfully");
            })
            .catch(error => {
                console.error("Error Creating Order: ", error);
                res.status(404).send({ error: "Error Adding new Order", error });
            });

    } catch (error) {
        console.error("Server Error: ", error);
        res.status(500).send({ error: "Server Error" });
    }
});

app.get("/orders", async (req, res) => {
    try {
        console.info("Get all Orders");
        const { state } = req.query;

        let query = 'SELECT * FROM orders';
        let params = [];

        if (state !== undefined) {
            if (![STATE_CREATED, STATE_EXECUTED, STATE_SOLD].includes(parseInt(state))) {
                console.warn("Invalid state query parameter");
                return res.status(400).send({ error: "Invalid state query parameter" });
            }
            query += ' WHERE status = ?';
            params.push(state);
        }

        const [rows] = await db.execute(query, params);
        res.status(200).send(rows);
        console.info("Fetched Orders Successfully");
    } catch (error) {
        console.error("Error Fetching Orders: ", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
});

app.get("/orders/:id", async (req, res) => {
    try {
        console.info("Get Order by ID");
        const { id } = req.params;
        const [rows] = await db.execute('SELECT * FROM orders WHERE id = ?', [id]);
        const order = rows[0];
        if (!order) {
            console.warn(`Order with ID ${id} not found`);
            return res.status(404).send({ error: "Order not found" });
        }
        res.status(200).send(order);
        console.info(`Order with ID ${id} retrieved successfully`);
    } catch (error) {
        console.error("Error fetching order by ID: ", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
});

app.delete("/orders/:id", async (req, res) => {
    try {
        console.info("Delete Order by ID");
        const { id } = req.params;
        const [rows] = await db.execute('SELECT * FROM orders WHERE id = ?', [id]);
        const order = rows[0];
        if (!order) {
            console.warn(`Order with ID ${id} not found`);
            return res.status(404).send({ error: "Order not found" });
        }
        await db.execute('DELETE FROM orders WHERE id = ?', [id]);
        res.status(200).send(order);
        console.info(`Order with ID ${id} deleted successfully`);
    } catch (error) {
        console.error("Error deleting order by ID: ", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
});

app.patch("/orders/:id/amount", async (req, res) => {
    try {
        console.info("Update Order Amount by ID");
        const { id } = req.params;
        const { amount } = req.body;

        const [rows] = await db.execute('SELECT * FROM orders WHERE id = ?', [id]);
        const order = rows[0];
        console.info(order)
        if (!order) {
            console.warn(`Order with ID ${id} not found`);
            return res.status(404).send({ error: "Order not found" });
        }
        if (order.status == STATE_CREATED) {
            const newAmount = order.amount + amount;
            await db.execute('UPDATE orders SET amount = ? WHERE id = ?', [newAmount, id]);
            order.amount = newAmount;
            res.status(200).send(order);
            console.info(`Order amount for ID ${id} updated successfully`);
        } else {
            console.warn(`Order with ID ${id} cannot be modified`);
            res.status(400).send({ error: "Order cannot be modified" });
        }
    } catch (error) {
        console.error("Error updating order amount: ", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
});

app.patch("/orders/:id/state", async (req, res) => {
    try {
        console.info("Update Order State by ID");
        const { id } = req.params;
        const { state } = req.body;

        const [rows] = await db.execute('SELECT * FROM orders WHERE id = ?', [id]);
        const order = rows[0];
        if (!order) {
            console.warn(`Order with ID ${id} not found`);
            return res.status(404).send({ error: "Order not found" });
        }

        const currentState = order.status;
        if (!validTransitions[currentState] || !validTransitions[currentState].includes(state)) {
            console.warn(`Invalid state transition for order ID ${id}`);
            return res.status(400).send({ error: "Invalid state transition" });
        }

        if (currentState === STATE_CREATED && state === STATE_CONFIRMED) {
            const confirmation = await callConfirmationService(order.isin);
            console.info(confirmation)
            if (confirmation && !confirmation.answer) {
                const newState = STATE_CONFIRMED;
                const newPrice = confirmation[Object.keys(confirmation)[1]];
                console.log("New price")
                console.info(newPrice)

                await db.execute('UPDATE orders SET status = ?, price = ? WHERE id = ?', [newState, newPrice, id]);

                order.status = newState;
                order.price = newPrice;

                res.send({ statusCode: "200", statusText: "Order confirmed successfully", order });
                console.info(`Order state for ID ${id} updated successfully`);
            } else {
                res.status(400).send({ error: "Order could not be confirmed" });
            }
        } else {
            await db.execute('UPDATE orders SET status = ? WHERE id = ?', [state, id]);
            order.status = state;
            res.status(200).send(order);
            console.info(`Order state for ID ${id} updated successfully`);
        }
    } catch (error) {
        console.error("Error updating order state: ", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
});

app.get('/overload', async (req, res) => {
    for (let i = 0; i < 100; i++) {
        console.log(`------------------------- Log iteration: ${i}
    -------------------------`);
        for (let j = 0; j < 100000; j++) { }
    }
    res.status(200).send("Success");
});
