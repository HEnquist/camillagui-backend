const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
    const forwardToBackend = createProxyMiddleware({target: 'http://localhost:5000', changeOrigin: true});
    app.use('/api', forwardToBackend);
    app.use('/config', forwardToBackend);
    app.use('/coeff', forwardToBackend);
};