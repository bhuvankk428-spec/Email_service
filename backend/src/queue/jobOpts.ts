export const baseJobOpts = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 86_400, count: 5000 },
  removeOnFail: { age: 7 * 86_400 },
};
