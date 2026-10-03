const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const payload = {
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred.',
    },
    requestId: req.requestId,
  };

  if (process.env.NODE_ENV !== 'production' && err.stack) {
    payload.error.stack = err.stack;
  }

  res.status(statusCode).json(payload);
};

module.exports = errorHandler;
