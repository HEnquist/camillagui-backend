const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
    app.use('/api', createProxyMiddleware({target: 'http://127.0.0.1:5005/api', changeOrigin: true}));
    app.use('/config', createProxyMiddleware({target: 'http://127.0.0.1:5005/config', changeOrigin: true}));
    app.use('/coeff', createProxyMiddleware({target: 'http://127.0.0.1:5005/coeff', changeOrigin: true}));
};