const logger = require('../services/logger');

function errorHandler(err, req, res, next) {
  logger.error(err.message, { path: req.path, method: req.method, stack: err.stack });

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

module.exports = { errorHandler };
