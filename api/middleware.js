import * as Sentry from "@sentry/node";

export async function withErrorHandling(handler) {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      Sentry.captureException(error);
      // Log dell'errore
      console.error("Error in handler:", error);
      throw error; // Rilancio l'errore per far gestire a Vercel la risposta
    }
  };
}

export function captureException(error) {
  Sentry.captureException(error);
}

export function setTags(tags) {
  Sentry.setUser(tags);
}
