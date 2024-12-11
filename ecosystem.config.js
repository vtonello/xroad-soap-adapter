module.exports = {
    apps: [{
        name: "xroad-soap-adapter",
        script: "./index.js",
        instances: "max",
        exec_mode: "cluster",
        env: {
            NODE_ENV: "production",
            PORT: 3000
        }
    }]
};