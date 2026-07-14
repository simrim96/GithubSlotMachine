// Esempio di come usare Sentry con l'API di spin.js
import * as Sentry from "@sentry/node";
import { Response } from "vercel";

export async function withSentry(handler) {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      Sentry.captureException(error);
      throw error;
    }
  };
}

export function captureException(error) {
  Sentry.captureException(error);
}

// Esempio d'uso nel file api/spin.js:
//
// import * as Sentry from "@sentry/node";
//
// export default withSentry(async (request, context) => {
//   try {
//     // ... tua logica
//     return Response.json({ result: "success" });
//   } catch (error) {
//     Sentry.captureException(error);
//     throw error;
//   }
// });
//
// Oppure per errori specifici:
// try {
//   // ... logica che può fallire
// } catch (error) {
//   Sentry.captureException(error);
//   // aggiungi contesto extra
//   Sentry.configureScope((scope) => {
//     scope.setTag("user_id", userId);
//     scope.setExtra("details", error.message);
//   });
// }
