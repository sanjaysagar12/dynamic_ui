const ABSOLUTE_URL_PATTERN = /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;

/**
 * Appends the auth token to relative href/src attributes in served HTML.
 *
 * A sandboxed iframe navigation carries the token as a query param on the
 * top-level request, but the browser's own follow-up requests for
 * <link>/<script> sub-resources never see it — there is no header to set and
 * the query string doesn't carry over to relatively-resolved URLs. Rewriting
 * those attributes here is what lets assets/style.css and assets/app.js
 * actually load instead of 401ing.
 */
export function rewriteRelativeUrlsWithToken(html: string, token: string): string {
  return html.replace(/(href|src)="([^"]*)"/gi, (match, attr: string, url: string) => {
    if (!url || ABSOLUTE_URL_PATTERN.test(url)) {
      return match;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${attr}="${url}${separator}token=${encodeURIComponent(token)}"`;
  });
}
