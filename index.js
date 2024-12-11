const express = require("express");
const axios = require("axios");
const {DOMParser, XMLSerializer} = require("xmldom");
const https = require("https");
const fs = require("fs");

class SOAPProxy {
    constructor(port = 3000) {
        this.app = express();
        this.port = port;
        this.parser = new DOMParser();
        this.serializer = new XMLSerializer();

        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(express.raw({type: ["application/xml", "text/xml"], limit: '10mb'}));
        this.app.use(this.errorHandler);
    }

    setupRoutes() {
        this.app.post("/", this.handleSOAPRequest.bind(this));

        this.app.get("/", (req, res) => {
            res.send("Welcome to the SOAP Proxy Server!");
        });

    }

    errorHandler(err, req, res, next) {
        console.error("Middleware error:", err);
        res.status(500).json({error: "Internal server error"});
    }

    createHttpsAgent() {
        return new https.Agent({
            rejectUnauthorized: false, // Use with caution in production
        });
    }

    removeRequestSoapActionNode(soapAction, requestXmlDoc) {
        const wrapperNode = requestXmlDoc.getElementsByTagName(soapAction)[0];
        if (wrapperNode) {
            const parentNode = wrapperNode.parentNode;
            while (wrapperNode.firstChild) {
                parentNode.appendChild(wrapperNode.firstChild);
            }
            parentNode.removeChild(wrapperNode);
        }
        return requestXmlDoc;
    }

    createXRoadSoapResponseXml(soapAction, requestXmlDoc, soapResponseXml) {
        const X_ROAD_NS_URI = "http://x-road.eu/xsd/xroad.xsd";
        const X_ROAD_NS_ATTR = "xrd";
        const X_ROAD_IDEN_NS_URI = "http://x-road.eu/xsd/identifiers";
        const X_ROAD_IDEN_NS_ATTR = "iden";

        const xRoadSoapResponseXml = this.parser.parseFromString(
            '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"></soapenv:Envelope>',
            "text/xml"
        );

        const envelope = xRoadSoapResponseXml.documentElement;
        envelope.setAttribute(`xmlns:${X_ROAD_NS_ATTR}`, X_ROAD_NS_URI);
        envelope.setAttribute(`xmlns:${X_ROAD_IDEN_NS_ATTR}`, X_ROAD_IDEN_NS_URI);

        const header = xRoadSoapResponseXml.createElement("soapenv:Header");
        const body = xRoadSoapResponseXml.createElement("soapenv:Body");

        this.addXRoadHeaders(header, requestXmlDoc);

        const xRoadSoapActionResponseElement = xRoadSoapResponseXml.createElement(`${soapAction}Response`);
        this.addXRoadResponseBody(xRoadSoapActionResponseElement, soapResponseXml);

        body.appendChild(xRoadSoapActionResponseElement);
        envelope.appendChild(header);
        envelope.appendChild(body);

        return xRoadSoapResponseXml;
    }

    addXRoadHeaders(headerNode, xmlDoc) {
        const X_ROAD_NS_URI = "http://x-road.eu/xsd/xroad.xsd";
        const xRoadHeaders = xmlDoc.getElementsByTagNameNS(X_ROAD_NS_URI, "*");

        for (let i = 0; i < xRoadHeaders.length; i++) {
            headerNode.appendChild(xRoadHeaders[i].cloneNode(true));
        }
    }

    addXRoadResponseBody(soapActionResponseElement, soapResponseXml) {
        const soapResponseNode = soapResponseXml.getElementsByTagNameNS("*", "Body")[0].firstChild;
        soapActionResponseElement.appendChild(soapResponseNode);
    }

    async handleSOAPRequest(req, res) {
        try {
            const serviceUrl = req.query.serviceUrl;
            if (!serviceUrl) {
                return res.status(400).send("Service URL is required");
            }

            const soapAction = JSON.parse(req.get("SOAPAction"));
            const contentType = req.get("Content-Type");

            console.debug("Posting to:", serviceUrl);
            console.debug("Request headers:", JSON.stringify(req.headers));

            const requestXmlDoc = this.parser.parseFromString(req.body.toString(), "text/xml");
            this.removeRequestSoapActionNode(soapAction, requestXmlDoc);

            const soapResponse = await axios.post(serviceUrl, requestXmlDoc.toString(), {
                headers: {
                    "Content-Type": contentType,
                    SOAPAction: soapAction,
                },
                httpsAgent: this.createHttpsAgent(),
                timeout: 10000, // 10-second timeout
            });

            const soapResponseXml = this.parser.parseFromString(soapResponse.data, "text/xml");
            const xRoadSoapResponseXml = this.createXRoadSoapResponseXml(soapAction, requestXmlDoc, soapResponseXml);

            const xRoadSoapResponseXmlString = this.serializer.serializeToString(xRoadSoapResponseXml);

            res.header("Content-Type", "text/xml").send(xRoadSoapResponseXmlString);
        } catch (err) {
            console.error("Error handling SOAP request:", err);
            res
                .status(err.response?.status || 500)
                .header("Content-Type", "text/xml")
                .send(err.response?.data || "Error handling SOAP request");
        }
    }

    startServer(certPath, keyPath) {
        const options = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
        };

        https.createServer(options, this.app)
            .listen(this.port, "0.0.0.0", () => {
                console.log(`HTTPS server running on https://localhost:${this.port}`);
            });
    }
}

// Usage
if (require.main === module) {
    const soapProxy = new SOAPProxy(process.env.PORT || 3000);
    soapProxy.startServer("server.cert", "server.key");
}

module.exports = SOAPProxy;