// Wraps async route handlers to catch errors and pass to Express error middleware
const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    next(error);
  }
};

export { asyncHandler };
