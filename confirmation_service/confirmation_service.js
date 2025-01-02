const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const axios = require('axios');

const packageDefinition = protoLoader.loadSync(__dirname + '/confirmation.proto', {});
const confirmationProto = grpc.loadPackageDefinition(packageDefinition).confirmation;

async function getPriceData(isin) {
    try {
        console.log(`Fetching price data for ISIN: ${isin}`);
        const response = await axios.get(`https://onlineweiterbildung-reutlingen-university.de/vswsp4/index.php?isin=${isin}`);
        console.log(`Received price data: ${JSON.stringify(response.data)}`);
        return response.data;
    } catch (error) {
        console.error("Price data could not be retrieved", error);
        return null;
    }
}

function confirmOrder(call, callback) {
    const { isin } = call.request;
    console.log(`Received gRPC request for ISIN: ${isin}`);
    setTimeout(async () => {
        const priceData = await getPriceData(isin);
        if (priceData && !priceData.answer) {
            const price = priceData[Object.keys(priceData)[0]]
            const response = { confirmed: true, price: price };
            console.log(`Sending gRPC response: ${JSON.stringify(response)}`);
            callback(null, response);
        } else {
            const response = { confirmed: false, price: 0 };
            console.log(`Sending gRPC response: ${JSON.stringify(response)}`);
            callback(null, response);
        }
    }, 10000); // 10 Sekunden Verzögerung
}

const server = new grpc.Server();
server.addService(confirmationProto.ConfirmationService.service, { confirmOrder: confirmOrder });
server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), () => {
    console.log('gRPC server running on port 50051');
    server.start();
});