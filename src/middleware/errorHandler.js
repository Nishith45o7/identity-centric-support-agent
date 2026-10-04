const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: statusCode >= 500 ? 'An unexpected error occurred.' : err.message || 'The request could not be completed.',
      request_id: req.requestId,
    },
  });
};

module.exports = errorHandler;
