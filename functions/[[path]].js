// Cloudflare Pages Functions Adapter
// Place this file in functions/[[path]].js in your Pages project
import worker from "../worker.js";

export const onRequest = (context) => {
  return worker.fetch(context.request, context.env, context);
};
